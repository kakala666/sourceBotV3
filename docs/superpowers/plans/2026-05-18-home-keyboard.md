# 常驻键盘(随便看看 / 我的收藏) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 bot 加 2 个常驻 reply keyboard 按钮:🎲 随便看看(随机 1 条)、⭐ 我的收藏(收藏列表浏览)

**Architecture:** 复用 UserSession 表,加 `mode` + `payload` 字段区分 link / favorite / single 三种浏览模式。复用现有 processNextPage / processReveal,在内部按 mode 分流取序列或当前资源。新建 `home-keyboard.ts` 处理两个新入口的消息 handler;`bot-manager` 用 `bot.hears` 注册按钮文字。

**Tech Stack:** Prisma / grammy / Node TypeScript / pnpm workspace。Tests: `node:test`-style IIFE + `tsx`(沿用 `subscription-check.test.ts` 模式)。

**Spec:** [`docs/superpowers/specs/2026-05-18-home-keyboard-design.md`](../specs/2026-05-18-home-keyboard-design.md)

---

## Task 1: Schema 加 UserSession.mode + payload

**Files:**
- Modify: `packages/server/prisma/schema.prisma`

- [ ] **Step 1: 编辑 schema**

在 `model UserSession { ... }` 块里 `updatedAt` 之后加 2 行:

```prisma
model UserSession {
  id           Int      @id @default(autoincrement())
  botUserId    Int
  currentIndex Int      @default(0)
  isCompleted  Boolean  @default(false)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  mode         String   @default("link")  // 'link' | 'favorite' | 'single'
  payload      Json?

  botUser BotUser @relation(fields: [botUserId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 2: 本地 generate(只跑 client,不 push DB)**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3/packages/server && pnpm exec prisma generate
```

预期输出: `✔ Generated Prisma Client`

- [ ] **Step 3: Commit**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3
git add packages/server/prisma/schema.prisma
git commit -m "feat(schema): UserSession 加 mode + payload 支持 single/favorite 浏览模式"
```

---

## Task 2: shared types 加 welcomeText

**Files:**
- Modify: `packages/shared/src/types/settings.ts`

- [ ] **Step 1: 加 welcomeText 字段**

在 `SystemSettings` interface 末尾加一行:

```ts
export interface SystemSettings {
  endContent: { text: string; buttons?: { text: string; url: string }[] };
  adDisplaySeconds: number;
  statsGroupId: string;
  autoReplyAd: AutoReplyAdConfig;
  centralAuthEnabled: boolean;
  verifyCodeEnabled: boolean;
  searchMoreUrl: string;
  welcomeText: string;
}
```

- [ ] **Step 2: Build shared**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3 && pnpm -r --filter shared build
```

预期: 无错误

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/settings.ts packages/shared/dist
git commit -m "feat(shared): SystemSettings 加 welcomeText 字段"
```

---

## Task 3: bot getWelcomeText helper

**Files:**
- Modify: `packages/bot/src/services/content.ts`

- [ ] **Step 1: 加 helper 函数(放在 getSearchMoreUrl 之后)**

打开 `packages/bot/src/services/content.ts`,在 `getSearchMoreUrl` 之后加:

```ts
/**
 * 获取欢迎语(/start 时显示在 reply keyboard 旁边)
 */
export async function getWelcomeText(): Promise<string> {
  return getSystemSetting<string>('welcomeText', '欢迎使用 👋\n使用下方按钮开启探索');
}
```

- [ ] **Step 2: tsc 验证**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3/packages/bot && pnpm exec tsc --noEmit
```

预期: EXIT 0

- [ ] **Step 3: Commit**

```bash
git add packages/bot/src/services/content.ts
git commit -m "feat(bot): 加 getWelcomeText helper 默认值 '欢迎使用 👋...'"
```

---

## Task 4: 随机资源服务 + 测试

**Files:**
- Create: `packages/bot/src/services/random-resource.ts`
- Create: `packages/bot/src/services/random-resource.test.ts`

- [ ] **Step 1: 创建服务文件**

