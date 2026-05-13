# 强制订阅功能设计

**日期**:2026-05-13
**作者**:lala / Claude
**状态**:Draft,待评审

## 背景

每个 Telegram Bot 都需要一个开关,允许运营人员配置 N 个公开频道,要求用户必须订阅这些频道后才能在 Bot 内继续翻页浏览资源。这是 Telegram 流量运营常用的引流手段:把进入 Bot 的用户导流到外部频道。

## 目标

1. 管理后台每个 Bot 都可以独立开启"强制订阅",维护必订频道列表。
2. 添加频道时立即校验:解析公开频道链接 → 拿到 `chat_id` → 验证当前 Bot 在该频道为管理员;不通过则配置失败。
3. 强制订阅开启后,用户每天的第一次翻页(callback)前,检查是否订阅了所有配置的频道,任一未订阅则拦截并出现引导提示。
4. 用户点击提示里的"我已完成"重新验证,通过后**自动翻到原本的目标页**,无需用户手动重点翻页按钮。
5. 检查通过的状态当日有效(服务器本地时间 0 点过期),减少 Telegram API 调用。

## 非目标

- 不支持私有频道(`t.me/+xxx`)和群组,本期仅公开频道。
- 不做缓存表的自动清理(后续作为 follow-up)。
- 不做强制订阅相关的统计/报表页(后续)。
- 不改造 `/start` 路径的拦截,仅拦截翻页(与用户原始需求一致)。

## 关键决策摘要

| 决策点 | 选择 | 原因 |
|---|---|---|
| 支持的频道类型 | 仅公开频道 | 私有频道拿不到 `chat_id`,实现复杂度数倍 |
| 多频道判断逻辑 | AND(全部订阅才通过) | 运营常见做法,转化更高 |
| "每天"边界 | 服务器本地时间 0 点 | 实现简单;服务器是 UTC+8,与中国用户体感一致 |
| 验证通过后处理 | 自动翻到目标页 | 已有 callback_data 里就带 `nextIndex`,实现成本低,体验好 |
| 频道失效处理 | 自动跳过该频道 + 后台红色告警 | 鲁棒,避免一个失效频道把所有用户卡住 |
| 提示文案 | 每个 Bot 可自定义模板,留空用默认 | 不同 Bot 调性不同,需要个性化 |
| 当日通过缓存存储 | PostgreSQL `SubscriptionCheckPass` 表 | 与现有架构一致,无新依赖 |
| 链接校验时机 | 配置时同步调 Telegram API | 错误立刻反馈,运行时零额外解析 |

## 架构总览

新增功能分布在三个进程上:

```
┌──────────────────────── 管理员配置 ────────────────────────┐
│                                                          │
│  client (React)                                          │
│    └─ pages/Bots.tsx 新增「强制订阅」按钮                  │
│    └─ components/SubscriptionGateDrawer.tsx 新建抽屉      │
│         · 启用开关、频道列表、自定义提示模板               │
│         │                                                │
│         ▼ /api/bots/:botId/subscription-gate             │
│                                                          │
│  server (Express + Prisma)                               │
│    └─ routes/subscription-gate.ts 新增路由                │
│    └─ services/telegram-channel.ts 新增                  │
│         · 解析链接 → username → chat_id                   │
│         · 校验 Bot 在频道为 administrator                  │
│         · 不通过则 400 返回原因                            │
│    └─ services/bot-reload-signal.ts 新增 (touch          │
│         .bot-reload 文件,bot-runner 在 2 秒内 reload)     │
└──────────────────────────────────────────────────────────┘

┌──────────────────────── 运行时拦截 ────────────────────────┐
│                                                          │
│  bot-runner                                              │
│    └─ services/subscription-check.ts 新增                │
│         · 维护 botId → GateConfig 内存缓存                │
│         · ensureSubscribed(botId, telegramId, botApi)     │
│         · 在 BotManager.loadAllBots 末尾刷新缓存           │
│    └─ services/subscription-prompt.ts 新增               │
│         · 渲染提示消息 (含 inline keyboard)              │
│    └─ handlers/callback.ts 修改                          │
│         · processNextPage 开头调 ensureSubscribed         │
│         · 新增 check_sub:{sessionId}:{nextIndex} 分支     │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 核心数据流

1. 管理员在后台启用 + 添加频道 → server 立即调 Telegram `getChat` + `getChatMember` 校验 → 通过则入库 + 写 `.bot-reload` 信号文件
2. bot-runner 已有的 signal watcher(2 秒轮询)检测到信号 → 调 `loadAllBots()` → 同时刷新 `subscription-check` 的配置缓存
3. 用户翻页(callback `next:sessionId:nextIndex`) → bot-runner 在 `processNextPage` 入口调用 `ensureSubscribed`
4. 缓存命中(`SubscriptionCheckPass` 当日记录存在)→ 直接放行
5. 缓存未命中 → 逐频道 `getChatMember(chatId, userId)` → 全 OK 则写缓存表 → 放行;否则把 missing 列表传给 `sendSubscriptionPrompt`,**不前进**
6. 用户点提示里"我已完成"(callback `check_sub:sessionId:nextIndex`) → 重新 `ensureSubscribed`:
   - 通过 → `answerCallbackQuery('验证通过')` → `deleteMessage` 删提示 → 调用 `processNextPage(sessionId, nextIndex)` 继续翻页
   - 不通过 → `answerCallbackQuery('还有未订阅的频道,请检查后再试', show_alert=true)` → 不删提示

## 数据模型

`packages/server/prisma/schema.prisma` 新增:

```prisma
model Bot {
  // ... 现有字段不变
  subscriptionGate SubscriptionGate?
}

