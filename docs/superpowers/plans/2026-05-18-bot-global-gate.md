# Bot 全局强制订阅 + Link Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每个 Bot 可配置一份"全局"强制订阅(主频道/赞助商/触发位置);从未创建过 SubscriptionGate 的 link 在运行时回退用 bot 全局配置。

**Architecture:** 新建 `BotSubscriptionGate` 表(unique on botId);`SubscriptionGateChannel` 加 nullable `botGateId`,channel 表同时服务两类 gate。bot 端缓存 link gate + bot gate 两份 map + linkToBotMap;`getGateConfig` 内部做 link → bot fallback。后台复用现有 `SubscriptionGateDrawer`(加 `level` prop)。

**Tech Stack:** Prisma / Express / grammy / React + antd / pnpm workspace。

**Spec:** [`docs/superpowers/specs/2026-05-18-bot-global-gate-design.md`](../specs/2026-05-18-bot-global-gate-design.md)

---

## Task 1: Schema 变更

**Files:**
- Modify: `packages/server/prisma/schema.prisma`

- [ ] **Step 1: 加 BotSubscriptionGate model + Bot 反向关系 + SubscriptionGateChannel.gateId 改 nullable + botGateId 字段**

打开 `/mnt/d/ProjectKaka/sourceBotV3/packages/server/prisma/schema.prisma`。

(a) 在 `model Bot { ... }` 块的关系字段区(`channelGroups Bot[]` 同区)追加一行:

```prisma
  subscriptionGate BotSubscriptionGate?
```

(b) 在文件**末尾或** `model SubscriptionGate {...}` 之后,加一个新 model:

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

(c) 找到 `model SubscriptionGateChannel { ... }`,把:

```prisma
  gateId      Int
```

改为:

```prisma
  gateId      Int?
  botGateId   Int?
```

并把现有的 `gate SubscriptionGate @relation(...)` 改成 nullable + 加新 `botGate` 关系。当前:

```prisma
  gate SubscriptionGate @relation(fields: [gateId], references: [id], onDelete: Cascade)
```

改为:

```prisma
  gate    SubscriptionGate?    @relation(fields: [gateId], references: [id], onDelete: Cascade)
  botGate BotSubscriptionGate? @relation(fields: [botGateId], references: [id], onDelete: Cascade)
```

- [ ] **Step 2: 本地 prisma generate**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3/packages/server && pnpm exec prisma generate
```

预期: `✔ Generated Prisma Client`。

- [ ] **Step 3: tsc 全包确认没破坏现有 server 代码**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3 && pnpm -r --filter server build 2>&1 | tail -10
```

预期: `> tsc` 完成无 error。若 `subscription-gate.service.ts` 内 `channel.gate.inviteLinkId` 等访问因 gate 变 nullable 而报错,**修复方式**:把所有 `channel.gate.inviteLinkId` 改为 `channel.gate?.inviteLinkId`,并用 `!channel.gate || channel.gate.inviteLinkId !== inviteLinkId` 守卫。整个文件搜索 `channel.gate.` 全部加 `?.`。

- [ ] **Step 4: Commit**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3
git add packages/server/prisma/schema.prisma packages/server/src/services/subscription-gate.service.ts
git commit -m "feat(schema): 加 BotSubscriptionGate 表 + channel.gateId/botGateId 互斥"
```

---

## Task 2: BotSubscriptionGateService

**Files:**
- Create: `packages/server/src/services/bot-subscription-gate.service.ts`

- [ ] **Step 1: 创建文件**

```ts
import prisma from './prisma';
import {
  verifyChannelForBot,
  parseChannelUrl,
  verifyPrivateChannelForBot,
} from './telegram-channel';

export type ChannelKind = 'primary' | 'sponsor';

