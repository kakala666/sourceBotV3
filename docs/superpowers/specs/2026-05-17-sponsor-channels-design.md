# 强制订阅:主频道 vs 广告赞助商 设计

**日期**:2026-05-17
**作者**:lala / Claude
**状态**:Draft,待评审
**关联前作**:`2026-05-17-subscription-gate-per-link-design.md`

## 背景

强制订阅刚改为 per-InviteLink,但所有频道都是"每次翻页都检查"。
运营希望区分两类频道:

- **主频道**(`primary`):每次翻页/展开都检查(现有行为)
- **广告赞助商**(`sponsor`):仅在**指定资源位置**触发检查,且每次只检查**一个**

例:配 3 个赞助商 + 位置 `3, 6, 9`:
- 翻页/展开**第 3** 个资源时,检查赞助商 1
- 翻页/展开**第 6** 个资源时,检查赞助商 2
- 翻页/展开**第 9** 个资源时,检查赞助商 3

主频道始终在背景检查。赞助商仅在位置匹配时叠加。

## 目标

- 频道分两类,UI 与运行时区分处理
- 位置序列严格校验(英文逗号、严格递增、正整数、无空格)
- 添加赞助商时自动追加默认位置(`last + 3`,首个为 3)
- 数量强制一致(赞助商数 == 位置数)

## 非目标

- 不改主频道行为(每次都查)
- 不改"展开校验"流程(订阅提示 + 复核 callback)
- 不动 SubscriptionCheckPass(继续保持废弃)

## 关键决策

| 决策点 | 选择 |
|---|---|
| 数量约束 | 强制 `sponsor_channels.length == sponsorPositions.length` |
| 默认位置 | 加赞助商时 server 自动追加 `last_pos + 3`(空时第一个为 3) |
| 用户手编 | 允许覆盖,保存时校验 |
| 双类同时未订阅 | 合并到同一提示(missing 列表合并) |
| 位置序列存储 | DB 用 `Int[]`;前端用字符串 |

## 触发位置语义

**位置 N 是 1-based 资源编号**。两个 callback 都把它转成"用户视角第几个资源":

- **翻页**(`next:{sid}:{nextIndex}`):用户在第 `nextIndex` 个资源上点了下一页(即将去第 `nextIndex+1` 个)。`position = nextIndex`。
- **展开**(`reveal:{sid}:{currentIndex}`):用户在第 `currentIndex+1` 个资源上点了展开。`position = currentIndex + 1`。

例:`processNextPage(sessionId, 3)` 表示用户在第 3 个资源点了下一页 → `position = 3`。
`processReveal(sessionId, 2)` 表示用户在第 3 个资源点了展开(`currentIndex` 0-based)→ `position = 3`。

## 数据模型变更

`packages/server/prisma/schema.prisma`:

```prisma
model SubscriptionGate {
  // 现有字段不变
  sponsorPositions Int[]  // 触发位置序列 (1-based, 严格递增, 正整数), 默认 []
}

model SubscriptionGateChannel {
  // 现有字段不变
  kind String @default("primary")  // "primary" | "sponsor"
}
```

Postgres `Int[]` 默认值用 `[]`,无破坏性。`kind` 默认 `primary` 让现有频道全部归为主频道,语义不变。

## 后端

### `services/subscription-gate.service.ts`

新增 / 修改:

- `addChannel(inviteLinkId, inviteUrl, chatIdInput?, kind: 'primary' | 'sponsor' = 'primary')`:
  - 把 `kind` 写入 channel
  - 如果 `kind === 'sponsor'`,事务内同时 update gate:`sponsorPositions = [...prev, (last ?? 0) + 3]`,初始第 1 个为 3
- `removeChannel(inviteLinkId, channelId)`:
  - 删 channel 前查 `kind`
  - 如果是 sponsor,找该 channel 在 sponsor 列表中的 index(按 sortOrder),从 `sponsorPositions` 弹出该 index
- `updateSponsorPositions(inviteLinkId, positions: number[])`:新增方法
  - 校验:全正整数、严格递增、长度 == 当前 sponsor channel 数
  - 写回 `sponsorPositions`
- `reorderSponsorChannels(inviteLinkId, orderedIds: number[])`:新增方法
  - 用户拖拽排序后更新 sortOrder
  - 位置序列**不动**(位置按 index 配对,index 由 sortOrder 决定)

### `routes/subscription-gate.ts`

- `POST /links/:linkId/subscription-gate/channels`:body 新增可选 `kind`(默认 `'primary'`)
- 新增 `PUT /links/:linkId/subscription-gate/sponsor-positions`:body `{ positions: number[] }`
- 新增 `PUT /links/:linkId/subscription-gate/channels/reorder`:body `{ orderedIds: number[] }`(用于 sponsor 拖拽)

响应序列化:
- channel 加 `kind` 字段
- gate 加 `sponsorPositions: number[]` 字段

## Bot 端

### `services/subscription-check.ts`