model SubscriptionGate {
  id              Int      @id @default(autoincrement())
  botId           Int      @unique
  isEnabled       Boolean  @default(false)
  promptTemplate  String?  // 留空使用默认模板
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  bot      Bot                       @relation(fields: [botId], references: [id], onDelete: Cascade)
  channels SubscriptionGateChannel[]
}

model SubscriptionGateChannel {
  id          Int      @id @default(autoincrement())
  gateId      Int
  username    String   // 公开频道用户名,不带 @
  chatId      BigInt   // 配置时解析,运行时直接用
  title       String   // 频道标题,提示按钮显示
  inviteUrl   String   // https://t.me/xxx
  sortOrder   Int      @default(0)
  status      String   @default("ok")  // "ok" | "bot_not_admin" | "channel_gone"
  lastCheckAt DateTime @default(now())
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  gate SubscriptionGate @relation(fields: [gateId], references: [id], onDelete: Cascade)

  @@unique([gateId, chatId])
}

model SubscriptionCheckPass {
  id          Int      @id @default(autoincrement())
  botId       Int
  telegramId  BigInt
  passDate    String   // YYYY-MM-DD,服务器本地日期
  passedAt    DateTime @default(now())

  @@unique([botId, telegramId, passDate])
  @@index([passDate])  // 配合未来 cleanup cron(WHERE passDate < today - 7d)
}
```

### 数据模型说明

- `SubscriptionGate` 与 `Bot` **一对一**:即使没启用也可以预存一份记录(默认 `isEnabled=false`),让 UI 始终能编辑。第一次访问后端时如不存在则懒创建。
- `SubscriptionGateChannel.chatId` 用 `BigInt`(Telegram chat_id 可能超 32 位)。
- `SubscriptionCheckPass.passDate` 用字符串(`YYYY-MM-DD`)而非 `DateTime`:配合 `@@unique([botId, telegramId, passDate])` 天然按日去重。日期生成在应用层,**显式按 `Asia/Shanghai` 时区**(服务器是 UTC+8,显式写时区避免后续迁移或本地开发时的 0 点漂移)。例:`new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())`,输出 `YYYY-MM-DD`。
- `SubscriptionCheckPass` 表会快速增长(N 用户 × M 天 × K bot),后续 follow-up 加 cron 清理 `passDate < today - 7d` 的记录。

## 后端 API

挂载在 `/api/bots/:botId/subscription-gate`,所有路由通过 `authMiddleware`(沿用现有认证)。

| Method | Path | 作用 | 失败码 |
|---|---|---|---|
| `GET` | `/` | 拿配置(含频道列表 + 状态) | 404(Bot 不存在) |
| `PUT` | `/` | 更新 `isEnabled` / `promptTemplate` | 404 |
| `POST` | `/channels` | 添加频道(body: `{ inviteUrl }`) | 400(链接非法 / 频道不存在 / Bot 不是管理员)/ 409(频道已存在) |
| `DELETE` | `/channels/:channelId` | 移除频道 | 404 |
| `POST` | `/channels/:channelId/recheck` | 重新验证频道(管理员排障) | 400 |

### 添加频道时的服务器侧校验流程

`services/telegram-channel.ts` 实现:

1. **解析 `inviteUrl`** → 提取 username
   - 接受形式:`@xxx` / `https://t.me/xxx` / `t.me/xxx` / 裸 `xxx`
   - 拒绝形式:`t.me/+xxx`、`t.me/joinchat/xxx`(返回 400 "本期仅支持公开频道")
   - 拒绝形式:含路径如 `t.me/xxx/123`(返回 400 "请输入频道链接,不是消息链接")
