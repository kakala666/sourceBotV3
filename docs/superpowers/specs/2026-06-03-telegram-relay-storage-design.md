# 资源存储重构:Telegram 频道即存储 + 转发抓 file_id

日期:2026-06-03
状态:已批准设计,待实现

## 背景与动机

当前架构把采集到的媒体**完整下载并上传到 Wasabi S3** 作为跨 bot 的"源文件"。其他 bot 首次发某资源时,从 S3 下载再上传给 Telegram、拿到自己的 file_id 缓存。

这套方案的问题:
- **磁盘灾难**:采集时下载到 `/tmp/sb-*` 临时目录,失败路径(429 限流 / getFile 超时 / 进程重启)下清理不可靠,累积 4794 个目录共 157G 撑爆磁盘(100%),导致 PostgreSQL `FATAL: could not write init file`,整个后台和采集全挂。
- **慢且脆**:大文件下载+上传耗时;getFile 500 秒超时;429 限流导致 S3 上传失败,留下 DB 有记录但 S3 缺失的"坏文件",发送时整组 sendMediaGroup 失败。

## 核心思路

用 **Telegram 频道本身当存储后端**(Telegram-as-CDN),不再存完整文件:
- 采集时记录每个 media 的 `chat_id` + `message_id`(+ 采集 bot 自己的 file_id)
- 其他 bot 首次需要发该资源时,若无自己的 file_id,则 `forwardMessage(中转群, 来源频道, message_id)`,从转发返回的 Message 里抓到**本 bot 视角的 file_id**,缓存后删除中转消息
- 之后该 bot 发这条资源直接走缓存 file_id

转发是 Telegram 内部引用(不传输文件本体),极快;不下载 = 无磁盘占用 = 根除磁盘灾难。

## 关键决策(已与用户确认)

1. **频道成员前提**:所有对外 bot 加进所有采集频道(否则 forward 不了源消息)。已接受。
2. **S3 去留**:新方案只对新采集生效;现存老资源(无 message 字段)继续走 S3,保留回退能力。**老资源现实上无法切换**——采集时的 message_id 没留下来(buffer 内存态,MediaFile 也无此字段),所以所有现存资源永久走 S3,只有此后新采集走转发。
3. **中转群**:新建专用中转群,所有对外 bot 加入。
4. **抓取时机**:按需(用户首次触发该资源时才抓),与现有 S3 lazy 模式一致,避免集中转发触发 429。

## 硬前提(运维)

- 所有对外 bot 是所有采集频道的成员
- 所有对外 bot 是中转群成员
- **所有采集频道关闭"限制保存内容"(Restrict Saving Content)**,否则 bot 通过 API forward 会被 Telegram 拒(`message can't be forwarded`)

## 数据模型

`MediaFile` 新增两个可空字段:

```prisma
model MediaFile {
  // ... 现有字段
  sourceChatId    BigInt?  // 来源采集频道 chat_id(快照)
  sourceMessageId Int?     // 该 media 在频道里的 message_id(快照)
}
```

- 快照式存在 MediaFile 上,而非靠 `resource.group.channelChatId` 关联——因为资源可被"重设/重新归类"到别的 group,快照不受影响。
- **两个字段都非空 = 可走转发路径;否则走老 S3 路径。**

中转群 id:存 `SystemSetting.relayGroupId`(字符串形态的 BigInt)。后台 UI 后补,先手动写库。

## 采集改动(channel-collector.ts)

- 入库时把 `messageId`(buffer 里已有)+ 频道 `chat_id` 写进 `sourceMessageId` / `sourceChatId`
- **移除** S3 下载上传调用(`uploadMediaToS3InBackground`):不再 getFile、不再下载到 tmp、不再 ffmpeg 缩略图、不再传 S3
- 新资源 `filePath` 存空串 `''`(无 S3 文件);`duration/width/height/thumbnailPath` 留空(发 file_id 时 Telegram 自带,不需要我们存)
- 仍然立即缓存采集 bot 自己的 file_id 到 `BotFileId`(采集 bot 永远缓存命中、秒发)

## 发送解析优先级(sender.ts,核心)

每个 mediaFile 发送时按序解析来源:

1. **缓存命中** `getCachedFileId(botId, mediaFileId)` → 直接用(最快,逻辑不变)
2. 未命中且 **`sourceChatId` + `sourceMessageId` 都非空** → 调 relay 抓 file_id → 缓存 → 用新 id 发
3. relay 失败 **或** 无 message 字段 → **若 `filePath` 以 `s3:` 开头** → 走 S3 下载上传(老路径回退)
4. 都不行 → 该文件发送失败(记录,媒体组按现有逻辑处理)

注意:filePath 为空串 `''` 时不得调用 `resolveLocalPath`;分支必须先判断走哪条路径。

## 新模块 relay-fileid.ts

```
fetchFileIdViaRelay(api, sourceChatId, sourceMessageId, type) → Promise<string | null>
  1. const fwd = await api.forwardMessage(relayGroupId, sourceChatId, sourceMessageId)
  2. const fileId = extractFileId(fwd, type)   // 复用 sender 现有 extractFileId
  3. await api.deleteMessage(relayGroupId, fwd.message_id).catch(ignore)  // 清理中转消息
  4. return fileId(失败返回 null,触发回退)
```

- 串行执行 + 429 retry(读 `retry_after`)
- forwardMessage 单条只转发单条 media(media_group 每条 message 独立 id),返回 Message 含该条 media 的 file_id
- media_group 首发要逐条转发(N 个文件 = N 次 forward + N 次 delete),首次有几秒延迟,之后全部缓存命中

## 向后兼容 / 回退

| 资源类型 | filePath | message 字段 | 发送路径 |
|---|---|---|---|
| 老资源 | `s3:media/…` | 无 | 缓存命中 → S3(不变) |
| 新资源 | `''` | 有 | 缓存命中 → 转发抓取 |
| 新资源转发失败 | `''` | 有 | 无 S3 可回退 → 标错 |

- 老资源行为**完全不变**
- 转发失败:有 S3 就回退,没有就记错误(可在"上传异常列表"类页面查看)

## 风险

- **429 限流**:按需抓取已分散压力,但 media_group 首发逐条转发仍有突发。relay 模块需节流 + retry_after。
- **频道消息删除/频道失效**:无 S3 副本兜底,资源丢失。这是 Telegram-as-storage 的固有 trade-off,用户已接受。
- **bot 未加入频道/中转群**:转发失败 → 回退或标错。运维前提保证。

## 不做(YAGNI)

- 不做预热抓取(按需即可)
- 不做老资源迁移(没有 message_id 可迁)
- 中转群 id 暂不做后台 UI,手动写 SystemSetting
