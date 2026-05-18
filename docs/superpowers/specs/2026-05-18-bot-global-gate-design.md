# Bot 全局强制订阅 + Link Fallback 设计

## 背景

当前 `SubscriptionGate` 表 unique on `inviteLinkId`,每条邀请链接独立配置强制订阅。新建链接默认无 gate,机器人不拦截。

需求:**每个 Bot 可以配置一份"全局"主频道/赞助商/触发位置**。如果某条 link **从未创建过** SubscriptionGate 记录,bot 运行时回退用 Bot 全局配置。

## 目标

1. 后台「机器人管理」页给每个 bot 加一个「全局订阅配置」入口,UI 复用现有 `SubscriptionGateDrawer`
2. Bot 运行时 `ensureSubscribed(inviteLinkId, ...)`:
   - 该 link 的 gate 存在(无论 isEnabled 或 channels 是否为空) → **完全按 link 配置走**
   - 该 link 的 gate **不存在** → fall back 到该 link 所属 bot 的 gate
   - 都没有 → 不拦截(行为同当前)

## 非目标

- 不做"link gate 显式选择全局"的 useGlobal 开关(用"是否存在 gate 记录"作为隐式信号)
- 不做"link gate 部分合并 bot gate"(如 link 配 primary,bot 提供 sponsor)— 全有或全无
- 不做后台批量"复制 bot 全局到所有 link"
- 不动现有 `check_sub` / `check_reveal` / 订阅 prompt UI 行为

## Schema 变更

### 新表 `BotSubscriptionGate`

```prisma
model BotSubscriptionGate {
  id               Int      @id @default(autoincrement())
  botId            Int      @unique
  isEnabled        Boolean  @default(false)
  promptTemplate   String?
  sponsorPositions Int[]    @default([])
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  bot      Bot                       @relation(fields: [botId], references: [id], onDelete: Cascade)
  channels SubscriptionGateChannel[]
}
```

字段与现有 `SubscriptionGate` 完全对齐(除 `inviteLinkId` 改为 `botId`)。

### `SubscriptionGateChannel` 加 `botGateId`

```prisma
model SubscriptionGateChannel {
  id          Int      @id @default(autoincrement())
  gateId      Int?     // 改为 nullable(原本 non-null)
  botGateId   Int?     // 新,nullable
  // ... 其余字段不变(kind / isPrivate / username / chatId / title / inviteUrl / sortOrder / status / lastCheckAt / timestamps)

  gate    SubscriptionGate?    @relation(fields: [gateId], references: [id], onDelete: Cascade)
  botGate BotSubscriptionGate? @relation(fields: [botGateId], references: [id], onDelete: Cascade)
}
```

**约束**:`(gateId, botGateId)` 恰好填一个。**Service 层创建/更新 channel 时保证**,Prisma 不直接支持 CHECK,可加一个 raw SQL CHECK constraint 也行;先不加,在 service 入口校验。

### `Bot` 加反向关系

```prisma
model Bot {
  // ... 现有
  subscriptionGate BotSubscriptionGate?
}
```

### 迁移

`prisma db push` additive:
- 新表 `BotSubscriptionGate`
- 新列 `SubscriptionGateChannel.botGateId`
- `SubscriptionGateChannel.gateId` 从 non-null → nullable(allowed)

**注意**:现有数据全部 `gateId` 有值,改 nullable 不影响。`db push --accept-data-loss` 不需要(列变更是 additive)。

## Server

### 新 service `BotSubscriptionGateService`

文件:`packages/server/src/services/bot-subscription-gate.service.ts`

接口镜像现有 `SubscriptionGateService`:
- `getOrCreate(botId)` — 不存在则创建 default-off
- `update(botId, { isEnabled?, promptTemplate? })`
- `addChannel(botId, inviteUrl, chatId?, kind)` — kind ∈ 'primary' | 'sponsor';验证 bot token 是否对该频道有权限(复用 `verifyChannelForBot` / `verifyPrivateChannelForBot`);channel 写入时 `botGateId=gate.id, gateId=null`
- `removeChannel(botId, channelId)` — 同步从 `sponsorPositions` 弹掉(若 sponsor)
- `recheckChannel(botId, channelId)` — 重验
- `updateSponsorPositions(botId, positions)` — 校验严格递增正整数 + 数量 = sponsor 数
- `reorderSponsorChannels(botId, orderedIds)`

**复用逻辑**:几乎与现有 `SubscriptionGateService` 1:1 对应,只是查询/插入用 `botGateId` 而非 `gateId`,以及不需要 inviteLink 反查 bot(直接拿 botId)。考虑提取共享 helper(如 `parseChannelUrl` 已是独立文件)避免重复;若代码差异 < 30%,直接写两份服务、保持各自简洁。

### 新路由

文件:`packages/server/src/routes/bot-subscription-gate.ts`

挂载:`/bots/:botId/subscription-gate`

端点(与 `/links/:linkId/subscription-gate` 一一对应):
- `GET /` — getOrCreate
- `PUT /` — update isEnabled / promptTemplate
- `POST /channels` — addChannel
- `DELETE /channels/:channelId` — removeChannel
- `POST /channels/:channelId/recheck` — recheckChannel
- `PUT /sponsor-positions` — updateSponsorPositions
- `PUT /channels/reorder` — reorderSponsorChannels

每个端点保存成功后调用 `touchReloadSignal()` 通知 bot-runner 重载缓存。

### `serialize(gate)` 复用

新的 `serialize` 与 link 版几乎一致;考虑直接复用旧的 `serialize` 实现(channels 都从 `gate.channels` 取,字段同)。

## Bot 运行时

### `services/subscription-check.ts` 改造

