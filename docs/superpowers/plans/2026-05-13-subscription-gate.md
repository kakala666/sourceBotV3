# 强制订阅功能 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每个 Bot 可独立配置必订公开频道列表;用户每天首次翻页前校验订阅状态,未订阅则拦截+引导,验证通过后自动续到原目标页。

**Architecture:** 三端协作。Server 端配置时即时校验频道并写 DB,通过 `.bot-reload` 信号文件通知 bot-runner 热更配置缓存。Bot-runner 在 `processNextPage` 入口插入 `ensureSubscribed` 拦截,通过 PG 表做"今日已通过"缓存。前端 antd Drawer 提供配置界面。

**Tech Stack:** TypeScript + Express + Prisma + PostgreSQL + grammy(Telegram SDK) + React + antd v5 + axios。无现成测试框架,纯函数用 `node:test`(脚本式),集成层手测。

**Spec:** `docs/superpowers/specs/2026-05-13-subscription-gate-design.md`

---

## File Structure

**Create:**
- `packages/shared/src/types/subscription-gate.ts` — 接口类型
- `packages/server/src/services/telegram-channel.ts` — 链接解析 + Telegram 校验
- `packages/server/src/services/telegram-channel.test.ts` — node:test 脚本式
- `packages/server/src/services/bot-reload-signal.ts` — 写 .bot-reload
- `packages/server/src/services/subscription-gate.service.ts` — Prisma CRUD
- `packages/server/src/routes/subscription-gate.ts` — Express 路由
- `packages/bot/src/services/local-date.ts` — Asia/Shanghai 日期
- `packages/bot/src/services/local-date.test.ts`
- `packages/bot/src/services/subscription-check.ts` — 主拦截逻辑
- `packages/bot/src/services/subscription-check.test.ts`
- `packages/bot/src/services/subscription-prompt.ts` — 模板渲染 + 发送提示
- `packages/bot/src/services/subscription-prompt.test.ts`
- `packages/client/src/components/SubscriptionGateDrawer.tsx` — 配置抽屉

**Modify:**
- `packages/server/prisma/schema.prisma` — 加 3 个 model
- `packages/shared/src/types/index.ts` — 导出新类型
- `packages/server/src/routes/index.ts` — 挂载新路由
- `packages/bot/src/manager/bot-manager.ts` — `loadAllBots` 末尾刷配置
- `packages/bot/src/handlers/callback.ts` — 入口分发 + processNextPage 拦截 + check_sub 处理
- `packages/client/src/pages/Bots.tsx` — Bot 行新增「强制订阅」按钮

---

## Test Strategy

- **纯函数**(URL 解析、日期格式化、模板渲染):脚本式 `node:test`,运行命令在每个测试任务里写明
- **涉及 Prisma / Telegram API / grammy 的逻辑**:在测试中 mock 相应模块。无 mocking 框架,手写 mock(本项目惯例)
- **集成层**(routes 端到端、callback handler):手测,验收清单在 Task 8

---

## Task 1: DB schema + Prisma migration + shared types

**Files:**
- Modify: `packages/server/prisma/schema.prisma`
- Create: `packages/shared/src/types/subscription-gate.ts`
- Modify: `packages/shared/src/types/index.ts`

- [ ] **Step 1: 在 schema.prisma 末尾追加 3 个 model 并修改 Bot model**

修改 `packages/server/prisma/schema.prisma`:

在 `model Bot` 内的关系部分追加一行:

```prisma
model Bot {
  // ... 现有字段不变
  inviteLinks      InviteLink[]
  fileIds          BotFileId[]
  botUsers         BotUser[]
  subscriptionGate SubscriptionGate?
}
```

文件末尾追加:

```prisma
model SubscriptionGate {
  id              Int      @id @default(autoincrement())
  botId           Int      @unique
  isEnabled       Boolean  @default(false)
  promptTemplate  String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  bot      Bot                       @relation(fields: [botId], references: [id], onDelete: Cascade)
  channels SubscriptionGateChannel[]
}

model SubscriptionGateChannel {
  id          Int      @id @default(autoincrement())
  gateId      Int
  username    String
  chatId      BigInt
  title       String
  inviteUrl   String
  sortOrder   Int      @default(0)
  status      String   @default("ok")
  lastCheckAt DateTime @default(now())
  createdAt   DateTime @default(now())

  gate SubscriptionGate @relation(fields: [gateId], references: [id], onDelete: Cascade)

  @@unique([gateId, chatId])
}

model SubscriptionCheckPass {
  id          Int      @id @default(autoincrement())
  botId       Int
  telegramId  BigInt
  passDate    String
  passedAt    DateTime @default(now())

  @@unique([botId, telegramId, passDate])
  @@index([botId, telegramId])
}
```

- [ ] **Step 2: 生成 Prisma Client(本地无 DB,只生成 client;实际 DB 应用在部署时 db push)**

```bash
cd packages/server && pnpm prisma:generate
```

Expected: 终端打印 `Generated Prisma Client (v6.x.x) ... in ...ms`,无报错。`@prisma/client` 中包含新 model 的类型定义。

注:本项目用 `prisma db push` 流,无 migrations 目录;DB schema 真正应用在 Task 8 的部署步骤里。

- [ ] **Step 3: 创建 shared types**

Create `packages/shared/src/types/subscription-gate.ts`:

```ts
export interface SubscriptionGateInfo {
  id: number;
  botId: number;
  isEnabled: boolean;
  promptTemplate: string | null;
  channels: SubscriptionGateChannelInfo[];
}

export interface SubscriptionGateChannelInfo {
  id: number;
  username: string;
  chatId: string;        // BigInt 序列化为 string
  title: string;
  inviteUrl: string;
  sortOrder: number;
  status: 'ok' | 'bot_not_admin' | 'channel_gone';
  lastCheckAt: string;
}

export interface SubscriptionGateUpdateInput {
  isEnabled?: boolean;
  promptTemplate?: string | null;
}

export interface SubscriptionGateChannelCreateInput {
  inviteUrl: string;
}
```

- [ ] **Step 4: 在 shared types index.ts 导出**

修改 `packages/shared/src/types/index.ts`,在文件末尾添加一行:

```ts
export * from './subscription-gate';
```

- [ ] **Step 5: 验证 shared 构建**

```bash
cd packages/shared && pnpm build
```

Expected: 无报错。如果 shared 没有 build 脚本,跳过 — 验证 server 端能 import 即可:

```bash
cd packages/server && pnpm tsc --noEmit
```

Expected: 无报错。

- [ ] **Step 6: Commit**

```bash
git add packages/server/prisma/schema.prisma \
        packages/shared/src/types/subscription-gate.ts \
        packages/shared/src/types/index.ts
git commit -m "feat(db): add subscription gate models and shared types"
```

---

## Task 2: server - telegram-channel.ts (URL 解析 + Telegram 校验)

**Files:**
- Create: `packages/server/src/services/telegram-channel.ts`
- Create: `packages/server/src/services/telegram-channel.test.ts`

- [ ] **Step 1: 写失败测试 — URL 解析部分**