```ts
// packages/bot/src/services/random-resource.ts
import prisma from '../prisma';

export interface RandomResource {
  id: number;
  type: string;
  caption: string | null;
  mediaFiles: any[];
}

let prismaRef: any = prisma;
export function _setPrismaForTests(p: any) { prismaRef = p; }

/**
 * 从「至少被一个 ContentBinding 引用过」的 Resource 中随机抽 1 条,
 * 包含按 sortOrder 排好的 mediaFiles。
 * 资源池为空时返回 null。
 */
export async function pickRandomContentResource(): Promise<RandomResource | null> {
  const rows = await prismaRef.$queryRaw<{ id: number }[]>`
    SELECT r.id
    FROM "Resource" r
    WHERE EXISTS (SELECT 1 FROM "ContentBinding" cb WHERE cb."resourceId" = r.id)
    ORDER BY random()
    LIMIT 1;
  `;
  if (rows.length === 0) return null;
  const r = await prismaRef.resource.findUnique({
    where: { id: rows[0].id },
    include: { mediaFiles: { orderBy: { sortOrder: 'asc' } } },
  });
  return r;
}
```

- [ ] **Step 2: 写失败测试**

```ts
// packages/bot/src/services/random-resource.test.ts
import { strict as assert } from 'node:assert';
import { pickRandomContentResource, _setPrismaForTests } from './random-resource';

(async () => {
  // case 1: 资源池为空 → null
  _setPrismaForTests({
    $queryRaw: async () => [],
    resource: { findUnique: async () => null },
  });
  let r = await pickRandomContentResource();
  assert.equal(r, null);

  // case 2: 抽到 1 条 → 返回带 mediaFiles
  _setPrismaForTests({
    $queryRaw: async () => [{ id: 42 }],
    resource: {
      findUnique: async ({ where }: any) => {
        assert.equal(where.id, 42);
        return { id: 42, type: 'photo', caption: 'x', mediaFiles: [{ id: 1 }] };
      },
    },
  });
  r = await pickRandomContentResource();
  assert.equal(r?.id, 42);
  assert.equal(r?.mediaFiles.length, 1);

  console.log('✓ pickRandomContentResource tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: 运行测试**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3/packages/bot && pnpm exec tsx src/services/random-resource.test.ts
```

预期: `✓ pickRandomContentResource tests passed`

- [ ] **Step 4: tsc 验证**

```bash
pnpm exec tsc --noEmit
```

预期: EXIT 0

- [ ] **Step 5: Commit**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3
git add packages/bot/src/services/random-resource.ts packages/bot/src/services/random-resource.test.ts
git commit -m "feat(bot): 随机资源服务(从 ContentBinding 引用过的 Resource 抽 1)"
```

---

## Task 5: 收藏列表服务 + 测试

**Files:**
- Create: `packages/bot/src/services/favorite-list.ts`
- Create: `packages/bot/src/services/favorite-list.test.ts`

- [ ] **Step 1: 创建服务文件**

```ts
// packages/bot/src/services/favorite-list.ts
import prisma from '../prisma';

export interface FavoriteItem {
  resource: {
    id: number;
    type: string;
    caption: string | null;
    mediaFiles: any[];
  };
  buttons: null;
  sortOrder: number;
}

let prismaRef: any = prisma;
export function _setPrismaForTests(p: any) { prismaRef = p; }

/**
 * 加载某 botUser 的全部收藏,按 createdAt desc 排序,
 * 转成与 loadContentBindings 兼容的形状(buttons=null,sortOrder=i)。
 */
export async function loadFavoriteList(botUserId: number): Promise<FavoriteItem[]> {
  const favs = await prismaRef.favoriteResource.findMany({
    where: { botUserId },
    orderBy: { createdAt: 'desc' },
    include: {
      resource: { include: { mediaFiles: { orderBy: { sortOrder: 'asc' } } } },
    },
  });
  return favs.map((f: any, i: number) => ({
    resource: f.resource,
    buttons: null,
    sortOrder: i,
  }));
}
```

- [ ] **Step 2: 写失败测试**

```ts
// packages/bot/src/services/favorite-list.test.ts
import { strict as assert } from 'node:assert';
import { loadFavoriteList, _setPrismaForTests } from './favorite-list';