2. **取当前 Bot 的 token**,调 `https://api.telegram.org/bot{token}/getChat?chat_id=@{username}`
   - `ok=false` 且 `error_code=400` → 400 "频道不存在或非公开频道"
   - 非 `type=channel` → 400 "目标不是频道"
   - 成功 → 拿到 `chat.id`、`chat.title`、`chat.username`
3. **校验 Bot 自己是管理员**,调 `getChatMember?chat_id={id}&user_id={botSelfId}`
   - `botSelfId` 从一次 `getMe` 拿到后缓存在内存
   - `status !== "administrator"` → 400 "请先把本 Bot 设为该频道的管理员"
4. **校验通过** → 写 `SubscriptionGateChannel`(unique `chatId` 冲突返回 409)
5. **写 `.bot-reload`** 信号文件,bot-runner 在 2 秒内热更配置缓存

### `bot-reload-signal.ts`

将"创建 `.bot-reload`"封装成单一函数。除强制订阅配置变更外,**预留给 token 变更场景复用**(下一个 PR 处理"换 token 不响应"的根治方案)。

## Bot 端运行时逻辑

### `services/subscription-check.ts`

```ts
type GateConfig = {
  isEnabled: boolean;
  promptTemplate: string | null;
  channels: { id: number; chatId: bigint; username: string; title: string; inviteUrl: string; status: string }[];
};

const configCache = new Map<number /*botId*/, GateConfig>();

export async function reloadAllGateConfigs(): Promise<void> {
  // 从 DB 全量加载到 configCache(在 BotManager.loadAllBots 末尾调用)
}

export type CheckResult =
  | { ok: true }
  | { ok: false; missing: { username: string; title: string; inviteUrl: string }[] };

export async function ensureSubscribed(
  botId: number,
  telegramId: bigint,
  botApi: Api
): Promise<CheckResult> {
  const config = configCache.get(botId);
  if (!config?.isEnabled) return { ok: true };

  // 当日缓存命中?
  const today = formatLocalDate(new Date());  // YYYY-MM-DD
  const cached = await prisma.subscriptionCheckPass.findUnique({
    where: { botId_telegramId_passDate: { botId, telegramId, passDate: today } },
  });
  if (cached) return { ok: true };

  // 逐频道检查
  const missing: CheckResult['missing'] = [];
  for (const channel of config.channels) {
    if (channel.status !== 'ok') continue;  // 失效跳过

    try {
      const member = await botApi.getChatMember(channel.chatId.toString(), Number(telegramId));
      if (!['creator', 'administrator', 'member'].includes(member.status)) {
        missing.push({ username: channel.username, title: channel.title, inviteUrl: channel.inviteUrl });
      }
    } catch (err: any) {
      // 区分:Bot 被踢/频道挂 → 标 status 并跳过;偶发 5xx → 仅记日志放过本次检查
      await handleChannelError(channel.id, err);
    }
  }

  if (missing.length === 0) {
    await prisma.subscriptionCheckPass.upsert({
      where: { botId_telegramId_passDate: { botId, telegramId, passDate: today } },
      create: { botId, telegramId, passDate: today },
      update: {},
    });
    return { ok: true };
  }

  return { ok: false, missing };
}
```

### `handlers/callback.ts` 改动

入口分发新增 `check_sub:` 分支:

```ts
const nextMatch = data.match(/^next:(\d+):(\d+)$/);
const checkMatch = data.match(/^check_sub:(\d+):(\d+)$/);

if (checkMatch) {
  await ctx.answerCallbackQuery();
  await handleSubscriptionRecheck(ctx, botId, +checkMatch[1], +checkMatch[2]);
  return;
}
// ... 原 next: 处理
```

`processNextPage` 开头插入拦截:

```ts
async function processNextPage(ctx, botId, sessionId, nextIndex) {
  const session = await prisma.userSession.findUnique({
    where: { id: sessionId },
    include: { botUser: true },
  });
  if (!session || session.isCompleted) return;

  const gateResult = await ensureSubscribed(botId, session.botUser.telegramId, ctx.api);
  if (!gateResult.ok) {
    await sendSubscriptionPrompt(ctx, botId, sessionId, nextIndex, gateResult.missing);
    return;
  }
  // ... 原有翻页 / 广告 / 资源逻辑不变
}
```

`handleSubscriptionRecheck`:

```ts
async function handleSubscriptionRecheck(ctx, botId, sessionId, nextIndex) {
  const session = await prisma.userSession.findUnique({
    where: { id: sessionId },
    include: { botUser: true },
  });
  if (!session) {
    await ctx.answerCallbackQuery({ text: '会话已失效', show_alert: true });
    return;
  }

  const result = await ensureSubscribed(botId, session.botUser.telegramId, ctx.api);
  if (!result.ok) {
    await ctx.answerCallbackQuery({ text: '还有未订阅的频道,请检查后再试', show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery({ text: '✅ 验证通过' });
  await ctx.deleteMessage().catch(() => {});
  await processNextPage(ctx, botId, sessionId, nextIndex);
}
```

### `services/subscription-prompt.ts`

```ts
export async function sendSubscriptionPrompt(
  ctx,
  botId: number,
  sessionId: number,
  nextIndex: number,
  missing: { username: string; title: string; inviteUrl: string }[]
) {
  const config = configCache.get(botId);
  const template = config?.promptTemplate?.trim() ||
    '请先订阅以下频道,然后点击「我已完成」继续:\n{channels}';
  const channelsText = missing.map(c => `• ${c.title} (@${c.username})`).join('\n');
  const text = template.replace('{channels}', channelsText);

  const keyboard = new InlineKeyboard();
  for (const c of missing) {
    keyboard.url(`📢 ${c.title}`, c.inviteUrl).row();
  }
  keyboard.text('✅ 我已完成', `check_sub:${sessionId}:${nextIndex}`);

  await ctx.reply(text, { reply_markup: keyboard });
}
```

### BotManager 集成

`packages/bot/src/manager/bot-manager.ts`:

- `loadAllBots()` 末尾调用 `await reloadAllGateConfigs()` → 配置随 `.bot-reload` 信号一起刷新

## 前端管理后台 UI

入口在 `packages/client/src/pages/Bots.tsx`:每个 Bot 行新增「🔒 强制订阅」按钮,点击打开抽屉(沿用现有 antd Drawer 组件;如未引入则用现有 Modal)。

抽屉组件 `packages/client/src/components/SubscriptionGateDrawer.tsx`:

```
┌─ 强制订阅 — Bot: xxx ────────────────────┐
│                                          │
│  启用强制订阅  [ ◯───● ]   总开关         │
│                                          │
│  ─── 必订频道(全部订阅才通过)──────────  │
│                                          │
│  ┌─ 添加频道 ────────────────────────┐    │
│  │ 输入: @xxx 或 https://t.me/xxx    │    │
│  │ [+ 添加]                          │    │
│  └──────────────────────────────────┘    │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │ 📢 频道标题1                      │    │
│  │    @channel1   ● 正常             │    │
│  │    [移除] [重新验证]              │    │
│  ├──────────────────────────────────┤    │
│  │ 📢 频道标题2                      │    │
│  │    @channel2   ⚠ Bot 不是管理员   │    │
│  │    [移除] [重新验证]              │    │
│  └──────────────────────────────────┘    │
│                                          │
│  ─── 提示文案模板 ──────────────────────  │
│  ┌──────────────────────────────────┐    │
│  │ 请先订阅以下频道后点击「我已完成」 │    │
│  │ 继续:                            │    │
│  │ {channels}                       │    │
│  └──────────────────────────────────┘    │
│  支持占位:{channels} = 频道列表           │
│  留空使用默认模板                          │
│  [保存]                                  │
│                                          │
└──────────────────────────────────────────┘
```