Create `packages/server/src/services/telegram-channel.test.ts`:

```ts
import { strict as assert } from 'node:assert';
import { parseChannelUrl } from './telegram-channel';

// 接受形式
assert.equal(parseChannelUrl('@xxx').username, 'xxx');
assert.equal(parseChannelUrl('xxx').username, 'xxx');
assert.equal(parseChannelUrl('https://t.me/xxx').username, 'xxx');
assert.equal(parseChannelUrl('http://t.me/xxx').username, 'xxx');
assert.equal(parseChannelUrl('t.me/xxx').username, 'xxx');
assert.equal(parseChannelUrl('  @xxx  ').username, 'xxx');
assert.equal(parseChannelUrl('@a_b_c123').username, 'a_b_c123');

// 拒绝形式
assert.throws(() => parseChannelUrl('https://t.me/+abc123'),    /公开频道/);
assert.throws(() => parseChannelUrl('https://t.me/joinchat/x'), /公开频道/);
assert.throws(() => parseChannelUrl('https://t.me/xxx/123'),    /频道链接/);
assert.throws(() => parseChannelUrl(''),                        /链接为空/);
assert.throws(() => parseChannelUrl('  '),                      /链接为空/);
assert.throws(() => parseChannelUrl('@'),                       /用户名/);

console.log('✓ parseChannelUrl tests passed');
```

- [ ] **Step 2: 运行测试看到失败**

```bash
cd packages/server && npx tsx ./src/services/telegram-channel.test.ts
```

Expected: FAIL with `Cannot find module './telegram-channel'`(因为文件还没创建)。

- [ ] **Step 3: 实现 parseChannelUrl(最小满足)**

Create `packages/server/src/services/telegram-channel.ts`:

```ts
export interface ParsedChannel {
  username: string;
}

export function parseChannelUrl(input: string): ParsedChannel {
  const trimmed = (input ?? '').trim();
  if (!trimmed) throw new Error('链接为空');

  // 拒绝私有邀请链接
  if (/t\.me\/\+/.test(trimmed) || /t\.me\/joinchat\//i.test(trimmed)) {
    throw new Error('本期仅支持公开频道,请提供 @username 或 t.me/username 形式');
  }

  // 提取 username 候选
  let candidate: string;
  if (trimmed.startsWith('@')) {
    candidate = trimmed.slice(1);
  } else if (/^https?:\/\//i.test(trimmed) || /^t\.me\//i.test(trimmed)) {
    const path = trimmed.replace(/^https?:\/\//i, '').replace(/^t\.me\//i, '');
    if (path.includes('/')) {
      throw new Error('请输入频道链接,不要包含消息路径');
    }
    candidate = path;
  } else {
    candidate = trimmed;
  }

  // username 校验:Telegram 规则 5-32,字母数字下划线,字母开头。简化为非空 + 仅合法字符。
  if (!/^[A-Za-z][A-Za-z0-9_]{2,31}$/.test(candidate)) {
    throw new Error('频道用户名格式不合法');
  }

  return { username: candidate };
}
```

- [ ] **Step 4: 运行测试看到通过**

```bash
cd packages/server && npx tsx ./src/services/telegram-channel.test.ts
```

Expected: `✓ parseChannelUrl tests passed`。

- [ ] **Step 5: 加 verifyChannelForBot(mock fetch 测试)**

在 `telegram-channel.test.ts` 末尾追加:

```ts
import { verifyChannelForBot } from './telegram-channel';

// Mock fetch
const originalFetch = globalThis.fetch;
function mockFetch(handler: (url: string) => any) {
  globalThis.fetch = (async (url: any) => ({
    json: async () => handler(String(url)),
  })) as any;
}
function restore() { globalThis.fetch = originalFetch; }

// case 1: 完整成功
mockFetch((url) => {
  if (url.includes('/getMe')) return { ok: true, result: { id: 100, username: 'mybot' } };
  if (url.includes('/getChat')) return {
    ok: true,
    result: { id: -1001, type: 'channel', title: 'My Channel', username: 'mychan' },
  };
  if (url.includes('/getChatMember')) return {
    ok: true,
    result: { status: 'administrator', user: { id: 100 } },
  };
  return { ok: false };
});

const result = await verifyChannelForBot('TOKEN', 'mychan');
assert.equal(result.chatId, '-1001');
assert.equal(result.title, 'My Channel');
assert.equal(result.username, 'mychan');
restore();

// case 2: 频道不存在
mockFetch((url) => {
  if (url.includes('/getMe')) return { ok: true, result: { id: 100 } };
  return { ok: false, error_code: 400, description: 'chat not found' };
});
await assert.rejects(verifyChannelForBot('TOKEN', 'nope'), /频道不存在/);
restore();

// case 3: 非频道(群组)
mockFetch((url) => {
  if (url.includes('/getMe')) return { ok: true, result: { id: 100 } };
  if (url.includes('/getChat')) return { ok: true, result: { id: -100, type: 'supergroup', title: 'g' } };
  return { ok: false };
});
await assert.rejects(verifyChannelForBot('TOKEN', 'gg'), /不是频道/);
restore();

// case 4: Bot 不是管理员
mockFetch((url) => {
  if (url.includes('/getMe')) return { ok: true, result: { id: 100 } };
  if (url.includes('/getChat')) return { ok: true, result: { id: -1, type: 'channel', title: 't', username: 'u' } };
  if (url.includes('/getChatMember')) return { ok: true, result: { status: 'member' } };
  return { ok: false };
});
await assert.rejects(verifyChannelForBot('TOKEN', 'u'), /管理员/);
restore();

console.log('✓ verifyChannelForBot tests passed');
```

- [ ] **Step 6: 运行测试看到失败**

```bash
cd packages/server && npx tsx ./src/services/telegram-channel.test.ts
```

Expected: FAIL on `verifyChannelForBot` export missing。

- [ ] **Step 7: 实现 verifyChannelForBot**

追加到 `packages/server/src/services/telegram-channel.ts`:

```ts
export interface VerifiedChannel {
  chatId: string;     // 序列化为字符串
  title: string;
  username: string;
}

interface TgResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
}

async function callTg<T>(token: string, method: string, params: Record<string, any>): Promise<TgResponse<T>> {
  const qs = new URLSearchParams(
    Object.entries(params).reduce<Record<string, string>>((acc, [k, v]) => {
      acc[k] = String(v);
      return acc;
    }, {})
  );
  const url = `https://api.telegram.org/bot${token}/${method}?${qs}`;
  const res = await fetch(url);
  return (await res.json()) as TgResponse<T>;
}

