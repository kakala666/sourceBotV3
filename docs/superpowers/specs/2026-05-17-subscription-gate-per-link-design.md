# 强制订阅范围:Bot → InviteLink 设计

**日期**:2026-05-17
**作者**:lala / Claude
**状态**:Draft,待评审
**关联前作**:`2026-05-13-subscription-gate-design.md`

## 背景

当前强制订阅(`SubscriptionGate`)是 **per-Bot** 配置:同一个 Bot 下的所有 InviteLink 共享同一份"必订频道列表"。运营有时希望不同链接走不同导流——比如 link A 引流到 Channel 1,link B 引流到 Channel 2——但目前只能整 Bot 一刀切。

## 目标

把 `SubscriptionGate` 改为 **per-InviteLink**,每条链接独立配置开关、必订频道列表、提示文案。

## 非目标

- 不改变运行时校验逻辑(每次翻页查 API,无缓存)
- 不动 "kakaco" 频道激活机制(那是另一个独立功能)
- 不删除 `SubscriptionCheckPass` 表(目前已废弃不读不写,保留 schema 不动,清理留作 follow-up)

## 关键决策

| 决策点 | 选择 |
|---|---|
| 现有 Bot 级配置如何处理 | 丢弃,SQL `TRUNCATE` 后由运营重新配 |
| 前端入口位置 | 移到「邀请链接列表」(`/bots/:botId/links`)每行加按钮;Bot 列表行移除按钮 |
| API 路径 | `/api/bots/:botId/subscription-gate/*` → `/api/links/:linkId/subscription-gate/*` |
| handleStart 是否做校验 | 不动,与现有一致(只翻页 callback 校验) |

## 数据模型变更

`packages/server/prisma/schema.prisma`:

```prisma
model Bot {
  // 删除:subscriptionGate SubscriptionGate?
  // 其他不变
}

model InviteLink {
  // 现有字段不变
  subscriptionGate SubscriptionGate?  // 新增反向关系
}

model SubscriptionGate {
  id              Int      @id @default(autoincrement())
  inviteLinkId    Int      @unique  // 原 botId @unique → 改为 inviteLinkId @unique
  isEnabled       Boolean  @default(false)
  promptTemplate  String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  inviteLink InviteLink                @relation(fields: [inviteLinkId], references: [id], onDelete: Cascade)
  channels   SubscriptionGateChannel[]
}

// SubscriptionGateChannel 不变(只关联到 gateId,无需改)
// SubscriptionCheckPass 不变(已废弃,保留 schema)
```

**Cascade**:链接删除 → gate 自动级联删除 → channels 也级联删。

## 后端

### `services/subscription-gate.service.ts`

所有方法第一个入参 `botId: number` → `inviteLinkId: number`。

- `getOrCreate(inviteLinkId)`:`findUnique({ where: { inviteLinkId } })`,不存在则 `create({ data: { inviteLinkId } })`
- `update(inviteLinkId, data)`:类似
- `addChannel(inviteLinkId, inviteUrl, chatIdInput?)`:**需要多一跳查 Bot token**:
  ```ts
  const link = await prisma.inviteLink.findUnique({
    where: { id: inviteLinkId },
    include: { bot: true },
  });
  if (!link) throw new Error('链接不存在');
  // ... 之后用 link.bot.token 调 Telegram API
  ```
- `removeChannel(inviteLinkId, channelId)`:guard 改成 `channel.gate.inviteLinkId !== inviteLinkId` 时拒绝
- `recheckChannel(inviteLinkId, channelId)`:同样

### `routes/subscription-gate.ts`

路径全部从 `/:botId/subscription-gate/*` 改为 `/:linkId/subscription-gate/*`。

`routes/index.ts`:
```ts
// 删除:router.use('/bots', subscriptionGateRouter);
// 新增:router.use('/links', subscriptionGateRouter);
```

挂在 `/links` 不与 `contentsRouter`、`adsRouter` 冲突(它们用 `/:linkId/contents` 和 `/:linkId/ads`)。

## Bot 端

### `services/subscription-check.ts`

- `configCache: Map<number /*inviteLinkId*/, GateConfig>`(语义变化,类型不变)
- `reloadAllGateConfigs()`:`prisma.subscriptionGate.findMany`,把 `g.botId` 改为 `g.inviteLinkId` 作为 map key
- `ensureSubscribed(inviteLinkId, telegramId, botApi)`:第一个参数语义变化
- `getGateConfig(inviteLinkId)`:同上