`GateConfig` 类型扩展:
```ts
export interface GateConfig {
  isEnabled: boolean;
  promptTemplate: string | null;
  primaryChannels: ChannelCfg[];   // kind = primary
  sponsorChannels: ChannelCfg[];   // kind = sponsor, 按 sortOrder
  sponsorPositions: number[];      // [3, 6, 9]
}
```

`reloadAllGateConfigs()` 分类填充。

`ensureSubscribed(inviteLinkId, telegramId, botApi, position?: number)`:
1. 取 config,未启用直通
2. 检查所有 `primaryChannels`(同现状)
3. **若 `position` 给定**:
   - 在 `sponsorPositions` 找 `idx = sponsorPositions.indexOf(position)`
   - 若 `idx >= 0` 且 `sponsorChannels[idx]` 存在:检查该 sponsor
4. 合并主 missing + sponsor missing,返回

### `handlers/callback.ts`

四处调用加 `position`:
- `processNextPage`:`ensureSubscribed(..., nextIndex)`
- `reveal` 分支:`ensureSubscribed(..., currentIndex + 1)`
- `handleSubscriptionRecheck`(check_sub 通过后调 processNextPage):`processNextPage` 内部已正确传 position
- `handleRevealRecheck`(check_reveal 通过后调 processReveal):`processReveal` 内部用 `currentIndex + 1`

注意:`handleSubscriptionRecheck` 调 `ensureSubscribed(..., nextIndex)`,与翻页一致。

## 前端

`components/SubscriptionGateDrawer.tsx`:

- 当前「必订频道」区块改名「主频道」(每次都查)
- 新增「广告赞助商」区块:
  - 同结构列表(显示标题、状态 Tag、序号 Tag「位置: N」)
  - 拖拽排序(antd Sortable + dnd-kit,沿用 Contents.tsx 模式)
  - 添加输入(沿用公开/私有 Segmented)
  - 「触发位置」字符串输入框 + 旁注「英文逗号 / 严格递增 / 正整数 / 无空格」
  - 单独「保存位置」按钮
- 「保存位置」前端预校验:
  - 用 `/^[1-9]\d*(,[1-9]\d*)*$/` 校验(无空格、英文逗号、正整数)
  - split + parse → 检查严格递增
  - 长度匹配赞助商数
  - 失败显示红字,不发请求

API 调用:
- 添加频道:`POST /channels` body 含 `kind: 'sponsor'`
- 保存位置:`PUT /sponsor-positions` body `{ positions }`
- 拖拽排序:`PUT /channels/reorder` body `{ orderedIds }`

## 校验规则总结(server 端权威)

`updateSponsorPositions` 校验:
1. 数组中每个值 `> 0`(正整数)
2. 严格递增:`positions[i] < positions[i+1]`
3. 长度 == 当前 sponsor channel 数
4. 不满足任一返回 400 + 错误说明

前端**额外的字符串规则**(英文逗号、无空格)由前端独立校验,server 只接受 `number[]`。

## 部署

1. push
2. 服务器 git pull
3. **prisma db push --accept-data-loss**(加 `kind` + `sponsorPositions` 两列,现有数据自动按 default 填):
   - 所有现有 channel `kind = 'primary'`
   - 所有现有 gate `sponsorPositions = []`
4. prisma generate + 三包 build
5. pm2 restart api-server bot-runner

无数据迁移,无破坏。

## 错误处理 / 边缘情况

| 场景 | 处理 |
|---|---|
| sponsor channel 已加但 `sponsorPositions` 数量不一致(数据异常) | 运行时按 zip 配对,取短者(防御),记日志 |
| 用户配置位置 `9`,但邀请链接资源只有 5 个 | 位置 9 永不触发,运营自责;不报错 |
| 用户保存空位置 `[]` 但已有赞助商 | 校验失败,返回 400 |
| 删最后一个 sponsor | `sponsorPositions` 也清空 |
| 拖拽 sponsor 改顺序 | sortOrder 更新,位置序列不动(位置按 index 配对) |
| 翻页 / 展开时检查抛错(transient) | 沿用现状:仅日志、本次该频道按通过算 |

## 测试 / 验收

部署后手测:
1. 选一条 link,启用强制订阅
2. 加主频道 A(用户必须订阅)
3. 加 3 个赞助商 B、C、D → 位置自动 `[3, 6, 9]`
4. 该 link 内容绑定 ≥ 10 个资源
5. 未订阅任何频道的用户进入 → 翻页第 1 → 拦截(只缺 A)
6. 订阅 A,翻页第 1 → 通过,第 2 → 通过,第 3 → 拦截(缺 B)
7. 订阅 B,翻第 3 通过,第 6 → 拦截(缺 C),... 第 9 → 拦截(缺 D)
8. 第 4、5、7、8 翻页:仅查 A(不查 sponsor)
9. 展开 reveal 同样验证(第 3 展开 → 缺 B,第 4 展开不缺)

## Follow-up(不在本 PR)

- 后台显示赞助商触发统计(哪个位置拦截了多少次)
- 赞助商位置可视化标注资源列表