export async function verifyChannelForBot(botToken: string, username: string): Promise<VerifiedChannel> {
  // 1. getMe 拿 bot 自己的 id
  const me = await callTg<{ id: number }>(botToken, 'getMe', {});
  if (!me.ok || !me.result) throw new Error('Bot Token 无效');
  const botId = me.result.id;

  // 2. getChat 验证频道存在 + 类型
  const chat = await callTg<{ id: number; type: string; title?: string; username?: string }>(
    botToken,
    'getChat',
    { chat_id: `@${username}` }
  );
  if (!chat.ok || !chat.result) {
    throw new Error('频道不存在或非公开频道');
  }
  if (chat.result.type !== 'channel') {
    throw new Error('目标不是频道(本期仅支持频道)');
  }

  // 3. getChatMember 验证 Bot 是管理员
  const member = await callTg<{ status: string }>(botToken, 'getChatMember', {
    chat_id: chat.result.id,
    user_id: botId,
  });
  if (!member.ok || !member.result) {
    throw new Error('无法查询 Bot 在频道的成员状态');
  }
  if (member.result.status !== 'administrator' && member.result.status !== 'creator') {
    throw new Error('请先把本 Bot 设为该频道的管理员');
  }

  return {
    chatId: String(chat.result.id),
    title: chat.result.title || username,
    username: chat.result.username || username,
  };
}
```

- [ ] **Step 8: 运行测试看到全通过**

```bash
cd packages/server && npx tsx ./src/services/telegram-channel.test.ts
```

Expected: 两行 `✓ ... tests passed`。

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/services/telegram-channel.ts packages/server/src/services/telegram-channel.test.ts
git commit -m "feat(server): add telegram-channel parsing and verification"
```

---

## Task 3: server - bot-reload-signal.ts + SubscriptionGateService + 路由

**Files:**
- Create: `packages/server/src/services/bot-reload-signal.ts`
- Create: `packages/server/src/services/subscription-gate.service.ts`
- Create: `packages/server/src/routes/subscription-gate.ts`
- Modify: `packages/server/src/routes/index.ts`

- [ ] **Step 1: 创建 bot-reload-signal.ts**

Create `packages/server/src/services/bot-reload-signal.ts`:

```ts
import fs from 'fs';
import path from 'path';

const SIGNAL_FILE = path.resolve(__dirname, '../../../../.bot-reload');

export function touchReloadSignal(): void {
  try {
    fs.writeFileSync(SIGNAL_FILE, String(Date.now()));
  } catch (err: any) {
    console.error('[bot-reload-signal] 写信号文件失败:', err.message);
  }
}
```

- [ ] **Step 2: 创建 SubscriptionGateService**

Create `packages/server/src/services/subscription-gate.service.ts`:

```ts
import prisma from './prisma';
import { BotService } from './bot.service';
import { verifyChannelForBot, parseChannelUrl } from './telegram-channel';

export class SubscriptionGateService {
  /** 拿配置;不存在则懒创建一个 default-off 记录返回 */
  static async getOrCreate(botId: number) {
    let gate = await prisma.subscriptionGate.findUnique({
      where: { botId },
      include: { channels: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!gate) {
      gate = await prisma.subscriptionGate.create({
        data: { botId },
        include: { channels: true },
      });
    }
    return gate;
  }

  static async update(botId: number, data: { isEnabled?: boolean; promptTemplate?: string | null }) {
    await this.getOrCreate(botId);
    return prisma.subscriptionGate.update({
      where: { botId },
      data,
      include: { channels: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  static async addChannel(botId: number, inviteUrl: string) {
    const bot = await prisma.bot.findUnique({ where: { id: botId } });
    if (!bot) throw new Error('Bot 不存在');

    const { username } = parseChannelUrl(inviteUrl);
    const verified = await verifyChannelForBot(bot.token, username);

    const gate = await this.getOrCreate(botId);

    const maxSort = await prisma.subscriptionGateChannel.aggregate({
      where: { gateId: gate.id },
      _max: { sortOrder: true },
    });

    return prisma.subscriptionGateChannel.create({
      data: {
        gateId: gate.id,
        username: verified.username,
        chatId: BigInt(verified.chatId),
        title: verified.title,
        inviteUrl: `https://t.me/${verified.username}`,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
        status: 'ok',
      },
    });
  }

  static async removeChannel(botId: number, channelId: number) {
    const channel = await prisma.subscriptionGateChannel.findUnique({
      where: { id: channelId },
      include: { gate: true },
    });
    if (!channel || channel.gate.botId !== botId) throw new Error('频道不存在');
    await prisma.subscriptionGateChannel.delete({ where: { id: channelId } });
  }

  static async recheckChannel(botId: number, channelId: number) {
    const channel = await prisma.subscriptionGateChannel.findUnique({
      where: { id: channelId },
      include: { gate: true },
    });
    if (!channel || channel.gate.botId !== botId) throw new Error('频道不存在');

    const bot = await prisma.bot.findUnique({ where: { id: botId } });
    if (!bot) throw new Error('Bot 不存在');

    try {
      const verified = await verifyChannelForBot(bot.token, channel.username);
      return prisma.subscriptionGateChannel.update({
        where: { id: channelId },
        data: {
          chatId: BigInt(verified.chatId),
          title: verified.title,
          status: 'ok',
          lastCheckAt: new Date(),
        },
      });
    } catch (err: any) {
      // 标失效;仍更新 lastCheckAt
      const msg: string = err.message || '';
      const status = msg.includes('管理员') ? 'bot_not_admin' : 'channel_gone';
      return prisma.subscriptionGateChannel.update({
        where: { id: channelId },
        data: { status, lastCheckAt: new Date() },
      });
    }
  }
}
```

- [ ] **Step 3: 创建路由**

Create `packages/server/src/routes/subscription-gate.ts`:

```ts
import { Router, type IRouter } from 'express';
import { SubscriptionGateService } from '../services/subscription-gate.service';
import { touchReloadSignal } from '../services/bot-reload-signal';
import { authMiddleware } from '../middleware/auth';
import { success, fail } from '../utils/response';

const router: IRouter = Router();
router.use(authMiddleware);

// 序列化辅助:BigInt → string
function serialize(gate: any) {
  return {
    id: gate.id,
    botId: gate.botId,
    isEnabled: gate.isEnabled,
    promptTemplate: gate.promptTemplate,
    channels: (gate.channels ?? []).map((c: any) => ({
      id: c.id,
      username: c.username,
      chatId: c.chatId.toString(),
      title: c.title,
      inviteUrl: c.inviteUrl,
      sortOrder: c.sortOrder,
      status: c.status,
      lastCheckAt: c.lastCheckAt,
    })),
  };
}