### `handlers/callback.ts`

四处调用要改入参:
1. `processNextPage`:从 `ensureSubscribed(botId, ...)` 改为 `ensureSubscribed(botUser.inviteLinkId, ...)`
2. `handleSubscriptionRecheck`:同
3. `handleRevealRecheck`:同
4. `reveal` 分支内:同

`getGateConfig(botId)` 调用也跟着改成 `getGateConfig(botUser.inviteLinkId)`。

注意:`botUser.inviteLinkId` 已在 session.botUser 上(`include: { botUser: true }`)。

### `handlers/start.ts`

不动。

## 前端

### `pages/Bots.tsx`

- 移除 `import LockOutlined`(如果是这个按钮专属)
- 移除 `import SubscriptionGateDrawer`
- 移除 `gateDrawer` state
- 移除「🔒 强制订阅」按钮
- 移除 return 末尾的 `<SubscriptionGateDrawer .../>`

### `pages/Links.tsx`

- 加 `import LockOutlined`、`import SubscriptionGateDrawer`
- 加 `gateDrawer` state
- 列「操作」加按钮:`<Button size="small" icon={<LockOutlined/>} onClick={() => setGateDrawer({ open: true, link: record })}>强制订阅</Button>`
- return 末尾加 `<SubscriptionGateDrawer linkId={...} linkName={...} ... />`

### `components/SubscriptionGateDrawer.tsx`

- Props:`botId/botName` → `linkId/linkName`
- 所有 API URL:`/bots/${botId}/...` → `/links/${linkId}/...`
- Drawer title:`强制订阅 — Bot: xxx` → `强制订阅 — 链接: xxx`

## 部署

1. `git push origin main`
2. 服务器 SSH:
   ```bash
   cd /opt/sourceBotV3
   git stash push -- .env ecosystem.config.js
   git pull origin main
   git stash pop

   # 清空旧配置(数据迁移决策)
   set -a; source .env; set +a
   URL=$(echo "$DATABASE_URL" | sed 's/?.*$//')
   psql "$URL" -c 'TRUNCATE "SubscriptionGate", "SubscriptionGateChannel" CASCADE;'

   # 应用 schema
   cd packages/server && npx prisma db push --accept-data-loss
   npx prisma generate

   # 重新 build & restart
   cd /opt/sourceBotV3
   cd packages/shared && pnpm build
   cd ../bot && pnpm build
   cd ../server && pnpm build
   pm2 restart api-server bot-runner --update-env
   ```

## 错误处理 / 边缘情况

| 场景 | 处理 |
|---|---|
| 用户访问的 InviteLink 没配 gate | `configCache.get(linkId)` 为 undefined → `ensureSubscribed` 返回 `{ ok: true }` 放行(同现有"未启用即放行") |
| 已经在频道里的 user 翻页 | 行为不变,因为 ensureSubscribed 调 `getChatMember` 看具体频道 |
| 链接被删除 | DB CASCADE 自动删 gate 和 channels;`.bot-reload` 信号文件不显式发,等 30 秒轮询自然刷新内存缓存(可接受) |
| 链接的 Bot token 失效 | `addChannel` 调 Telegram API 时报错 → 400 返回给前端;运行时 `getChatMember` 失败走现有 classify 错误逻辑 |

## 测试 / 验收

部署后手测:
1. 进 Bot 列表 → 「管理链接」打开 link 列表
2. 任选一条 link 点「强制订阅」→ 抽屉打开,初始 isEnabled=false、频道列表空
3. 启用 + 添加一个合法公开频道(Bot 是管理员的)→ 成功
4. 用一个未订阅该频道的 TG 账号通过该 link 进入 → 翻页时被拦截
5. 同 Bot 的另一条 link 没配,用同一未订阅账号通过它进入 → 翻页放行
6. 验证(SQL):`SELECT COUNT(*) FROM "SubscriptionGate"` 应只有刚配的那一条

## Follow-up(不在本 PR)

- 清理 `SubscriptionCheckPass` 表(目前已废弃,可 drop)
- 如果运营反馈"复制配置"是常见需求,可以加一个「从 link X 复制配置」按钮