关键 UX:
- 添加频道按钮在请求中变 loading,后端 400 错误 inline 红字显示(例如"请先把本 Bot 设为该频道的管理员")。
- 频道列表的 `status` 字段映射:`ok` → 绿点 + "正常";`bot_not_admin` → 黄/红警告 + "Bot 不是管理员了";`channel_gone` → 红色 + "频道不存在"。
- 总开关 toggle 后立即调 PUT,无需"保存"按钮。
- 提示文案模板有独立"保存"按钮(避免每次输入都打请求)。

## 错误处理 & 边缘情况

| 场景 | 行为 |
|---|---|
| Bot 后来被频道踢出 | 用户翻页时 `getChatMember` 抛 403/400 → catch 后把该频道 `status = 'bot_not_admin'`,该次检查跳过这个频道继续看其他;前端列表红字告警 |
| 频道被删 | 同上,`status = 'channel_gone'` |
| Telegram API 偶发 5xx / 网络抖动 | 在 try/catch 中识别为"非业务错误"(无 `error_code` 或 status >= 500),不修改 channel.status,仅日志 `[gate] api_error`,**该频道本次按通过算**(避免全员被卡) |
| 用户复制旧 callback_data 绕过 | 翻页前必过 `ensureSubscribed`,与 callback_data 无关,无法绕过 |
| 多频道部分失效 | 失效频道自动跳过,只检查 `status === 'ok'` 的;若全部失效 → 全跳过 = 视为通过(避免大面积故障导致服务不可用) |
| 缓存表无限增长 | follow-up 加 cron 删 `passDate < today - 7d`(本 PR 不实现) |
| 配置改动多久生效 | 写 `.bot-reload` → 2 秒内 |
| 提示模板里 `{channels}` 缺失 | 仍然渲染模板原文,频道按钮单独追加在 keyboard 里 |

## 测试策略

| 层 | 类型 | 覆盖 |
|---|---|---|
| `server/services/telegram-channel.ts` | 单元(mock fetch) | 链接解析(@xxx / t.me/xxx / t.me/+xxx 拒绝 / 消息链接拒绝);各种 Telegram 响应(404、非 channel 类型、bot 不是管理员) |
| `server/routes/subscription-gate.ts` | 集成(supertest + 测试 DB,如项目已有) | CRUD + 错误码;同 bot 同频道重复添加返回 409 |
| `bot/services/subscription-check.ts` | 单元(mock Prisma + botApi) | 未启用直通;有缓存直通;一频道未订阅返回 missing;频道失效自动跳过;Bot 被踢标 status;偶发 5xx 放行 |
| `bot/handlers/callback.ts` | 集成(in-memory mock) | 启用 gate + 用户未订阅 → 提示出现,session 不前进;`check_sub` 通过 → deleteMessage + processNextPage 推进 |
| 前端 | 手测 | 添加无效频道立刻红字;启用开关存盘;失效频道显示告警;模板保存 |

测试框架:如果项目已经引入 vitest/jest 使用之;否则只写关键服务的 `node:test` 单测,集成测试本期接受手测。

## 实施顺序建议

1. **DB schema** + Prisma migration
2. **`bot-reload-signal.ts`** + **`telegram-channel.ts`** + 后端路由
3. **`subscription-check.ts`** + **`subscription-prompt.ts`** + callback 拦截
4. **BotManager.loadAllBots reload hook**
5. **前端抽屉组件** + Bot 列表入口
6. 手测全链路:配置 → 用户翻页拦截 → 订阅 → 通过 → 自动续页

## 开放问题

无。已就所有澄清点对齐。

## 后续 follow-up(不在本 PR)

- `SubscriptionCheckPass` 表的 cron 清理任务(7 天前)
- 强制订阅相关统计:每日拦截次数、点击"我已完成"通过率
- 利用 `.bot-reload` 信号封装,实现"改 token 自动重载"(根治先前发现的 BUG)