router.get('/:botId/subscription-gate', async (req, res) => {
  try {
    const botId = parseInt(req.params.botId);
    const gate = await SubscriptionGateService.getOrCreate(botId);
    return success(res, serialize(gate));
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

router.put('/:botId/subscription-gate', async (req, res) => {
  try {
    const botId = parseInt(req.params.botId);
    const { isEnabled, promptTemplate } = req.body ?? {};
    const data: any = {};
    if (typeof isEnabled === 'boolean') data.isEnabled = isEnabled;
    if (promptTemplate !== undefined) {
      data.promptTemplate = typeof promptTemplate === 'string' && promptTemplate.trim()
        ? promptTemplate.trim()
        : null;
    }
    const gate = await SubscriptionGateService.update(botId, data);
    touchReloadSignal();
    return success(res, serialize(gate));
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

router.post('/:botId/subscription-gate/channels', async (req, res) => {
  try {
    const botId = parseInt(req.params.botId);
    const { inviteUrl } = req.body ?? {};
    if (!inviteUrl) return fail(res, '请提供 inviteUrl', 400);
    await SubscriptionGateService.addChannel(botId, inviteUrl);
    touchReloadSignal();
    const gate = await SubscriptionGateService.getOrCreate(botId);
    return success(res, serialize(gate), 201);
  } catch (err: any) {
    if (err.code === 'P2002') return fail(res, '该频道已添加', 409);
    return fail(res, err.message, 400);
  }
});

router.delete('/:botId/subscription-gate/channels/:channelId', async (req, res) => {
  try {
    const botId = parseInt(req.params.botId);
    const channelId = parseInt(req.params.channelId);
    await SubscriptionGateService.removeChannel(botId, channelId);
    touchReloadSignal();
    return success(res);
  } catch (err: any) {
    return fail(res, err.message, 404);
  }
});

router.post('/:botId/subscription-gate/channels/:channelId/recheck', async (req, res) => {
  try {
    const botId = parseInt(req.params.botId);
    const channelId = parseInt(req.params.channelId);
    const channel = await SubscriptionGateService.recheckChannel(botId, channelId);
    touchReloadSignal();
    return success(res, {
      id: channel.id,
      status: channel.status,
      title: channel.title,
      lastCheckAt: channel.lastCheckAt,
    });
  } catch (err: any) {
    return fail(res, err.message, 400);
  }
});

export default router;
```

- [ ] **Step 4: 在 routes/index.ts 挂载**

修改 `packages/server/src/routes/index.ts`,在 import 区追加:

```ts
import subscriptionGateRouter from './subscription-gate';
```

在 router 挂载区追加(放在 `botsRouter` / `linksRouter` 同组下面):

```ts
router.use('/bots', subscriptionGateRouter);
```

- [ ] **Step 5: 类型检查 + 服务端冒烟**

```bash
cd packages/server && pnpm tsc --noEmit
```

Expected: 无报错。

```bash
cd packages/server && pnpm dev &
sleep 3
curl -s http://localhost:3000/api/bots/1/subscription-gate -H "Authorization: Bearer $(node -e "console.log(require('jsonwebtoken').sign({adminId:1},process.env.JWT_SECRET||'dev'))")"
```

Expected: JSON 返回 `{"success":true,"data":{"id":...,"botId":1,"isEnabled":false,"promptTemplate":null,"channels":[]}}`。

如果没启 server,这一步跳到 Task 8 的手测里一起做。

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/bot-reload-signal.ts \
        packages/server/src/services/subscription-gate.service.ts \
        packages/server/src/routes/subscription-gate.ts \
        packages/server/src/routes/index.ts
git commit -m "feat(server): subscription gate routes and CRUD service"
```

---

## Task 4: bot - local-date.ts + subscription-check.ts

**Files:**
- Create: `packages/bot/src/services/local-date.ts`
- Create: `packages/bot/src/services/local-date.test.ts`
- Create: `packages/bot/src/services/subscription-check.ts`
- Create: `packages/bot/src/services/subscription-check.test.ts`

- [ ] **Step 1: 写日期测试**

Create `packages/bot/src/services/local-date.test.ts`:

```ts
import { strict as assert } from 'node:assert';
import { formatShanghaiDate } from './local-date';

// 一个具体时刻:UTC 2026-05-13 15:30 → 上海时间 2026-05-13 23:30
assert.equal(formatShanghaiDate(new Date('2026-05-13T15:30:00Z')), '2026-05-13');

// UTC 17:00 → 上海 01:00 第二天
assert.equal(formatShanghaiDate(new Date('2026-05-13T17:00:00Z')), '2026-05-14');

// 跨年:UTC 2025-12-31 16:00 → 上海 2026-01-01 00:00
assert.equal(formatShanghaiDate(new Date('2025-12-31T16:00:00Z')), '2026-01-01');

console.log('✓ formatShanghaiDate tests passed');
```

- [ ] **Step 2: 看测试失败**

```bash
cd packages/bot && npx tsx ./src/services/local-date.test.ts
```

Expected: FAIL on missing module。

- [ ] **Step 3: 实现 local-date.ts**

Create `packages/bot/src/services/local-date.ts`:

```ts
/** 格式化为 Asia/Shanghai 时区下的 YYYY-MM-DD */
export function formatShanghaiDate(d: Date = new Date()): string {
  // 'en-CA' locale 的日期格式天然就是 YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
```

- [ ] **Step 4: 看测试通过**

```bash
cd packages/bot && npx tsx ./src/services/local-date.test.ts
```

Expected: `✓ formatShanghaiDate tests passed`。

- [ ] **Step 5: 写 subscription-check 失败测试**

Create `packages/bot/src/services/subscription-check.test.ts`:

```ts
import { strict as assert } from 'node:assert';
import { ensureSubscribed, _setCacheForTests, _setPrismaForTests } from './subscription-check';

type ChannelCfg = { id: number; chatId: bigint; username: string; title: string; inviteUrl: string; status: string };

function makeBotApi(memberStatuses: Record<string, string | Error>) {
  return {
    async getChatMember(chatId: string, userId: number) {
      const key = `${chatId}:${userId}`;
      const v = memberStatuses[key];
      if (v instanceof Error) throw v;
      return { status: v ?? 'left' };
    },
  } as any;
}

let prismaPass: any[] = [];
let prismaChannelUpdates: any[] = [];
const fakePrisma = {
  subscriptionCheckPass: {
    findUnique: async ({ where }: any) =>
      prismaPass.find((p) =>
        p.botId === where.botId_telegramId_passDate.botId &&
        p.telegramId === where.botId_telegramId_passDate.telegramId &&
        p.passDate === where.botId_telegramId_passDate.passDate
      ) ?? null,
    upsert: async ({ where, create }: any) => {
      prismaPass.push(create);
      return create;
    },
  },
  subscriptionGateChannel: {
    update: async ({ where, data }: any) => {
      prismaChannelUpdates.push({ id: where.id, data });
    },
  },
};

_setPrismaForTests(fakePrisma);

// case 1: gate 未启用 → ok
_setCacheForTests(new Map([[1, { isEnabled: false, promptTemplate: null, channels: [] }]]));
let r = await ensureSubscribed(1, 100n, makeBotApi({}));
assert.equal(r.ok, true);

// case 2: 启用 + 用户已订阅唯一频道 → ok 并写入缓存
prismaPass = [];
const channels: ChannelCfg[] = [
  { id: 11, chatId: -1001n, username: 'c1', title: 'C1', inviteUrl: 'https://t.me/c1', status: 'ok' },
];
_setCacheForTests(new Map([[2, { isEnabled: true, promptTemplate: null, channels }]]));
r = await ensureSubscribed(2, 200n, makeBotApi({ '-1001:200': 'member' }));
assert.equal(r.ok, true);
assert.equal(prismaPass.length, 1);
assert.equal(prismaPass[0].botId, 2);

// case 3: 启用 + 缓存命中 → ok 不调 API
prismaPass = [{ botId: 2, telegramId: 200n, passDate: new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date()) }];
let apiCalled = false;
const spyApi = { async getChatMember() { apiCalled = true; return { status: 'member' }; } } as any;
r = await ensureSubscribed(2, 200n, spyApi);
assert.equal(r.ok, true);
assert.equal(apiCalled, false);

// case 4: 一频道未订阅 → 返回 missing
prismaPass = [];
r = await ensureSubscribed(2, 300n, makeBotApi({ '-1001:300': 'left' }));
assert.equal(r.ok, false);
if (!r.ok) {
  assert.equal(r.missing.length, 1);
  assert.equal(r.missing[0].username, 'c1');
}

// case 5: API 抛权限错误 → 标 channel status 并跳过(本次检查算通过,因为该频道被跳)
prismaPass = [];
prismaChannelUpdates = [];
const permError: any = new Error('Forbidden: bot is not a member');
r = await ensureSubscribed(2, 400n, makeBotApi({ '-1001:400': permError }));
// 只有一个频道,失效后视为通过(全部失效兜底)
assert.equal(r.ok, true);
assert.equal(prismaChannelUpdates.length, 1);
assert.equal(prismaChannelUpdates[0].data.status, 'bot_not_admin');

// case 6: status !== 'ok' 的频道直接跳过(不调 API)
prismaPass = [];
const channels2: ChannelCfg[] = [
  { id: 12, chatId: -2n, username: 'dead', title: 'D', inviteUrl: 'x', status: 'bot_not_admin' },
  { id: 13, chatId: -3n, username: 'live', title: 'L', inviteUrl: 'y', status: 'ok' },
];
_setCacheForTests(new Map([[3, { isEnabled: true, promptTemplate: null, channels: channels2 }]]));
r = await ensureSubscribed(3, 500n, makeBotApi({ '-3:500': 'member' }));
assert.equal(r.ok, true);

console.log('✓ ensureSubscribed tests passed');
```

- [ ] **Step 6: 看测试失败**

```bash
cd packages/bot && npx tsx ./src/services/subscription-check.test.ts
```

Expected: FAIL on missing module。

- [ ] **Step 7: 实现 subscription-check.ts**

Create `packages/bot/src/services/subscription-check.ts`:

```ts
import type { Api } from 'grammy';
import realPrisma from '../prisma';
import { formatShanghaiDate } from './local-date';

export interface ChannelCfg {
  id: number;
  chatId: bigint;
  username: string;
  title: string;
  inviteUrl: string;
  status: string;  // 'ok' | 'bot_not_admin' | 'channel_gone'
}

export interface GateConfig {
  isEnabled: boolean;
  promptTemplate: string | null;
  channels: ChannelCfg[];
}

export type CheckResult =
  | { ok: true }
  | { ok: false; missing: { username: string; title: string; inviteUrl: string }[] };

// 进程内配置缓存,key=botId
let configCache = new Map<number, GateConfig>();
let prismaRef: any = realPrisma;

/** 仅供测试使用 */
export function _setCacheForTests(c: Map<number, GateConfig>) { configCache = c; }
/** 仅供测试使用 */
export function _setPrismaForTests(p: any) { prismaRef = p; }

export async function reloadAllGateConfigs(): Promise<void> {
  const gates = await prismaRef.subscriptionGate.findMany({
    include: { channels: { orderBy: { sortOrder: 'asc' } } },
  });
  const next = new Map<number, GateConfig>();
  for (const g of gates) {
    next.set(g.botId, {
      isEnabled: g.isEnabled,
      promptTemplate: g.promptTemplate,
      channels: g.channels.map((c: any) => ({
        id: c.id,
        chatId: c.chatId,
        username: c.username,
        title: c.title,
        inviteUrl: c.inviteUrl,
        status: c.status,
      })),
    });
  }
  configCache = next;
}

export function getGateConfig(botId: number): GateConfig | undefined {
  return configCache.get(botId);
}

function isMember(status: string): boolean {
  return status === 'creator' || status === 'administrator' || status === 'member';
}

function classifyApiError(err: any): 'bot_not_admin' | 'channel_gone' | 'transient' {
  const msg: string = (err?.message || '').toLowerCase();
  if (msg.includes('not a member') || msg.includes('forbidden') || msg.includes('bot is not')) return 'bot_not_admin';
  if (msg.includes('chat not found') || msg.includes('chat_not_found')) return 'channel_gone';
  return 'transient';
}

export async function ensureSubscribed(botId: number, telegramId: bigint, botApi: Api): Promise<CheckResult> {
  const config = configCache.get(botId);
  if (!config?.isEnabled) return { ok: true };

  const today = formatShanghaiDate();

  // 缓存命中?
  const cached = await prismaRef.subscriptionCheckPass.findUnique({
    where: { botId_telegramId_passDate: { botId, telegramId, passDate: today } },
  });
  if (cached) return { ok: true };

  const missing: { username: string; title: string; inviteUrl: string }[] = [];
  let activeChannels = 0;

  for (const channel of config.channels) {
    if (channel.status !== 'ok') continue;
    activeChannels++;

    try {
      const member = await botApi.getChatMember(channel.chatId.toString(), Number(telegramId));
      if (!isMember(member.status)) {
        missing.push({ username: channel.username, title: channel.title, inviteUrl: channel.inviteUrl });
      }
    } catch (err: any) {
      const kind = classifyApiError(err);
      if (kind === 'transient') {
        // 偶发错误:仅日志,本次该频道按通过算(避免全员被卡)
        console.error(`[gate] api_error botId=${botId} channelId=${channel.id} err=${err.message}`);
      } else {
        // 标失效 + 内存缓存同步
        channel.status = kind;
        await prismaRef.subscriptionGateChannel.update({
          where: { id: channel.id },
          data: { status: kind, lastCheckAt: new Date() },
        });
        activeChannels--;
      }
    }
  }

  if (missing.length === 0) {
    await prismaRef.subscriptionCheckPass.upsert({
      where: { botId_telegramId_passDate: { botId, telegramId, passDate: today } },
      create: { botId, telegramId, passDate: today },
      update: {},
    });
    return { ok: true };
  }

  return { ok: false, missing };
}
```

- [ ] **Step 8: 看测试通过**

```bash
cd packages/bot && npx tsx ./src/services/subscription-check.test.ts
```

Expected: `✓ ensureSubscribed tests passed`。

- [ ] **Step 9: Commit**

```bash
git add packages/bot/src/services/local-date.ts \
        packages/bot/src/services/local-date.test.ts \
        packages/bot/src/services/subscription-check.ts \
        packages/bot/src/services/subscription-check.test.ts
git commit -m "feat(bot): add subscription check service with daily cache"
```

---

## Task 5: bot - subscription-prompt.ts

**Files:**
- Create: `packages/bot/src/services/subscription-prompt.ts`
- Create: `packages/bot/src/services/subscription-prompt.test.ts`

- [ ] **Step 1: 写模板渲染测试**

Create `packages/bot/src/services/subscription-prompt.test.ts`:

```ts
import { strict as assert } from 'node:assert';
import { renderPromptText, buildPromptKeyboard } from './subscription-prompt';

const missing = [
  { username: 'a', title: 'Channel A', inviteUrl: 'https://t.me/a' },
  { username: 'b', title: 'Channel B', inviteUrl: 'https://t.me/b' },
];

// 默认模板
const def = renderPromptText(null, missing);
assert.match(def, /请先订阅以下频道/);
assert.match(def, /Channel A/);
assert.match(def, /@a/);
assert.match(def, /Channel B/);

// 自定义模板带占位
const custom = renderPromptText('Hi! Please join:\n{channels}\nThanks', missing);
assert.match(custom, /^Hi! Please join:/);
assert.match(custom, /Channel A/);
assert.match(custom, /Thanks$/);

// 自定义模板无占位 — 渲染原文(频道仅出现在 keyboard 里)
const noPlaceholder = renderPromptText('Subscribe first.', missing);
assert.equal(noPlaceholder, 'Subscribe first.');

// keyboard 包含频道按钮 + 我已完成按钮
const kb = buildPromptKeyboard(missing, 99, 5);
const rows = kb.inline_keyboard;
assert.equal(rows.length, 3);  // 2 channels + 1 done
assert.equal((rows[0][0] as any).text, '📢 Channel A');
assert.equal((rows[0][0] as any).url, 'https://t.me/a');
assert.equal((rows[2][0] as any).text, '✅ 我已完成');
assert.equal((rows[2][0] as any).callback_data, 'check_sub:99:5');

console.log('✓ subscription-prompt tests passed');
```

- [ ] **Step 2: 看测试失败**

```bash
cd packages/bot && npx tsx ./src/services/subscription-prompt.test.ts
```

Expected: FAIL on missing module。

- [ ] **Step 3: 实现 subscription-prompt.ts**

Create `packages/bot/src/services/subscription-prompt.ts`:

```ts
import { InlineKeyboard, type Context } from 'grammy';

export interface MissingChannel {
  username: string;
  title: string;
  inviteUrl: string;
}

const DEFAULT_TEMPLATE = '请先订阅以下频道,然后点击「我已完成」继续:\n{channels}';

export function renderPromptText(template: string | null | undefined, missing: MissingChannel[]): string {
  const tpl = template?.trim() || DEFAULT_TEMPLATE;
  const channelsText = missing.map((c) => `• ${c.title} (@${c.username})`).join('\n');
  return tpl.replace('{channels}', channelsText);
}

export function buildPromptKeyboard(
  missing: MissingChannel[],
  sessionId: number,
  nextIndex: number
): { inline_keyboard: any[][] } {
  const kb = new InlineKeyboard();
  for (const c of missing) {
    kb.url(`📢 ${c.title}`, c.inviteUrl).row();
  }
  kb.text('✅ 我已完成', `check_sub:${sessionId}:${nextIndex}`);
  return kb as unknown as { inline_keyboard: any[][] };
}

export async function sendSubscriptionPrompt(
  ctx: Context,
  template: string | null | undefined,
  sessionId: number,
  nextIndex: number,
  missing: MissingChannel[]
) {
  const text = renderPromptText(template, missing);
  const reply_markup = buildPromptKeyboard(missing, sessionId, nextIndex);
  await ctx.reply(text, { reply_markup: reply_markup as any });
}
```

- [ ] **Step 4: 看测试通过**

```bash
cd packages/bot && npx tsx ./src/services/subscription-prompt.test.ts
```

Expected: `✓ subscription-prompt tests passed`。

- [ ] **Step 5: Commit**

```bash
git add packages/bot/src/services/subscription-prompt.ts packages/bot/src/services/subscription-prompt.test.ts
git commit -m "feat(bot): render subscription prompt with channel buttons"
```

---

## Task 6: bot - callback handler 集成 + BotManager 钩子

**Files:**
- Modify: `packages/bot/src/handlers/callback.ts`
- Modify: `packages/bot/src/manager/bot-manager.ts`

- [ ] **Step 1: 改 callback.ts — 入口分发 + processNextPage 拦截 + 新增 handleSubscriptionRecheck**

修改 `packages/bot/src/handlers/callback.ts`。

在顶部 import 区追加:

```ts
import { ensureSubscribed, getGateConfig } from '../services/subscription-check';
import { sendSubscriptionPrompt } from '../services/subscription-prompt';
```

把 `handleCallback` 函数替换为(保留防重复点击的核心结构,新增 check_sub 分支):

```ts
export async function handleCallback(ctx: Context, botId: number) {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  // 新增:订阅校验回调
  const checkMatch = data.match(/^check_sub:(\d+):(\d+)$/);
  if (checkMatch) {
    const sessionId = parseInt(checkMatch[1], 10);
    const nextIndex = parseInt(checkMatch[2], 10);
    try {
      await handleSubscriptionRecheck(ctx, botId, sessionId, nextIndex);
    } catch (err: any) {
      console.error('[callback] check_sub 处理失败:', err.message);
      await ctx.answerCallbackQuery({ text: '验证失败,请重试', show_alert: true }).catch(() => {});
    }
    return;
  }

  // 原有翻页回调
  const match = data.match(/^next:(\d+):(\d+)$/);
  if (!match) {
    await ctx.answerCallbackQuery();
    return;
  }

  const sessionId = parseInt(match[1], 10);
  const nextIndex = parseInt(match[2], 10);

  if (processingSet.has(sessionId)) {
    await ctx.answerCallbackQuery({ text: '正在处理中...' });
    return;
  }

  processingSet.add(sessionId);

  try {
    await ctx.answerCallbackQuery();
    await processNextPage(ctx, botId, sessionId, nextIndex);
  } catch (err: any) {
    console.error('[callback] 翻页处理失败:', err.message);
  } finally {
    processingSet.delete(sessionId);
  }
}
```

在 `processNextPage` 函数开头(`if (!session || session.isCompleted) return;` 之后),插入拦截:

```ts
  // 强制订阅拦截
  const gateResult = await ensureSubscribed(botId, session.botUser.telegramId, ctx.api);
  if (!gateResult.ok) {
    const config = getGateConfig(botId);
    await sendSubscriptionPrompt(
      ctx,
      config?.promptTemplate,
      sessionId,
      nextIndex,
      gateResult.missing
    );
    return;
  }
```

在文件末尾追加新函数:

```ts
async function handleSubscriptionRecheck(
  ctx: Context,
  botId: number,
  sessionId: number,
  nextIndex: number
) {
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
    await ctx.answerCallbackQuery({
      text: '还有未订阅的频道,请检查后再试',
      show_alert: true,
    });
    return;
  }

  await ctx.answerCallbackQuery({ text: '✅ 验证通过' });
  await ctx.deleteMessage().catch(() => {});

  // 防重复:借用 processingSet
  if (processingSet.has(sessionId)) return;
  processingSet.add(sessionId);
  try {
    await processNextPage(ctx, botId, sessionId, nextIndex);
  } finally {
    processingSet.delete(sessionId);
  }
}
```

- [ ] **Step 2: 改 bot-manager.ts — loadAllBots 末尾刷配置**

修改 `packages/bot/src/manager/bot-manager.ts`。

顶部 import 区追加:

```ts
import { reloadAllGateConfigs } from '../services/subscription-check';
```

在 `loadAllBots` 函数末尾(`for (const [botId] of this.instances) { ... }` 之后)追加:

```ts
    // 刷新强制订阅配置缓存
    try {
      await reloadAllGateConfigs();
    } catch (err: any) {
      console.error('[BotManager] 加载强制订阅配置失败:', err.message);
    }
```

- [ ] **Step 3: 类型检查**

```bash
cd packages/bot && pnpm tsc --noEmit
```

Expected: 无报错。

- [ ] **Step 4: Commit**

```bash
git add packages/bot/src/handlers/callback.ts packages/bot/src/manager/bot-manager.ts
git commit -m "feat(bot): intercept page turns with subscription gate"
```

---

## Task 7: 前端 - SubscriptionGateDrawer 组件 + Bots.tsx 入口

**Files:**
- Create: `packages/client/src/components/SubscriptionGateDrawer.tsx`
- Modify: `packages/client/src/pages/Bots.tsx`

- [ ] **Step 1: 创建抽屉组件**

Create `packages/client/src/components/SubscriptionGateDrawer.tsx`:

```tsx
import { useEffect, useState } from 'react';
import {
  Drawer, Switch, Input, Button, List, Tag, Space, message, Popconfirm, Typography, Divider,
} from 'antd';
import { ReloadOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type {
  SubscriptionGateInfo, SubscriptionGateChannelInfo, ApiResponse,
} from 'shared';
import api from '@/services/api';

const { Text, Paragraph } = Typography;

interface Props {
  botId: number | null;
  botName: string;
  open: boolean;
  onClose: () => void;
}

const STATUS_TAG: Record<SubscriptionGateChannelInfo['status'], { color: string; text: string }> = {
  ok: { color: 'green', text: '正常' },
  bot_not_admin: { color: 'orange', text: 'Bot 不是管理员' },
  channel_gone: { color: 'red', text: '频道不存在' },
};

export default function SubscriptionGateDrawer({ botId, botName, open, onClose }: Props) {
  const [gate, setGate] = useState<SubscriptionGateInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [template, setTemplate] = useState('');
  const [templateSaving, setTemplateSaving] = useState(false);

  const reload = async () => {
    if (!botId) return;
    setLoading(true);
    try {
      const { data } = await api.get<ApiResponse<SubscriptionGateInfo>>(`/bots/${botId}/subscription-gate`);
      if (data.data) {
        setGate(data.data);
        setTemplate(data.data.promptTemplate ?? '');
      }
    } catch {
      message.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && botId) reload();
    if (!open) { setGate(null); setNewUrl(''); setAddError(null); }
  }, [open, botId]);

  const toggleEnabled = async (checked: boolean) => {
    if (!botId) return;
    try {
      const { data } = await api.put<ApiResponse<SubscriptionGateInfo>>(
        `/bots/${botId}/subscription-gate`,
        { isEnabled: checked }
      );
      if (data.data) setGate(data.data);
      message.success(checked ? '已启用强制订阅' : '已关闭强制订阅');
    } catch {
      message.error('操作失败');
    }
  };

  const addChannel = async () => {
    if (!botId || !newUrl.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      await api.post(`/bots/${botId}/subscription-gate/channels`, { inviteUrl: newUrl.trim() });
      setNewUrl('');
      message.success('频道已添加');
      await reload();
    } catch (err: any) {
      setAddError(err.response?.data?.message || '添加失败');
    } finally {
      setAdding(false);
    }
  };

  const removeChannel = async (id: number) => {
    if (!botId) return;
    try {
      await api.delete(`/bots/${botId}/subscription-gate/channels/${id}`);
      message.success('已移除');
      await reload();
    } catch {
      message.error('移除失败');
    }
  };

  const recheckChannel = async (id: number) => {
    if (!botId) return;
    try {
      await api.post(`/bots/${botId}/subscription-gate/channels/${id}/recheck`);
      message.success('已重新验证');
      await reload();
    } catch (err: any) {
      message.error(err.response?.data?.message || '验证失败');
    }
  };

  const saveTemplate = async () => {
    if (!botId) return;
    setTemplateSaving(true);
    try {
      await api.put(`/bots/${botId}/subscription-gate`, { promptTemplate: template });
      message.success('提示文案已保存');
    } catch {
      message.error('保存失败');
    } finally {
      setTemplateSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`强制订阅 — ${botName}`}
      width={520}
      destroyOnClose
    >
      {loading && !gate ? '加载中...' : (
        <>
          <Space style={{ marginBottom: 16 }}>
            <Text strong>启用强制订阅</Text>
            <Switch checked={gate?.isEnabled ?? false} onChange={toggleEnabled} />
          </Space>

          <Divider orientation="left">必订频道(全部订阅才通过)</Divider>

          <Space.Compact style={{ width: '100%', marginBottom: 4 }}>
            <Input
              placeholder="@xxx 或 https://t.me/xxx"
              value={newUrl}
              onChange={(e) => { setNewUrl(e.target.value); setAddError(null); }}
              onPressEnter={addChannel}
              disabled={adding}
            />
            <Button type="primary" icon={<PlusOutlined />} loading={adding} onClick={addChannel}>
              添加
            </Button>
          </Space.Compact>
          {addError && <Text type="danger" style={{ display: 'block', marginBottom: 12 }}>{addError}</Text>}

          <List
            dataSource={gate?.channels ?? []}
            locale={{ emptyText: '尚未添加频道' }}
            renderItem={(c) => (
              <List.Item
                actions={[
                  <Button key="recheck" size="small" icon={<ReloadOutlined />} onClick={() => recheckChannel(c.id)}>重新验证</Button>,
                  <Popconfirm key="del" title="确定移除？" onConfirm={() => removeChannel(c.id)}>
                    <Button size="small" danger icon={<DeleteOutlined />}>移除</Button>
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={<span>📢 {c.title} <Text type="secondary">@{c.username}</Text></span>}
                  description={<Tag color={STATUS_TAG[c.status].color}>{STATUS_TAG[c.status].text}</Tag>}
                />
              </List.Item>
            )}
          />

          <Divider orientation="left">提示文案模板</Divider>
          <Paragraph type="secondary" style={{ fontSize: 12 }}>
            留空使用默认模板。支持占位 <Text code>{'{channels}'}</Text> = 未订阅频道列表
          </Paragraph>
          <Input.TextArea
            rows={5}
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            placeholder="请先订阅以下频道,然后点击「我已完成」继续:\n{channels}"
          />
          <Button
            type="primary"
            onClick={saveTemplate}
            loading={templateSaving}
            style={{ marginTop: 8 }}
          >
            保存文案
          </Button>
        </>
      )}
    </Drawer>
  );
}
```

- [ ] **Step 2: 改 Bots.tsx 加入口按钮**

修改 `packages/client/src/pages/Bots.tsx`。

import 区追加(在已有的 antd 图标 import 末尾加 `LockOutlined`):

```tsx
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SafetyCertificateOutlined, LinkOutlined, LockOutlined,
} from '@ant-design/icons';
import SubscriptionGateDrawer from '@/components/SubscriptionGateDrawer';
```

在组件函数顶部其他 useState 旁追加抽屉状态:

```tsx
const [gateDrawer, setGateDrawer] = useState<{ open: boolean; bot: BotInfo | null }>({ open: false, bot: null });
```

在 `columns` 的"操作"列 `Space` 内,在「管理链接」按钮之后追加:

```tsx
<Button size="small" icon={<LockOutlined />} onClick={() => setGateDrawer({ open: true, bot: record })}>
  强制订阅
</Button>
```

在组件 return 的最末尾(`</Modal>` 之后,`</>` 之前)追加:

```tsx
<SubscriptionGateDrawer
  open={gateDrawer.open}
  botId={gateDrawer.bot?.id ?? null}
  botName={gateDrawer.bot?.name ?? ''}
  onClose={() => setGateDrawer({ open: false, bot: null })}
/>
```

- [ ] **Step 3: 类型检查 + dev 启动**

```bash
cd packages/client && pnpm tsc --noEmit
```

Expected: 无报错。

- [ ] **Step 4: 浏览器手测一遍**

```bash
cd packages/server && pnpm dev &
sleep 3
cd packages/client && pnpm dev
```

浏览器打开本地客户端,登录后:
- 在 Bot 列表点「强制订阅」→ Drawer 打开,显示"启用 off"+ 空频道列表
- 切换开关 → message "已启用强制订阅"
- 输错的链接(如 `https://t.me/+abc`)→ 红字"本期仅支持公开频道..."
- 输个真实的公开频道(但 Bot 不是管理员)→ 红字"请先把本 Bot 设为该频道的管理员"
- 把 Bot 设为某频道管理员后再添加 → 添加成功,列表显示标题、用户名、绿色"正常"

如果出现 type 报错或 UI 错位,在这一步修。

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/SubscriptionGateDrawer.tsx packages/client/src/pages/Bots.tsx
git commit -m "feat(client): subscription gate config drawer in bots page"
```

---

## Task 8: 端到端手测验收清单

**Files:** 无代码修改;这一步是验收和文档。

- [ ] **Step 1: 确认 server + bot-runner + client 都在跑最新代码**

```bash
# 本地开发:
cd /mnt/d/ProjectKaka/sourceBotV3 && pnpm install
# 三个终端分别跑:
# 终端 1
cd packages/server && pnpm dev
# 终端 2
cd packages/bot && pnpm dev
# 终端 3
cd packages/client && pnpm dev
```

Expected: 三个进程都启动成功,无报错。

- [ ] **Step 2: 跑通核心流程**

按下表逐项手测:

| # | 操作 | 期望结果 |
|---|---|---|
| 1 | 后台启用 Bot 强制订阅 + 添加 1 个 Bot 是管理员的公开频道 | 添加成功,绿色"正常",server 在 `<repo>/.bot-reload` 写入信号文件 |
| 2 | 等 2-3 秒(bot-runner 轮询信号) | bot-runner 日志出现 `[BotManager] 检测到 .bot-reload 信号` |
| 3 | 用一个**未订阅**该频道的 Telegram 账号 → 通过邀请链接 /start → 翻一页 | 出现强制订阅提示消息,带频道链接按钮 + "✅ 我已完成" |
| 4 | 不订阅,直接点"我已完成" | popup `还有未订阅的频道,请检查后再试`,提示消息不消失 |
| 5 | 点频道按钮跳转 → 订阅频道 → 回到 Bot 点"我已完成" | popup `✅ 验证通过`,提示消息被删除,**自动收到目标页的资源** |
| 6 | 同一账号再次翻页 | 直接放行,无任何拦截(当日缓存生效) |
| 7 | 数据库查 `SubscriptionCheckPass` | 该用户当日有一条记录,`passDate` = 今日上海日期 |
| 8 | 后台移除该频道 → 该 Bot 强制订阅留空启用 | 用户翻页放行(无活跃频道) |
| 9 | 后台关闭强制订阅总开关 | 用户翻页放行 |
| 10 | 用一个被 Bot 踢出的频道(模拟:手工把 Bot 在频道里降级为普通成员,然后让用户翻页) | bot-runner 日志记录失效;后台该频道 Tag 变 "Bot 不是管理员";其他频道继续生效 |

- [ ] **Step 3: 验证 .bot-reload 信号机制**

```bash
ls -la /mnt/d/ProjectKaka/sourceBotV3/.bot-reload 2>/dev/null
# 应该不存在(bot-runner 处理完会删)
```

在管理后台改一次开关,立刻看:

```bash
watch -n 0.5 'ls -la /mnt/d/ProjectKaka/sourceBotV3/.bot-reload 2>/dev/null; echo "---"; tail -5 ~/.pm2/logs/bot-runner-out-3.log 2>/dev/null || true'
```

Expected: 文件出现 → 2 秒内消失 → bot-runner 日志出现 reload 消息。

- [ ] **Step 4: 若全部通过,合并/部署**

按现有部署流程(参见 DEPLOY.md / ecosystem.config.js)推到生产:

```bash
# 在服务器上
cd /opt/sourceBotV3 && git pull origin main
pnpm install
cd packages/server && npx prisma db push   # 应用 schema 到生产 DB(本项目用 db push 流,无 migrations)
cd packages/server && pnpm prisma:generate
cd /opt/sourceBotV3 && pnpm build
pm2 restart api-server bot-runner
```

注意:`prisma db push` 直接同步 schema,适合无版本化 migrations 的小团队场景。务必在低流量时段执行;本次仅新增表,无破坏性变更。

---

## Self-Review Notes

| Spec 段落 | 对应任务 |
|---|---|
| 数据模型(3 张表) | Task 1 |
| `parseChannelUrl` + `verifyChannelForBot`(B1 即时校验) | Task 2 |
| `.bot-reload` 信号 + Service + 路由 | Task 3 |
| `formatShanghaiDate` + `ensureSubscribed`(A1 PG 缓存) | Task 4 |
| `renderPromptText` + `buildPromptKeyboard` + `sendSubscriptionPrompt` | Task 5 |
| callback handler 拦截 + `check_sub` 处理 + 自动续页 | Task 6 |
| BotManager 热更钩子 | Task 6 |
| 前端配置 UI(总开关、频道列表、状态 Tag、模板) | Task 7 |
| §6 错误处理(失效跳过、5xx 放行、API 失败标 status) | Task 4 的 `classifyApiError` |
| §6 边缘:用户绕过 | Task 6 处理 — 翻页前必过 `ensureSubscribed` |
| 测试策略 §7 | Task 2/4/5 的脚本测试 + Task 8 端到端手测 |

所有 Spec 章节均已覆盖,无遗留 TODO。