(async () => {
  // case 1: 空 → []
  _setPrismaForTests({
    favoriteResource: { findMany: async () => [] },
  });
  let r = await loadFavoriteList(1);
  assert.deepEqual(r, []);

  // case 2: 3 条 → 顺序 + 形状
  _setPrismaForTests({
    favoriteResource: {
      findMany: async ({ where, orderBy }: any) => {
        assert.equal(where.botUserId, 7);
        assert.equal(orderBy.createdAt, 'desc');
        return [
          { resource: { id: 100, type: 'photo', mediaFiles: [] } },
          { resource: { id: 99, type: 'video', mediaFiles: [{ id: 1 }] } },
          { resource: { id: 98, type: 'media_group', mediaFiles: [] } },
        ];
      },
    },
  });
  r = await loadFavoriteList(7);
  assert.equal(r.length, 3);
  assert.equal(r[0].resource.id, 100);
  assert.equal(r[0].sortOrder, 0);
  assert.equal(r[2].sortOrder, 2);
  assert.equal(r[0].buttons, null);

  console.log('✓ loadFavoriteList tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: 运行测试**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3/packages/bot && pnpm exec tsx src/services/favorite-list.test.ts
```

预期: `✓ loadFavoriteList tests passed`

- [ ] **Step 4: Commit**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3
git add packages/bot/src/services/favorite-list.ts packages/bot/src/services/favorite-list.test.ts
git commit -m "feat(bot): 收藏列表服务 loadFavoriteList(按 createdAt desc)"
```

---

## Task 6: session.ts 扩展 + loadSequenceForSession

**Files:**
- Modify: `packages/bot/src/services/session.ts`

- [ ] **Step 1: 先看现有 resetSession 签名**

```bash
grep -n "export.*function" /mnt/d/ProjectKaka/sourceBotV3/packages/bot/src/services/session.ts
```

记下 `resetSession` 的现有签名,准备扩展。

- [ ] **Step 2: 扩展 resetSession 接受 mode + payload**

在 `resetSession` 内,把 `prisma.userSession.create` 的 `data` 增加 mode/payload(从可选参数读取);未传时默认 link/null。完整改后函数:

```ts
export async function resetSession(
  botUserId: number,
  options?: { mode?: 'link' | 'favorite' | 'single'; payload?: any },
): Promise<{ id: number }> {
  // 先把旧 session 标 completed,避免并发
  await prisma.userSession.updateMany({
    where: { botUserId, isCompleted: false },
    data: { isCompleted: true },
  });
  return prisma.userSession.create({
    data: {
      botUserId,
      currentIndex: 0,
      isCompleted: false,
      mode: options?.mode ?? 'link',
      payload: options?.payload ?? null,
    },
  });
}
```

**注意:** 如果现有 `resetSession` 的实现有别(比如不带 updateMany),保留原行为,仅在 `data` 里追加 mode/payload 字段。其他 caller(如 handleStart)仍兼容(不传 options 默认 link)。

- [ ] **Step 3: 加 loadSequenceForSession**

在文件末尾追加:

```ts
import { loadContentBindings } from './content';
import { loadFavoriteList } from './favorite-list';

export interface SequenceItem {
  resource: {
    id: number;
    type: string;
    caption: string | null;
    mediaFiles: any[];
  };
  buttons: { text: string; url: string }[] | null;
  sortOrder: number;
}

/**
 * 根据 session.mode 取浏览序列。
 *   link     → loadContentBindings(botUser.inviteLinkId)
 *   favorite → loadFavoriteList(botUserId)
 *   single   → [{ resource: <payload.resourceId 对应资源>, buttons: null, sortOrder: 0 }]
 */
export async function loadSequenceForSession(session: {
  id: number;
  mode: string;
  payload: any;
  botUser: { id: number; inviteLinkId: number };
}): Promise<SequenceItem[]> {
  if (session.mode === 'favorite') {
    return loadFavoriteList(session.botUser.id);
  }
  if (session.mode === 'single') {
    const resourceId = session.payload?.resourceId;
    if (!resourceId) return [];
    const r = await prisma.resource.findUnique({
      where: { id: resourceId },
      include: { mediaFiles: { orderBy: { sortOrder: 'asc' } } },
    });
    return r ? [{ resource: r as any, buttons: null, sortOrder: 0 }] : [];
  }
  // 默认 link
  return loadContentBindings(session.botUser.inviteLinkId) as any;
}
```

**注意:** `loadContentBindings` 当前返回的形状与 `SequenceItem` 兼容(含 buttons + resource + mediaFiles)。若签名差异,用 `as any` 桥接。

- [ ] **Step 4: tsc 验证**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3/packages/bot && pnpm exec tsc --noEmit
```

预期: EXIT 0

- [ ] **Step 5: Commit**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3
git add packages/bot/src/services/session.ts
git commit -m "feat(bot): session 扩展 mode/payload + loadSequenceForSession"
```

---

## Task 7: sender.ts 加 buildHomeReplyKeyboard

**Files:**
- Modify: `packages/bot/src/services/sender.ts`

- [ ] **Step 1: 加 Keyboard import**

确认 `sender.ts` 顶部 import:
```ts
import { InputFile, InputMediaBuilder, InlineKeyboard, Keyboard } from 'grammy';
```

如已有 `InlineKeyboard` import,在它后面追加 `, Keyboard`。

- [ ] **Step 2: 在文件末尾(`export { buildPageKeyboard, buildContentKeyboard };` 之前)加 helper**

```ts
/**
 * 常驻底部 reply keyboard:🎲 随便看看 / ⭐ 我的收藏
 * 一旦发出,Telegram 客户端持续显示直到 ReplyKeyboardRemove。
 */
export function buildHomeReplyKeyboard(): Keyboard {
  return new Keyboard()
    .text('🎲 随便看看').text('⭐ 我的收藏')
    .resized().persistent();
}
```

- [ ] **Step 3: tsc 验证**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3/packages/bot && pnpm exec tsc --noEmit
```

预期: EXIT 0

- [ ] **Step 4: Commit**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3
git add packages/bot/src/services/sender.ts
git commit -m "feat(bot): 加 buildHomeReplyKeyboard(🎲 随便看看 / ⭐ 我的收藏)"
```

---

## Task 8: home-keyboard.ts handlers(随便看看 + 我的收藏)

**Files:**
- Create: `packages/bot/src/handlers/home-keyboard.ts`

- [ ] **Step 1: 创建文件**

```ts
// packages/bot/src/handlers/home-keyboard.ts
import type { Context } from 'grammy';
import prisma from '../prisma';
import { upsertBotUser, resetSession } from '../services/session';
import { sendResource, buildContentKeyboard } from '../services/sender';
import { pickRandomContentResource } from '../services/random-resource';
import { loadFavoriteList } from '../services/favorite-list';
import { ensureSubscribed, getGateConfig } from '../services/subscription-check';
import { sendSubscriptionPrompt } from '../services/subscription-prompt';
import { getSearchMoreUrl } from '../services/content';

/**
 * 🎲 随便看看:订阅检查 → 随机 1 资源 → 单条发送(带展开?+ 收藏,无翻页/搜索更多)
 */
export async function handleRandomBrowse(ctx: Context, botId: number) {
  const from = ctx.from;
  if (!from) return;

  const botUser = await prisma.botUser.findFirst({
    where: { telegramId: BigInt(from.id), botId },
  });
  if (!botUser) {
    await ctx.reply('请先通过邀请链接 /start 一次');
    return;
  }

  const gateResult = await ensureSubscribed(botUser.inviteLinkId, botUser.telegramId, ctx.api);
  if (!gateResult.ok) {
    const config = getGateConfig(botUser.inviteLinkId);
    await sendSubscriptionPrompt(
      ctx, config?.promptTemplate, 0, 0, gateResult.missing, 'check_random',
    );
    return;
  }

  const resource = await pickRandomContentResource();
  if (!resource) {
    await ctx.reply('暂无可用资源,请稍后再试');
    return;
  }

  const session = await resetSession(botUser.id, { mode: 'single', payload: { resourceId: resource.id } });

  const allMediaFiles = resource.mediaFiles ?? [];
  const visibleMediaFiles = allMediaFiles.filter((mf: any) => !mf.isHidden);
  const hasHidden = visibleMediaFiles.length < allMediaFiles.length;
  const filteredResource = { ...resource, mediaFiles: visibleMediaFiles };
  const revealInfo = hasHidden ? { sessionId: session.id, currentIndex: 0 } : null;
  const favoriteInfo = { sessionId: session.id, resourceId: resource.id };

  const keyboard = buildContentKeyboard(null, undefined, undefined, revealInfo, undefined, favoriteInfo);
  try {
    await sendResource(ctx, botId, filteredResource as any, keyboard, resource.id);
  } catch (err: any) {
    console.error('[home] random 发送失败:', err.message);
    await ctx.reply('⚠️ 资源加载失败,请稍后重试');
  }
}

/**
 * ⭐ 我的收藏:订阅检查 → favorites 序列(按收藏时间 desc)→ 翻页浏览
 */
export async function handleFavoriteBrowse(ctx: Context, botId: number) {
  const from = ctx.from;
  if (!from) return;

  const botUser = await prisma.botUser.findFirst({
    where: { telegramId: BigInt(from.id), botId },
  });
  if (!botUser) {
    await ctx.reply('请先通过邀请链接 /start 一次');
    return;
  }

  const gateResult = await ensureSubscribed(botUser.inviteLinkId, botUser.telegramId, ctx.api);
  if (!gateResult.ok) {
    const config = getGateConfig(botUser.inviteLinkId);
    await sendSubscriptionPrompt(
      ctx, config?.promptTemplate, 0, 0, gateResult.missing, 'check_favorite',
    );
    return;
  }

  const favorites = await loadFavoriteList(botUser.id);
  if (favorites.length === 0) {
    await ctx.reply('你还没收藏过任何资源,在资源消息上点 ⭐ 收藏');
    return;
  }

  const session = await resetSession(botUser.id, { mode: 'favorite' });
  const first = favorites[0];

  const allMediaFiles = first.resource.mediaFiles ?? [];
  const visibleMediaFiles = allMediaFiles.filter((mf: any) => !mf.isHidden);
  const hasHidden = visibleMediaFiles.length < allMediaFiles.length;
  const filteredResource = { ...first.resource, mediaFiles: visibleMediaFiles };
  const revealInfo = hasHidden ? { sessionId: session.id, currentIndex: 0 } : null;
  const favoriteInfo = { sessionId: session.id, resourceId: first.resource.id };

  let keyboard;
  if (favorites.length > 1) {
    const searchMoreUrl = await getSearchMoreUrl();
    keyboard = buildContentKeyboard(null, session.id, 1, revealInfo, searchMoreUrl, favoriteInfo);
  } else {
    keyboard = buildContentKeyboard(null, undefined, undefined, revealInfo, undefined, favoriteInfo);
  }

  try {
    await sendResource(ctx, botId, filteredResource as any, keyboard, first.resource.id);
  } catch (err: any) {
    console.error('[home] favorite 发送失败:', err.message);
    await ctx.reply('⚠️ 资源加载失败,请稍后重试');
  }
}
```

**注意:** `upsertBotUser` 这里不需要(用户已通过 /start 注册过,我们只是 findFirst)。`upsertBotUser` 的 import 可以删掉,我留着以防 grep 改东西时方便看。完成后 tsc 会告警 unused import,移除即可。

- [ ] **Step 2: tsc 验证(可能要清掉 unused import)**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3/packages/bot && pnpm exec tsc --noEmit
```

如果报 `upsertBotUser` 未使用,删除 import 中的 `upsertBotUser`。再 tsc,EXIT 0。

- [ ] **Step 3: Commit**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3
git add packages/bot/src/handlers/home-keyboard.ts
git commit -m "feat(bot): 新增 handleRandomBrowse / handleFavoriteBrowse"
```

---

## Task 9: 改 start.ts 发欢迎 + reply keyboard

**Files:**
- Modify: `packages/bot/src/handlers/start.ts`

- [ ] **Step 1: 加 import**

```ts
import { sendResource, sendAd, sendEndContent, buildPageKeyboard, buildContentKeyboard, buildHomeReplyKeyboard } from '../services/sender';
import { loadContentBindings, loadAdBindings, getAdDisplaySeconds, getEndContent, getSearchMoreUrl, getWelcomeText } from '../services/content';
```

- [ ] **Step 2: 在 handleStart 内,发送资源之前先发欢迎 + reply keyboard**

找到 `handleStart` 函数里 `await sendFirstResource(...)` 这一行。**在它之前**插入:

```ts
  // 发欢迎文本 + reply keyboard(Telegram 客户端会持续显示)
  try {
    const welcomeText = await getWelcomeText();
    await ctx.reply(welcomeText, { reply_markup: buildHomeReplyKeyboard() });
  } catch (err: any) {
    console.error('[start] 发欢迎键盘失败:', err.message);
  }
```

- [ ] **Step 3: tsc 验证**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3/packages/bot && pnpm exec tsc --noEmit
```

预期: EXIT 0

- [ ] **Step 4: Commit**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3
git add packages/bot/src/handlers/start.ts
git commit -m "feat(bot): /start 发欢迎文本 + 常驻 reply keyboard"
```

---

## Task 10: callback.ts processNextPage 加 mode 分支

**Files:**
- Modify: `packages/bot/src/handlers/callback.ts`

- [ ] **Step 1: 加 import**

在已有 import 块里追加:

```ts
import { loadSequenceForSession } from '../services/session';
```

- [ ] **Step 2: 修改 processNextPage 内取序列的代码**

找到 `processNextPage` 函数内:
```ts
const contentBindings = await loadContentBindings(botUser.inviteLinkId);
```

改为:
```ts
const sequence = await loadSequenceForSession({
  id: session.id, mode: session.mode, payload: session.payload, botUser,
});
```

然后**全函数内**把 `contentBindings` 替换为 `sequence`(grep 该函数体内的所有 `contentBindings`)。

- [ ] **Step 3: 越界提示按 mode 分流**

找到 `processNextPage` 内的越界检查:
```ts
if (nextIndex >= totalContent) {
  await completeSession(sessionId);
  const endContent = await getEndContent();
  await sendEndContent(ctx, endContent);
  return;
}
```

改为:
```ts
if (nextIndex >= totalContent) {
  await completeSession(sessionId);
  if (session.mode === 'favorite') {
    await ctx.reply('你的收藏全部看完了 🎯');
  } else {
    const endContent = await getEndContent();
    await sendEndContent(ctx, endContent);
  }
  return;
}
```

**注意:** `totalContent` 现在是 `sequence.length`。如果原代码用 `contentBindings.length`,确认改 sequence.length。

- [ ] **Step 4: tsc 验证**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3/packages/bot && pnpm exec tsc --noEmit
```

预期: EXIT 0

- [ ] **Step 5: Commit**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3
git add packages/bot/src/handlers/callback.ts
git commit -m "feat(bot): processNextPage 按 session.mode 取序列;favorite 越界发独立结束提示"
```

---

## Task 11: callback.ts processReveal 加 mode 分支

**Files:**
- Modify: `packages/bot/src/handlers/callback.ts`

- [ ] **Step 1: 修改 processReveal 取序列**

找到 `processReveal` 函数内:
```ts
const contentBindings = await loadContentBindings(session.botUser.inviteLinkId);
const binding = contentBindings[currentIndex];
```

改为:
```ts
const sequence = await loadSequenceForSession({
  id: session.id, mode: session.mode, payload: session.payload, botUser: session.botUser,
});
const binding = sequence[currentIndex];
```

后续 `contentBindings` 引用也改为 `sequence`(主要是越界检查里的 `.length`)。

- [ ] **Step 2: tsc 验证**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3/packages/bot && pnpm exec tsc --noEmit
```

预期: EXIT 0

- [ ] **Step 3: Commit**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3
git add packages/bot/src/handlers/callback.ts
git commit -m "feat(bot): processReveal 按 session.mode 取当前资源"
```

---

## Task 12: callback.ts 加 check_random / check_favorite

**Files:**
- Modify: `packages/bot/src/handlers/callback.ts`

- [ ] **Step 1: 加 import**

在 import 块加:
```ts
import { handleRandomBrowse, handleFavoriteBrowse } from './home-keyboard';
```

- [ ] **Step 2: 加 check_random / check_favorite 分支**

找到 `handleCallback` 函数内的 `checkMatch` 块(`check_sub:` 处理),在它**之后**插入:

```ts
  // check_random:订阅校验后重新跑「随便看看」
  const checkRandomMatch = data.match(/^check_random:\d+:\d+$/);
  if (checkRandomMatch) {
    try {
      await ctx.answerCallbackQuery();
      await handleRandomBrowse(ctx, botId);
    } catch (err: any) {
      console.error('[callback] check_random 处理失败:', err.message);
    }
    return;
  }

  // check_favorite:订阅校验后重新跑「我的收藏」
  const checkFavMatch = data.match(/^check_favorite:\d+:\d+$/);
  if (checkFavMatch) {
    try {
      await ctx.answerCallbackQuery();
      await handleFavoriteBrowse(ctx, botId);
    } catch (err: any) {
      console.error('[callback] check_favorite 处理失败:', err.message);
    }
    return;
  }
```

- [ ] **Step 3: tsc 验证**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3/packages/bot && pnpm exec tsc --noEmit
```

预期: EXIT 0

- [ ] **Step 4: Commit**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3
git add packages/bot/src/handlers/callback.ts
git commit -m "feat(bot): 加 check_random / check_favorite callback 重跑入口"
```

---

## Task 13: bot-manager.ts 注册 hears

**Files:**
- Modify: `packages/bot/src/manager/bot-manager.ts`

- [ ] **Step 1: 加 import**

```ts
import { handleRandomBrowse, handleFavoriteBrowse } from '../handlers/home-keyboard';
```

- [ ] **Step 2: 在 registerHandlers 内加 hears**

找到 `registerHandlers` 函数里 `bot.command('start', ...)` 注册之**后**,加:

```ts
    // 常驻键盘按钮:🎲 随便看看
    bot.hears('🎲 随便看看', (ctx) => {
      handleRandomBrowse(ctx, botId).catch((err: any) => {
        console.error(`[Bot ${botId}] random 处理失败:`, err.message);
      });
    });

    // 常驻键盘按钮:⭐ 我的收藏
    bot.hears('⭐ 我的收藏', (ctx) => {
      handleFavoriteBrowse(ctx, botId).catch((err: any) => {
        console.error(`[Bot ${botId}] favorite 处理失败:`, err.message);
      });
    });
```

**注意:** grammy `bot.hears` 比 `bot.on('message', ...)` 优先级高,先 match;match 上的不再走后面的 message handler(因此不会触发 handleAutoReply)。

- [ ] **Step 3: tsc 验证**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3/packages/bot && pnpm exec tsc --noEmit
```

预期: EXIT 0

- [ ] **Step 4: Commit**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3
git add packages/bot/src/manager/bot-manager.ts
git commit -m "feat(bot): 注册 hears 按钮(🎲 随便看看 / ⭐ 我的收藏)"
```

---

## Task 14: client Settings.tsx 加 welcomeText 输入

**Files:**
- Modify: `packages/client/src/pages/Settings.tsx`

- [ ] **Step 1: 在 fetch 时 fallback 默认值**

找到现有的 `defaults` 对象:
```ts
const defaults: Partial<SystemSettings> = { searchMoreUrl: 'https://t.me/ssejqr88bot' };
```

改为:
```ts
const defaults: Partial<SystemSettings> = {
  searchMoreUrl: 'https://t.me/ssejqr88bot',
  welcomeText: '欢迎使用 👋\n使用下方按钮开启探索',
};
```

- [ ] **Step 2: 加 Form.Item**

找到 `searchMoreUrl` 的 Form.Item,在它**之后**加:

```tsx
          <Form.Item
            label="欢迎语(常驻键盘文案)"
            name="welcomeText"
            extra="用户 /start 时显示在底部 reply keyboard 之前的欢迎文字"
          >
            <TextArea rows={2} placeholder="欢迎使用 👋&#10;使用下方按钮开启探索" style={{ width: 400 }} />
          </Form.Item>
```

- [ ] **Step 3: tsc 验证**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3/packages/client && pnpm exec tsc --noEmit
```

预期: EXIT 0

- [ ] **Step 4: Commit**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3
git add packages/client/src/pages/Settings.tsx
git commit -m "feat(client): 系统设置加欢迎语 TextArea"
```

---

## Task 15: 全包 type-check + 既有测试回归

- [ ] **Step 1: 全包 tsc**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3 && pnpm -r --filter shared --filter server --filter bot --filter client exec tsc --noEmit
```

预期: 无 output,EXIT 0

- [ ] **Step 2: 跑既有 subscription-check 测试不退化**

```bash
cd /mnt/d/ProjectKaka/sourceBotV3/packages/bot && pnpm exec tsx src/services/subscription-check.test.ts
```

预期: `✓ ensureSubscribed tests passed (primary + sponsor)`

- [ ] **Step 3: 跑新加的 2 个测试**

```bash
pnpm exec tsx src/services/random-resource.test.ts
pnpm exec tsx src/services/favorite-list.test.ts
```

预期: 两条都 `✓ ... passed`

---

## Task 16: 部署

**Files:** 远程 `/opt/sourceBotV3`

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

预期: 全部 online,无错误

- [ ] **Step 3: 手测验证**

- 给 bot 发 /start jimu(或任意有 binding 的 link),应该收到欢迎文字 + reply keyboard
- 点 🎲 随便看看,收到 1 条资源(带 ⭐ 收藏,无下一页)
- 在某个资源上点 ⭐ 收藏 → 提示已收藏
- 点 ⭐ 我的收藏,看到刚收藏的资源,翻页正常
- 翻完最后一条 → 显示 `你的收藏全部看完了 🎯`

---

## Self-Review

**Spec coverage:**
- 常驻 2 个按钮: Task 7 + Task 13 ✓
- 随便看看: Task 4 + Task 8 ✓
- 我的收藏: Task 5 + Task 8 ✓
- 强制订阅 gate: Task 8(prompt) + Task 12(回调) ✓
- 欢迎语 SystemSetting: Task 2 + Task 3 + Task 9 + Task 14 ✓
- session mode/payload: Task 1 + Task 6 ✓
- processNextPage / processReveal 适配: Task 10 + Task 11 ✓
- favorite 越界提示: Task 10 ✓

**Type 一致性:**
- `loadSequenceForSession` 返回 `SequenceItem[]` 在 Task 6 定义,Task 10/11 用同名字段 ✓
- `buildContentKeyboard` 签名已含 `favoriteInfo`(之前任务已加),Task 8 用一致参数顺序 ✓
- `resetSession` Task 6 加 options 参数,Task 8 调用一致 ✓

**Placeholder 扫描:**
- 所有步骤都有可执行命令或完整代码块 ✓
- 注意有几处"找到 X 函数内的 Y 行"指引(Task 10/11),需要执行人 grep 定位 — 这是必要的,因为现有代码已经有 callback handler。

**Scope:** 单 feature plan,无需拆分。

---

## 代码量复核

- 新增文件: 4 个(random-resource + favorite-list + home-keyboard + 2 个测试) 共 ~370 行
- 修改文件: 9 个,改动小 ~150 行
- **合计 ~500 行**,与 spec 预估一致。