**缓存**:
- 旧:`configCache: Map<inviteLinkId, GateConfig>`
- 新:加 `botGateCache: Map<botId, GateConfig>` 和 `linkToBotMap: Map<inviteLinkId, botId>`

**`reloadAllGateConfigs()`**:
- 先查 `inviteLink.findMany({ select: { id: true, botId: true } })` → 填 `linkToBotMap`
- 然后查 `subscriptionGate.findMany({ include: { channels } })` → 填 link 级 cache
- 再查 `botSubscriptionGate.findMany({ include: { channels } })` → 填 bot 级 cache
- 注意:bot 级 cache 的 channels 关系名也是 `channels`,但底层 join 在 `botGateId` — Prisma 关系自动处理

**`getGateConfig(inviteLinkId)`**:
- 先查 link cache,有就返
- 没有 → 查 `linkToBotMap[inviteLinkId]` 拿 botId,然后查 bot cache,有就返
- 都没有 → undefined

**`ensureSubscribed(inviteLinkId, telegramId, botApi, position?)`** 不变,内部用 `configCache.get(inviteLinkId)`,**改为调用新的 `getGateConfig(inviteLinkId)`** 单点获取(包含 fallback 逻辑)。

### 失效频道 status 写回

现有 `checkChannelMembership` 在 API 错误时把 channel.status 更新到 DB:`prisma.subscriptionGateChannel.update`。**这条 channel 可能属于 bot 级 gate**,update by id 正常工作(channel.id 唯一,与是哪种 gateId 无关),逻辑无需改。

## Client

### `SubscriptionGateDrawer` 加 level prop

```tsx
interface Props {
  level: 'link' | 'bot';
  targetId: number | null;  // linkId 或 botId
  title: string;             // "强制订阅 — 链接: xxx" 或 "全局订阅配置 — bot: xxx"
  open: boolean;
  onClose: () => void;
}
```

内部所有 `api.get/put/post/delete` 的 url 路径前缀根据 level 切换:
- `link` → `/links/${targetId}/subscription-gate...`
- `bot` → `/bots/${targetId}/subscription-gate...`

**仅 url 改动**,response 形状相同,UI/state 不变。

**保留 props 兼容**:把现有 `linkId` / `linkName` 参数 deprecate(或在迁移时把所有 caller 改成 `targetId` / `title` + `level='link'`)。

### `Bots.tsx` 加按钮

每行操作列加一个新按钮「全局订阅配置」(图标 + 文字),onClick 打开 SubscriptionGateDrawer with `level='bot'`,`targetId=bot.id`。

Drawer state 独立(`botGateDrawerOpen`, `selectedBotForGate`)。

## Data Flow(用户主流程)

```
用户 /start jimu 进入
  ↓
ensureSubscribed(inviteLinkId=12, ...)
  ↓
getGateConfig(12)
  ├─ linkGateCache.get(12) 有? → 用之
  └─ 没有 → linkToBotMap[12]=7 → botGateCache.get(7) 有? → 用之
                                  └─ 没有 → undefined → 不拦截
  ↓
若拿到 config:走现有 ensureSubscribed 主频道/赞助商 check 逻辑
```

## 错误处理

| 场景 | 处理 |
|---|---|
| Bot 全局 gate addChannel 时 bot token 失效 | 现有 verifyChannelForBot 抛错,路由 catch 返 400 |
| Bot 全局 channels 与某 link 重复 channel? | 允许(不同 gate id),用户重复订阅同一频道无影响 |
| `linkToBotMap` 加载过程中 inviteLink 被删 | 下一次 reload 自动剔除;过渡期 fallback 拿不到 botGate → 不拦截(安全降级) |
| db push 后旧 channel `gateId IS NOT NULL`,`botGateId IS NULL` | 现有数据兼容 |

## 测试

- 单元测试不强求(订阅链路已有 e2e 手测);可在 `subscription-check.test.ts` 加 fallback case:配置 botGateCache 但没 linkGateCache,验证 `getGateConfig` 返回 bot 级
- 后台 UI 手测 + 端到端手测

## 代码量估算

| 类别 | 行数 |
|---|---|
| schema 改动 | ~25 |
| `bot-subscription-gate.service.ts` 新增 | ~250 |
| `bot-subscription-gate.ts` 路由 | ~120 |
| `subscription-check.ts` 改造(缓存 + getGateConfig) | ~50 |
| `SubscriptionGateDrawer` 改 level prop | ~30 |
| `Bots.tsx` 按钮 + state | ~20 |
| subscription-check 测试加 1 case | ~15 |
| **合计** | **~510 行** |

## 部署 checklist

- [ ] schema 同步:`prisma db push`(additive,无数据迁移)
- [ ] shared(若类型有变化)/ server / bot / client 全部 build
- [ ] PM2 重启 api-server + bot-runner
- [ ] 后台手测:在某个 bot 上配「全局订阅配置」+ 一条新建链接(未单独配 gate)→ 用户 /start 该链接 → 应触发订阅提示
- [ ] 回归手测:旧链接(已配 gate)行为不变

## 已识别风险

1. **同一 channel 同时被 link gate 和 bot gate 添加**:Bot/Telegram 可能短时间收到 2 次 getChatMember,但功能上无问题;UI 不阻止用户重复添加。
2. **`SubscriptionGateChannel.gateId` 改 nullable** 会让旧代码里"channel.gateId 必为 number"假设失效;搜索全代码,主要在 `SubscriptionGateService` 内部,需要确认 prisma 类型变更后 server 编译干净。
3. **bot 删除时**:CASCADE 会带走 `BotSubscriptionGate` → 带走它关联的 channels(botGateId 关系也是 CASCADE)。OK。