export class BotSubscriptionGateService {
  /** 拿配置;不存在则懒创建一个 default-off 记录返回 */
  static async getOrCreate(botId: number) {
    let gate = await prisma.botSubscriptionGate.findUnique({
      where: { botId },
      include: { channels: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!gate) {
      gate = await prisma.botSubscriptionGate.create({
        data: { botId },
        include: { channels: true },
      });
    }
    return gate;
  }

  static async update(botId: number, data: { isEnabled?: boolean; promptTemplate?: string | null }) {
    await this.getOrCreate(botId);
    return prisma.botSubscriptionGate.update({
      where: { botId },
      data,
      include: { channels: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  static async addChannel(
    botId: number,
    inviteUrl: string,
    chatIdInput?: string,
    kind: ChannelKind = 'primary',
  ) {
    if (kind !== 'primary' && kind !== 'sponsor') {
      throw new Error('kind 必须是 primary 或 sponsor');
    }
    const bot = await prisma.bot.findUnique({ where: { id: botId } });
    if (!bot) throw new Error('机器人不存在');

    const isPrivate = !!chatIdInput;
    let verified;
    let username: string | null;
    let storedInviteUrl: string;

    if (isPrivate) {
      verified = await verifyPrivateChannelForBot(bot.token, chatIdInput!);
      username = verified.username || null;
      if (!inviteUrl?.trim()) throw new Error('请提供私有频道的邀请链接');
      storedInviteUrl = inviteUrl.trim();
    } else {
      const parsed = parseChannelUrl(inviteUrl);
      verified = await verifyChannelForBot(bot.token, parsed.username);
      username = verified.username;
      storedInviteUrl = `https://t.me/${verified.username}`;
    }

    const gate = await this.getOrCreate(botId);

    const maxSort = await prisma.subscriptionGateChannel.aggregate({
      where: { botGateId: gate.id, kind },
      _max: { sortOrder: true },
    });

    return prisma.$transaction(async (tx) => {
      const channel = await tx.subscriptionGateChannel.create({
        data: {
          gateId: null,
          botGateId: gate.id,
          kind,
          isPrivate,
          username,
          chatId: BigInt(verified.chatId),
          title: verified.title,
          inviteUrl: storedInviteUrl,
          sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
          status: 'ok',
        },
      });

      if (kind === 'sponsor') {
        const last = gate.sponsorPositions[gate.sponsorPositions.length - 1] ?? 0;
        const nextPos = last > 0 ? last + 3 : 3;
        await tx.botSubscriptionGate.update({
          where: { id: gate.id },
          data: { sponsorPositions: [...gate.sponsorPositions, nextPos] },
        });
      }

      return channel;
    });
  }

  static async removeChannel(botId: number, channelId: number) {
    const channel = await prisma.subscriptionGateChannel.findUnique({
      where: { id: channelId },
      include: { botGate: true },
    });
    if (!channel || !channel.botGate || channel.botGate.botId !== botId) {
      throw new Error('频道不存在');
    }

    if (channel.kind !== 'sponsor') {
      await prisma.subscriptionGateChannel.delete({ where: { id: channelId } });
      return;
    }

    const sponsorChannels = await prisma.subscriptionGateChannel.findMany({
      where: { botGateId: channel.botGateId!, kind: 'sponsor' },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });
    const idx = sponsorChannels.findIndex((c) => c.id === channelId);
    const positions = [...channel.botGate.sponsorPositions];
    if (idx >= 0 && idx < positions.length) positions.splice(idx, 1);

    await prisma.$transaction([
      prisma.subscriptionGateChannel.delete({ where: { id: channelId } }),
      prisma.botSubscriptionGate.update({
        where: { id: channel.botGateId! },
        data: { sponsorPositions: positions },
      }),
    ]);
  }

  static async recheckChannel(botId: number, channelId: number) {
    const channel = await prisma.subscriptionGateChannel.findUnique({
      where: { id: channelId },
      include: { botGate: true },
    });
    if (!channel || !channel.botGate || channel.botGate.botId !== botId) {
      throw new Error('频道不存在');
    }

    const bot = await prisma.bot.findUnique({ where: { id: botId } });
    if (!bot) throw new Error('机器人不存在');

    try {
      const verified = channel.isPrivate
        ? await verifyPrivateChannelForBot(bot.token, channel.chatId.toString())
        : await verifyChannelForBot(bot.token, channel.username ?? '');
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
      const msg: string = err.message || '';
      const status = msg.includes('管理员') ? 'bot_not_admin' : 'channel_gone';
      return prisma.subscriptionGateChannel.update({
        where: { id: channelId },
        data: { status, lastCheckAt: new Date() },
      });
    }
  }

  static async updateSponsorPositions(botId: number, positions: number[]) {
    if (!Array.isArray(positions)) throw new Error('positions 必须是数组');
    for (const p of positions) {
      if (!Number.isInteger(p) || p <= 0) {
        throw new Error('触发位置必须是正整数');
      }
    }
    for (let i = 1; i < positions.length; i++) {
      if (positions[i] <= positions[i - 1]) {
        throw new Error('触发位置必须严格递增');
      }
    }
    const gate = await this.getOrCreate(botId);
    const sponsorCount = await prisma.subscriptionGateChannel.count({
      where: { botGateId: gate.id, kind: 'sponsor' },
    });
    if (positions.length !== sponsorCount) {
      throw new Error(`触发位置数量必须等于赞助商数量(当前赞助商 ${sponsorCount} 个,位置 ${positions.length} 个)`);
    }
    return prisma.botSubscriptionGate.update({
      where: { id: gate.id },
      data: { sponsorPositions: positions },
      include: { channels: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  static async reorderSponsorChannels(botId: number, orderedIds: number[]) {
    if (!Array.isArray(orderedIds)) throw new Error('orderedIds 必须是数组');
    const gate = await this.getOrCreate(botId);
    const existing = await prisma.subscriptionGateChannel.findMany({
      where: { botGateId: gate.id, kind: 'sponsor' },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((c) => c.id));
    if (orderedIds.length !== existingIds.size || !orderedIds.every((id) => existingIds.has(id))) {
      throw new Error('orderedIds 与当前赞助商列表不匹配');
    }
    await prisma.$transaction(
      orderedIds.map((id, idx) =>
        prisma.subscriptionGateChannel.update({
          where: { id },
          data: { sortOrder: idx },
        }),
      ),
    );
  }
}
```

- [ ] **Step 2: tsc 验证**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3/packages/server && pnpm exec tsc --noEmit
```

预期: EXIT 0。失败 STOP 报告 stderr。

- [ ] **Step 3: Commit**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3
git add packages/server/src/services/bot-subscription-gate.service.ts
git commit -m "feat(server): 新增 BotSubscriptionGateService(镜像 link 版,绑定 botGateId)"
```

---

## Task 3: 路由 + 挂载

**Files:**
- Create: `packages/server/src/routes/bot-subscription-gate.ts`
- Modify: `packages/server/src/routes/index.ts`

- [ ] **Step 1: 创建路由文件**

```ts
// packages/server/src/routes/bot-subscription-gate.ts
import { Router, type IRouter } from 'express';
import { BotSubscriptionGateService } from '../services/bot-subscription-gate.service';
import { touchReloadSignal } from '../services/bot-reload-signal';
import { authMiddleware } from '../middleware/auth';
import { success, fail } from '../utils/response';

const router: IRouter = Router();
router.use(authMiddleware);

function serialize(gate: any) {
  return {
    id: gate.id,
    botId: gate.botId,
    isEnabled: gate.isEnabled,
    promptTemplate: gate.promptTemplate,
    sponsorPositions: gate.sponsorPositions ?? [],
    channels: (gate.channels ?? []).map((c: any) => ({
      id: c.id,
      kind: c.kind,
      isPrivate: c.isPrivate,
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
    const gate = await BotSubscriptionGateService.getOrCreate(botId);
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
    const gate = await BotSubscriptionGateService.update(botId, data);
    touchReloadSignal();
    return success(res, serialize(gate));
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

router.post('/:botId/subscription-gate/channels', async (req, res) => {
  try {
    const botId = parseInt(req.params.botId);
    const { inviteUrl, chatId, kind } = req.body ?? {};
    if (!inviteUrl) return fail(res, '请提供 inviteUrl', 400);
    await BotSubscriptionGateService.addChannel(botId, inviteUrl, chatId, kind ?? 'primary');
    touchReloadSignal();
    const gate = await BotSubscriptionGateService.getOrCreate(botId);
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
    await BotSubscriptionGateService.removeChannel(botId, channelId);
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
    const channel = await BotSubscriptionGateService.recheckChannel(botId, channelId);
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

router.put('/:botId/subscription-gate/sponsor-positions', async (req, res) => {
  try {
    const botId = parseInt(req.params.botId);
    const { positions } = req.body ?? {};
    const gate = await BotSubscriptionGateService.updateSponsorPositions(botId, positions);
    touchReloadSignal();
    return success(res, serialize(gate));
  } catch (err: any) {
    return fail(res, err.message, 400);
  }
});

router.put('/:botId/subscription-gate/channels/reorder', async (req, res) => {
  try {
    const botId = parseInt(req.params.botId);
    const { orderedIds } = req.body ?? {};
    await BotSubscriptionGateService.reorderSponsorChannels(botId, orderedIds);
    touchReloadSignal();
    const gate = await BotSubscriptionGateService.getOrCreate(botId);
    return success(res, serialize(gate));
  } catch (err: any) {
    return fail(res, err.message, 400);
  }
});

export default router;
```

- [ ] **Step 2: 挂载到 routes/index.ts**

打开 `/mnt/d/ProjectKaka/sourceBotV3/packages/server/src/routes/index.ts`。在已有 `import subscriptionGateRouter from './subscription-gate';` 行下方加:

```ts
import botSubscriptionGateRouter from './bot-subscription-gate';
```

在 `router.use('/links', subscriptionGateRouter);` 之后(或附近)加:

```ts
router.use('/bots', botSubscriptionGateRouter);
```

(注意:`/bots` 已被 botsRouter 用,express 允许多 router 共用前缀;新 router 的路径 `/:botId/subscription-gate/...` 不与 botsRouter 现有路径冲突。)

- [ ] **Step 3: tsc + build**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3 && pnpm -r --filter server build 2>&1 | tail -5
```

预期:`> tsc` 完成无 error。

- [ ] **Step 4: Commit**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3
git add packages/server/src/routes/bot-subscription-gate.ts packages/server/src/routes/index.ts
git commit -m "feat(server): 加 /bots/:botId/subscription-gate 路由"
```

---

## Task 4: subscription-check.ts 双缓存 + fallback

**Files:**
- Modify: `packages/bot/src/services/subscription-check.ts`

- [ ] **Step 1: 加 bot gate 缓存 + linkToBotMap**

打开 `/mnt/d/ProjectKaka/sourceBotV3/packages/bot/src/services/subscription-check.ts`。找到现有:

```ts
let configCache = new Map<number, GateConfig>();
let prismaRef: any = realPrisma;
```

改为(加 2 个 cache):

```ts
let configCache = new Map<number, GateConfig>();       // key: inviteLinkId
let botGateCache = new Map<number, GateConfig>();      // key: botId
let linkToBotMap = new Map<number, number>();          // inviteLinkId → botId
let prismaRef: any = realPrisma;
```

把现有 `_setCacheForTests` 改为同时清两份:

```ts
export function _setCacheForTests(c: Map<number, GateConfig>) {
  configCache = c;
  botGateCache = new Map();
  linkToBotMap = new Map();
}
/** 仅供测试使用 */
export function _setBotGateCacheForTests(c: Map<number, GateConfig>, ltb: Map<number, number>) {
  botGateCache = c;
  linkToBotMap = ltb;
}
```

- [ ] **Step 2: 改 reloadAllGateConfigs 加载 bot gates**

把现有 `reloadAllGateConfigs` 函数体替换为:

```ts
export async function reloadAllGateConfigs(): Promise<void> {
  // 1. link → bot 映射
  const links = await prismaRef.inviteLink.findMany({
    select: { id: true, botId: true },
  });
  const nextLinkToBot = new Map<number, number>();
  for (const l of links) nextLinkToBot.set(l.id, l.botId);

  // 2. 加载 link gates
  const gates = await prismaRef.subscriptionGate.findMany({
    include: { channels: { orderBy: { sortOrder: 'asc' } } },
  });
  const nextLinkCache = new Map<number, GateConfig>();
  for (const g of gates) {
    nextLinkCache.set(g.inviteLinkId, buildConfig(g));
  }

  // 3. 加载 bot gates
  const botGates = await prismaRef.botSubscriptionGate.findMany({
    include: { channels: { orderBy: { sortOrder: 'asc' } } },
  });
  const nextBotCache = new Map<number, GateConfig>();
  for (const g of botGates) {
    nextBotCache.set(g.botId, buildConfig(g));
  }

  configCache = nextLinkCache;
  botGateCache = nextBotCache;
  linkToBotMap = nextLinkToBot;
}

function buildConfig(g: any): GateConfig {
  const primaryChannels: ChannelCfg[] = [];
  const sponsorChannels: ChannelCfg[] = [];
  for (const c of g.channels) {
    const cfg: ChannelCfg = {
      id: c.id,
      chatId: c.chatId,
      username: c.username,
      title: c.title,
      inviteUrl: c.inviteUrl,
      status: c.status,
    };
    if (c.kind === 'sponsor') sponsorChannels.push(cfg);
    else primaryChannels.push(cfg);
  }
  return {
    isEnabled: g.isEnabled,
    promptTemplate: g.promptTemplate,
    primaryChannels,
    sponsorChannels,
    sponsorPositions: g.sponsorPositions ?? [],
  };
}
```

- [ ] **Step 3: 改 getGateConfig 加 fallback**

```ts
export function getGateConfig(inviteLinkId: number): GateConfig | undefined {
  const linkGate = configCache.get(inviteLinkId);
  if (linkGate) return linkGate;
  const botId = linkToBotMap.get(inviteLinkId);
  if (botId === undefined) return undefined;
  return botGateCache.get(botId);
}
```

- [ ] **Step 4: 改 ensureSubscribed 内部用 getGateConfig**

找到 ensureSubscribed 函数体内的 `const config = configCache.get(inviteLinkId);`,改为:

```ts
const config = getGateConfig(inviteLinkId);
```

- [ ] **Step 5: tsc 验证**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3/packages/bot && pnpm exec tsc --noEmit
```

预期: EXIT 0。

- [ ] **Step 6: 跑既有测试不退化**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3/packages/bot && pnpm exec tsx src/services/subscription-check.test.ts
```

预期:`✓ ensureSubscribed tests passed (primary + sponsor)`

- [ ] **Step 7: Commit**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3
git add packages/bot/src/services/subscription-check.ts
git commit -m "feat(bot): subscription-check 双缓存 + getGateConfig 加 link→bot fallback"
```

---

## Task 5: subscription-check.test 加 fallback case

**Files:**
- Modify: `packages/bot/src/services/subscription-check.test.ts`

- [ ] **Step 1: 加测试 case**

打开 `/mnt/d/ProjectKaka/sourceBotV3/packages/bot/src/services/subscription-check.test.ts`。在文件末尾的 `console.log('✓ ensureSubscribed tests passed (primary + sponsor)');` 之**前**插入:

```ts
  // case 10: link 无 gate → fallback 到 bot 全局 gate
  {
    const botChannel: ChannelCfg = {
      id: 200, chatId: -8000n, username: 'gb', title: 'G',
      inviteUrl: 'https://t.me/gb', status: 'ok',
    };
    const linkCache = new Map<number, GateConfig>(); // 空(link 1000 无 gate)
    const botCache = new Map<number, GateConfig>([[
      99, // botId
      {
        isEnabled: true,
        promptTemplate: null,
        primaryChannels: [botChannel],
        sponsorChannels: [],
        sponsorPositions: [],
      },
    ]]);
    const ltbMap = new Map<number, number>([[1000, 99]]); // link 1000 属于 bot 99
    _setCacheForTests(linkCache);
    _setBotGateCacheForTests(botCache, ltbMap);

    r = await ensureSubscribed(1000, 5000n, makeBotApi({ '-8000:5000': 'left' }));
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.missing.length, 1);
      assert.equal(r.missing[0].username, 'gb');
    }
  }

  // case 11: link 有 gate 但不启用 → 不回退 bot,直接 ok
  {
    _setCacheForTests(new Map([[2000, makeConfig({ isEnabled: false })]]));
    _setBotGateCacheForTests(
      new Map([[99, makeConfig({ isEnabled: true, primaryChannels: [{
        id: 200, chatId: -8000n, username: 'gb', title: 'G', inviteUrl: 'x', status: 'ok',
      }] })]]),
      new Map([[2000, 99]]),
    );
    r = await ensureSubscribed(2000, 5000n, makeBotApi({ '-8000:5000': 'left' }));
    assert.equal(r.ok, true);
  }
```

并在文件顶部 import 块里给 `_setCacheForTests` 后追加 `, _setBotGateCacheForTests`:

```ts
import {
  ensureSubscribed,
  _setCacheForTests,
  _setBotGateCacheForTests,
  _setPrismaForTests,
  type ChannelCfg,
  type GateConfig,
  type CheckResult,
} from './subscription-check';
```

- [ ] **Step 2: 跑测试**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3/packages/bot && pnpm exec tsx src/services/subscription-check.test.ts
```

预期:`✓ ensureSubscribed tests passed (primary + sponsor)`(全部 case 含新增 fallback case)

- [ ] **Step 3: Commit**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3
git add packages/bot/src/services/subscription-check.test.ts
git commit -m "test(bot): subscription-check 加 fallback case(link 无 gate → bot 全局)"
```

---

## Task 6: SubscriptionGateDrawer 加 level prop

**Files:**
- Modify: `packages/client/src/components/SubscriptionGateDrawer.tsx`

- [ ] **Step 1: 改 Props 接口 + 路径辅助**

打开 `/mnt/d/ProjectKaka/sourceBotV3/packages/client/src/components/SubscriptionGateDrawer.tsx`。

找到现有:

```tsx
interface Props {
  linkId: number | null;
  linkName: string;
  open: boolean;
  onClose: () => void;
}
```

改为:

```tsx
interface Props {
  /** 'link' = 配某条邀请链接;'bot' = 配机器人全局 */
  level?: 'link' | 'bot';
  /** linkId(level=link) 或 botId(level=bot) */
  targetId: number | null;
  /** 显示名称(用于 Drawer 标题) */
  targetName: string;
  open: boolean;
  onClose: () => void;
  // 兼容旧 caller(过渡期内保留 linkId/linkName,内部转 targetId/targetName)
  linkId?: number | null;
  linkName?: string;
}
```

在 `export default function SubscriptionGateDrawer({ ... }: Props)` 内开头加(在 useState 之前):

```tsx
  // 兼容旧 caller: linkId/linkName 等价于 targetId/targetName + level='link'
  const effectiveLevel = level ?? (linkId !== undefined ? 'link' : 'link');
  const effectiveTargetId = targetId ?? linkId ?? null;
  const effectiveTargetName = targetName || linkName || '';

  const basePath = effectiveLevel === 'bot'
    ? `/bots/${effectiveTargetId}/subscription-gate`
    : `/links/${effectiveTargetId}/subscription-gate`;
```

(`linkId` / `linkName` 都还作为兼容接收;只要 caller 传 `linkId` 旧行为不变。)

- [ ] **Step 2: 替换所有 `/links/${linkId}/subscription-gate` 引用**

在文件内,grep 所有 `/links/\${linkId}/subscription-gate` 或类似硬编码 url。替换前缀为 `basePath` 变量。例如:

旧:
```tsx
await api.get(`/links/${linkId}/subscription-gate`);
```

改为:
```tsx
await api.get(basePath);
```

旧:
```tsx
await api.post(`/links/${linkId}/subscription-gate/channels`, body);
```

改为:
```tsx
await api.post(`${basePath}/channels`, body);
```

把所有 `linkId` 在请求路径里的引用都改成走 `basePath`。共有约 7 处 url 出现(GET / PUT gate / POST channels / DELETE channels / POST recheck / PUT sponsor-positions / PUT channels/reorder)。

(顶部 useState 等内部 effect/handler 也用 `linkId` 来判断 `if (!linkId)`,把这些 guard 改为 `if (!effectiveTargetId)`。函数体内对 linkId 的判断全部替换。)

- [ ] **Step 3: 改 Drawer 标题**

找到:
```tsx
title={`强制订阅 — 链接: ${linkName}`}
```

改为:
```tsx
title={effectiveLevel === 'bot'
  ? `全局订阅配置 — 机器人: ${effectiveTargetName}`
  : `强制订阅 — 链接: ${effectiveTargetName}`}
```

- [ ] **Step 4: tsc 验证**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3/packages/client && pnpm exec tsc --noEmit
```

预期: EXIT 0(无 error)。

- [ ] **Step 5: Commit**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3
git add packages/client/src/components/SubscriptionGateDrawer.tsx
git commit -m "feat(client): SubscriptionGateDrawer 加 level prop 支持 bot 全局配置"
```

---

## Task 7: Bots.tsx 加「全局订阅配置」按钮

**Files:**
- Modify: `packages/client/src/pages/Bots.tsx`

- [ ] **Step 1: 加 state + 处理函数**

打开 `/mnt/d/ProjectKaka/sourceBotV3/packages/client/src/pages/Bots.tsx`。

(a) 找到顶部 imports 区,确认已有 `SubscriptionGateDrawer` 的 import。如果没有,加:

```tsx
import SubscriptionGateDrawer from '@/components/SubscriptionGateDrawer';
```

(b) 在 Bots 组件函数内,已有的 state 区域追加 2 个 state:

```tsx
  const [botGateDrawerOpen, setBotGateDrawerOpen] = useState(false);
  const [botGateTarget, setBotGateTarget] = useState<{ id: number; name: string } | null>(null);
```

- [ ] **Step 2: 在操作列加按钮**

在 Bots 页面的 `<Table>` columns 配置中,找到操作列(应包含编辑/删除按钮)。加一个新按钮(在编辑前面),需要 `LockOutlined` 或类似 icon。优先复用现有 icon import,如未有则加:

```tsx
import { ..., LockOutlined } from '@ant-design/icons';
```

在操作列 render 函数内加:

```tsx
<Button
  size="small"
  type="text"
  icon={<LockOutlined />}
  title="全局订阅配置"
  onClick={() => {
    setBotGateTarget({ id: record.id, name: record.name });
    setBotGateDrawerOpen(true);
  }}
/>
```

放在编辑按钮之前(操作列从左到右第一个)。

- [ ] **Step 3: 在 return 末尾加 Drawer**

在 Bots 组件 return 的最末尾 fragment 之前(`</>` 之前)加:

```tsx
      <SubscriptionGateDrawer
        level="bot"
        targetId={botGateTarget?.id ?? null}
        targetName={botGateTarget?.name ?? ''}
        open={botGateDrawerOpen}
        onClose={() => setBotGateDrawerOpen(false)}
      />
```

- [ ] **Step 4: tsc 验证**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3/packages/client && pnpm exec tsc --noEmit
```

预期: EXIT 0。

- [ ] **Step 5: Commit**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3
git add packages/client/src/pages/Bots.tsx
git commit -m "feat(client): 机器人管理页加「全局订阅配置」按钮 + Drawer"
```

---

## Task 8: 全包 tsc + 测试回归

- [ ] **Step 1: 全包 tsc**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3 && pnpm -r --filter shared --filter server --filter bot --filter client exec tsc --noEmit 2>&1 | tail -10
```

预期: EXIT 0(无输出)

- [ ] **Step 2: bot 测试**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3/packages/bot
pnpm exec tsx src/services/subscription-check.test.ts
pnpm exec tsx src/services/random-resource.test.ts
pnpm exec tsx src/services/favorite-list.test.ts
```

3 个测试都应该 `✓ ... passed`。

---

## Task 9: 部署

- [ ] **Step 1: Push**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3 && git push origin main
```

- [ ] **Step 2: 远程备份 + pull + db push + build + restart**

```bash
ssh root@43.154.76.165 'set -e
cd /opt/sourceBotV3
TS=$(date +%Y%m%d-%H%M%S)
PGPASSWORD=sourcebotv3_pass pg_dump -h localhost -U postgres -d sourcebotv3 -Fc -f /opt/backups/sourcebotv3/db-$TS.dump
cp .env /opt/backups/sourcebotv3/env-$TS.bak
cp ecosystem.config.js /opt/backups/sourcebotv3/ecosystem-$TS.bak
git stash push -m "deploy-$TS" -- .env ecosystem.config.js
git pull --ff-only origin main
git stash pop
pnpm install --frozen-lockfile
set -a; source .env; set +a
cd packages/server && pnpm exec prisma db push && pnpm exec prisma generate
cd /opt/sourceBotV3
pnpm -r --filter shared build
pnpm -r --filter server build
pnpm -r --filter bot build
pnpm -r --filter client build
pm2 restart api-server bot-runner
sleep 2
pm2 list | grep -E "api-server|bot-runner"'
```

预期: 全部 online。

- [ ] **Step 3: 手测验证**

(a) 打开后台「机器人管理」→ 某 bot 行点「全局订阅配置」按钮 → Drawer 打开,标题 `全局订阅配置 — 机器人: xxx`
(b) 加一个主频道,开启 isEnabled,保存
(c) 新建一条链接(不为它配 link gate)→ 用户 /start 该链接 → 应触发订阅 prompt(用 bot 全局 gate)
(d) 旧链接(已配 link gate)行为不变

---

## Self-Review

**Spec coverage:**
- BotSubscriptionGate 表 → T1 ✓
- SubscriptionGateChannel.botGateId / gateId nullable → T1 ✓
- BotSubscriptionGateService → T2 ✓
- 路由镜像 → T3 ✓
- subscription-check 双缓存 + fallback → T4 ✓
- 测试 fallback case → T5 ✓
- Drawer level prop → T6 ✓
- Bots.tsx 按钮 → T7 ✓

**Placeholder scan:** 无 TBD/TODO/"similar to"。

**Type 一致性:**
- `_setBotGateCacheForTests(cache, ltb)` 签名在 T4 定义,T5 调用一致 ✓
- `level: 'link' | 'bot'` + `targetId` / `targetName` 在 T6 定义,T7 caller 用相同名 ✓
- `BotSubscriptionGateService` 方法名与 `SubscriptionGateService` 对应(getOrCreate / update / addChannel / removeChannel / recheckChannel / updateSponsorPositions / reorderSponsorChannels) ✓

## 代码量复核

| 类别 | 行数 |
|---|---|
| schema 改动 | ~25 |
| BotSubscriptionGateService | ~220 |
| 路由 + 挂载 | ~120 |
| subscription-check 改造 | ~60 |
| 测试 case | ~40 |
| Drawer 改造 | ~30 |
| Bots.tsx 按钮 | ~20 |
| **合计** | **~515 行** |

与 spec 估算一致。
