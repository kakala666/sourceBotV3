# Telegram 中转转发存储 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把新采集的媒体从「下载+上传 Wasabi S3」改为「频道即存储」——采集时只记 `chatId+messageId`,其他 bot 首次发送时用 `forwardMessage` 抓自己视角的 file_id 缓存,彻底去掉 `/tmp` 下载这条磁盘灾难根因。

**Architecture:** 在 `MediaFile` 上加 `sourceChatId/sourceMessageId` 快照字段。发送解析优先级改为:缓存命中 → relay 转发抓取 → (老资源)S3 回退 → 失败标错。新增 `relay-fileid.ts` 串行+429 重试模块,采集端停止 S3 上传、`filePath` 存空串。老资源(`filePath` 以 `s3:` 开头、无 source 字段)行为完全不变。

**Tech Stack:** TypeScript + grammY + Prisma(PostgreSQL)。测试用 `node:assert` + `tsx` 直跑(项目现有风格,无 jest/vitest),依赖注入 mock。

---

## 背景对照(实现前必读)

设计文档:`docs/superpowers/specs/2026-06-03-telegram-relay-storage-design.md`

落地现状核查(2026-06-10):设计**完全未实现**,代码仍是纯 S3 方案。

关键事实(已核对源码):
- 所有加载 `mediaFiles` 的查询用的都是 Prisma `include`(不是 `select`),新增标量字段会自动带出,**无需改任何一条业务查询**。
- 发送入口有三处:`sender.ts`(用户浏览主流程,核心)、`sender-direct.ts`(广播主动推送)、`notify-resource.ts`(走 sender-direct)。
- `extractFileId` 在 `sender.ts` 和 `sender-direct.ts` 各有一份完全相同的实现。
- 媒体组每条 media 是独立 Telegram 消息、各有独立 `message_id`;采集端 `bufferMediaGroupMessage` 已逐条把 `messageId` 存进 buffer(`docs` 第 55 行所说"buffer 里已有")。
- 项目无 migrations 目录,schema 用 `prisma db push` 应用(见 `DEPLOY.md:123`)。
- `getSystemSetting<T>(key, default)` 已存在于 `content.ts`,可直接复用读 `relayGroupId`。

## 运维前提(不在代码内,部署时人工保证)

- 所有对外 bot 是所有采集频道成员 + 中转群成员。
- 所有采集频道关闭"限制保存内容(Restrict Saving Content)",否则 API forward 被拒。
- 中转群 id 写入 `SystemSetting`,key=`relayGroupId`,value 为字符串形态的群 chatId(如 `"-1001234567890"`)。本期不做后台 UI,手动写库:

```sql
INSERT INTO "SystemSetting"(key, value) VALUES ('relayGroupId', '"-1001234567890"')
ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value;
```

---

## File Structure

- **新建** `packages/bot/src/services/media-fileid.ts` — 抽出共享 `extractFileId`,打破 sender↔relay 循环依赖。
- **新建** `packages/bot/src/services/media-fileid.test.ts`
- **新建** `packages/bot/src/services/relay-fileid.ts` — `getRelayGroupId` + `fetchFileIdViaRelay`(串行 + 429 重试)。
- **新建** `packages/bot/src/services/relay-fileid.test.ts`
- **改** `packages/server/prisma/schema.prisma` — `MediaFile` 加两字段。
- **改** `packages/bot/src/services/sender.ts` — 用共享 `extractFileId`;类型加 source 字段;发送解析插入 relay 步;`resolveLocalPath` 空串守卫。
- **改** `packages/bot/src/services/sender-direct.ts` — 同上(广播路径)。
- **改** `packages/bot/src/services/channel-collector.ts` — 写 source 字段、`filePath` 存空串、移除 S3 上传调用。

---

## Task 1: Schema 加 source 快照字段

**Files:**
- Modify: `packages/server/prisma/schema.prisma:161-184`(`model MediaFile`)

- [ ] **Step 1: 加字段**

在 `model MediaFile` 内 `uploadError` 字段之后、`createdAt` 之前插入:

```prisma
  // 频道即存储:该 media 在来源采集频道里的位置快照(转发抓 file_id 用)。
  // 两字段都非空 = 可走 relay 转发路径;否则走老 S3 路径。
  // 快照存这里而非靠 group 关联,因资源可被重新归类到别的 group。
  sourceChatId    BigInt?
  sourceMessageId Int?
```

- [ ] **Step 2: 应用到数据库 + 重新生成 client**

Run:
```bash
cd packages/server && npx prisma db push && npx prisma generate
```
Expected: `Your database is now in sync with your Prisma schema.` + `Generated Prisma Client`。

- [ ] **Step 3: 确认类型已生成**

Run: `grep -n "sourceMessageId" packages/server/node_modules/.prisma/client/index.d.ts | head -1`
Expected: 有匹配输出(字段进了生成的类型)。

- [ ] **Step 4: Commit**

```bash
git add packages/server/prisma/schema.prisma
git commit -m "feat(storage): MediaFile 加 sourceChatId/sourceMessageId 快照字段"
```

---

## Task 2: 抽共享 extractFileId 到 media-fileid.ts

打破后续 `sender.ts → relay-fileid.ts → extractFileId` 与 `sender.ts` 自身的循环依赖,并消除 sender / sender-direct 的重复实现。纯重构,行为不变。

**Files:**
- Create: `packages/bot/src/services/media-fileid.ts`
- Create: `packages/bot/src/services/media-fileid.test.ts`
- Modify: `packages/bot/src/services/sender.ts`(删除本地 `extractFileId`,改 import)
- Modify: `packages/bot/src/services/sender-direct.ts`(删除本地 `extractFileId`,改 import)

- [ ] **Step 1: 写失败测试**

`packages/bot/src/services/media-fileid.test.ts`:

```ts
import { strict as assert } from 'node:assert';
import { extractFileId } from './media-fileid';

// photo: 取最大尺寸(数组最后一个)
assert.equal(
  extractFileId({ photo: [{ file_id: 'a' }, { file_id: 'b' }] }, 'photo'),
  'b',
);
// video
assert.equal(extractFileId({ video: { file_id: 'v1' } }, 'video'), 'v1');
// document 兜底(任何 type 只要带 document)
assert.equal(extractFileId({ document: { file_id: 'd1' } }, 'photo'), 'd1');
// 空消息 → null
assert.equal(extractFileId({}, 'photo'), null);
// 缺字段不抛
assert.equal(extractFileId(null, 'photo'), null);

console.log('✓ extractFileId tests passed');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx tsx packages/bot/src/services/media-fileid.test.ts`
Expected: FAIL,报 `Cannot find module './media-fileid'`。

- [ ] **Step 3: 实现 media-fileid.ts**

```ts
/**
 * 从 Telegram 返回的 Message 中按媒体类型提取 file_id。
 * sender / sender-direct / relay-fileid 共用。
 */
export function extractFileId(message: any, mediaType: string): string | null {
  if (mediaType === 'photo' && message?.photo?.length) {
    // photo 是数组,取最大尺寸(最后一个)
    return message.photo[message.photo.length - 1].file_id;
  }
  if (mediaType === 'video' && message?.video) {
    return message.video.file_id;
  }
  if (message?.document) {
    return message.document.file_id;
  }
  return null;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx tsx packages/bot/src/services/media-fileid.test.ts`
Expected: `✓ extractFileId tests passed`

- [ ] **Step 5: sender.ts 改用共享版**

在 `sender.ts` 顶部 import 区(`import { getBotUsername } from './bot-meta';` 那行下面)加:

```ts
import { extractFileId } from './media-fileid';
```

删除 `sender.ts` 里本地的 `function extractFileId(message: any, mediaType: string): string | null { ... }` 整个定义(连同其上方的 `/** 从 Telegram 返回的消息中提取 file_id */` 注释块)。

- [ ] **Step 6: sender-direct.ts 改用共享版**

在 `sender-direct.ts` 顶部加 import(`import path from 'path';` 那行下面):

```ts
import { extractFileId } from './media-fileid';
```

删除 `sender-direct.ts` 里本地的 `function extractFileId(...) { ... }` 定义。

- [ ] **Step 7: 编译确认无破坏**

Run: `cd packages/bot && npx tsc --noEmit`
Expected: 无报错退出(exit 0)。

- [ ] **Step 8: Commit**

```bash
git add packages/bot/src/services/media-fileid.ts packages/bot/src/services/media-fileid.test.ts packages/bot/src/services/sender.ts packages/bot/src/services/sender-direct.ts
git commit -m "refactor(sender): 抽共享 extractFileId 到 media-fileid 模块"
```

---

## Task 3: relay-fileid.ts(转发抓 file_id + 串行 + 429 重试)

**Files:**
- Create: `packages/bot/src/services/relay-fileid.ts`
- Create: `packages/bot/src/services/relay-fileid.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/bot/src/services/relay-fileid.test.ts`:

```ts
import { strict as assert } from 'node:assert';
import {
  fetchFileIdViaRelay,
  _setRelayGroupIdCacheForTests,
} from './relay-fileid';

const noSleep = async () => {};

(async () => {
  // case 1: 未配置中转群 → 直接 null,不调 api
  _setRelayGroupIdCacheForTests(null);
  let called = false;
  const r1 = await fetchFileIdViaRelay(
    { forwardMessage: async () => { called = true; return {}; }, deleteMessage: async () => true },
    -100n, 5, 'photo', noSleep,
  );
  assert.equal(r1, null);
  assert.equal(called, false, '未配置时不应调 forwardMessage');

  // case 2: 正常转发 → 抓到 file_id,并删除中转消息
  _setRelayGroupIdCacheForTests('-100999');
  let deletedMsgId: number | null = null;
  const r2 = await fetchFileIdViaRelay(
    {
      forwardMessage: async (chatId: any, fromChatId: any, msgId: any) => {
        assert.equal(chatId, '-100999');
        assert.equal(fromChatId, -100);   // BigInt(-100) → Number
        assert.equal(msgId, 5);
        return { message_id: 777, photo: [{ file_id: 'p_small' }, { file_id: 'p_big' }] };
      },
      deleteMessage: async (_c: any, mid: number) => { deletedMsgId = mid; return true; },
    },
    -100n, 5, 'photo', noSleep,
  );
  assert.equal(r2, 'p_big');
  assert.equal(deletedMsgId, 777, '应删除中转消息');

  // case 3: 首次 429 → 等待后重试成功
  _setRelayGroupIdCacheForTests('-100999');
  let attempts = 0;
  const r3 = await fetchFileIdViaRelay(
    {
      forwardMessage: async () => {
        attempts++;
        if (attempts === 1) {
          const e: any = new Error('Too Many Requests');
          e.parameters = { retry_after: 1 };
          throw e;
        }
        return { message_id: 1, video: { file_id: 'v_ok' } };
      },
      deleteMessage: async () => true,
    },
    -100n, 9, 'video', noSleep,
  );
  assert.equal(r3, 'v_ok');
  assert.equal(attempts, 2, '应重试一次');

  // case 4: 非 429 错误 → null(触发回退),不抛
  _setRelayGroupIdCacheForTests('-100999');
  const r4 = await fetchFileIdViaRelay(
    {
      forwardMessage: async () => { throw new Error('message to forward not found'); },
      deleteMessage: async () => true,
    },
    -100n, 404, 'photo', noSleep,
  );
  assert.equal(r4, null);

  console.log('✓ relay-fileid tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx tsx packages/bot/src/services/relay-fileid.test.ts`
Expected: FAIL,报 `Cannot find module './relay-fileid'`。

- [ ] **Step 3: 实现 relay-fileid.ts**

```ts
import type { Api } from 'grammy';
import { getSystemSetting } from './content';
import { extractFileId } from './media-fileid';

/**
 * 频道即存储:用 forwardMessage 把来源频道里的某条 media 转发到中转群,
 * 从返回的 Message 抓"本 bot 视角"的 file_id,缓存后删除中转消息。
 * 转发是 Telegram 内部引用(不传文件本体),极快、零磁盘。
 */

// 中转群 id 缓存(字符串形态的 BigInt)。undefined=未读过,null=未配置。
let relayGroupIdCache: string | null | undefined = undefined;

export async function getRelayGroupId(): Promise<string | null> {
  if (relayGroupIdCache !== undefined) return relayGroupIdCache;
  const v = await getSystemSetting<string | null>('relayGroupId', null);
  relayGroupIdCache = v ? String(v) : null;
  return relayGroupIdCache;
}

/** 测试用:直接注入缓存,跳过 DB */
export function _setRelayGroupIdCacheForTests(v: string | null) {
  relayGroupIdCache = v;
}

/** 串行队列:所有 forward 排队执行,避免并发触发 429 */
let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(() => {}, () => {});
  return run as Promise<T>;
}

const MAX_RETRY = 3;
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type RelayApi = Pick<Api, 'forwardMessage' | 'deleteMessage'>;

/**
 * 转发抓 file_id。失败(非 429 / 重试耗尽 / 未配置中转群)返回 null,由调用方回退或标错。
 * media_group 每条 media 是独立 message,调用方逐条调用本函数。
 */
export async function fetchFileIdViaRelay(
  api: RelayApi,
  sourceChatId: bigint,
  sourceMessageId: number,
  type: string,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<string | null> {
  const relayGroupId = await getRelayGroupId();
  if (!relayGroupId) return null;

  return serialize(async () => {
    for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
      try {
        const fwd: any = await api.forwardMessage(
          relayGroupId,
          Number(sourceChatId),
          sourceMessageId,
        );
        const fileId = extractFileId(fwd, type);
        // 清理中转消息(失败忽略,不阻塞)
        if (fwd?.message_id != null) {
          Promise.resolve(api.deleteMessage(relayGroupId, fwd.message_id)).catch(() => {});
        }
        return fileId;
      } catch (err: any) {
        const retryAfter =
          err?.parameters?.retry_after ?? err?.error?.parameters?.retry_after;
        if (retryAfter && attempt < MAX_RETRY) {
          await sleep((Number(retryAfter) + 1) * 1000);
          continue;
        }
        console.error(
          `[relay] forward 抓 file_id 失败 chat=${sourceChatId} msg=${sourceMessageId}:`,
          err?.message || err,
        );
        return null;
      }
    }
    return null;
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx tsx packages/bot/src/services/relay-fileid.test.ts`
Expected: `✓ relay-fileid tests passed`

- [ ] **Step 5: 编译确认**

Run: `cd packages/bot && npx tsc --noEmit`
Expected: exit 0。

- [ ] **Step 6: Commit**

```bash
git add packages/bot/src/services/relay-fileid.ts packages/bot/src/services/relay-fileid.test.ts
git commit -m "feat(storage): 新增 relay-fileid 转发抓 file_id 模块(串行+429重试)"
```

---

## Task 4: sender.ts 接入 relay(用户浏览主流程)

发送解析优先级改为:① 缓存命中 → ② source 字段齐全则 relay 抓取 → ③ v2 占位 → ④ `filePath` 非空走 S3/本地 → ⑤ 空串且无来源 → 抛错。

**Files:**
- Modify: `packages/bot/src/services/sender.ts`

- [ ] **Step 1: import relay**

在 `import { extractFileId } from './media-fileid';`(Task 2 加的)下面加:

```ts
import { fetchFileIdViaRelay } from './relay-fileid';
```

- [ ] **Step 2: 类型加 source 字段**

`MediaFileLike` 类型(约 234 行)改为:

```ts
type MediaFileLike = {
  id: number; filePath: string; type: string;
  duration?: number | null; width?: number | null; height?: number | null; thumbnailPath?: string | null;
  sourceChatId?: bigint | null; sourceMessageId?: number | null;
};
```

`sendResource` 入参里的 `resource.mediaFiles` 行内类型(约 532 行)和 `sendAd` 里的 `resource.mediaFiles`(约 598 行)各加 `sourceChatId?: bigint | null; sourceMessageId?: number | null;`,与上面保持一致。`sendPhoto` / `sendVideo` 的 `mediaFile` 形参类型同样补这两字段。

- [ ] **Step 3: resolveLocalPath 空串守卫**

`resolveLocalPath` 函数体开头(`if (!isS3Path(filePath)) {` 之前)加:

```ts
  if (!filePath) {
    // 新资源 filePath 为空串:只能靠缓存/relay,走到这里说明都失败了,无回退
    throw new Error('mediaFile filePath 为空且无 file_id 来源(relay 失败,无 S3 回退)');
  }
```

- [ ] **Step 4: sendPhoto 插入 relay 步**

在 `sendPhoto` 里,`cachedId` 失效回退块之后、`// v2-placeholder` 注释之前插入:

```ts
  // relay:source 字段齐全且无缓存时,转发抓本 bot file_id
  if (mediaFile.sourceChatId != null && mediaFile.sourceMessageId != null) {
    const relayId = await fetchFileIdViaRelay(ctx.api, mediaFile.sourceChatId, mediaFile.sourceMessageId, 'photo');
    if (relayId) {
      const msg = await ctx.replyWithPhoto(relayId, opts);
      const fid = extractFileId(msg, 'photo');
      if (fid) await saveCachedFileId(botId, mediaFile.id, fid);
      return msg;
    }
  }
```

- [ ] **Step 5: sendVideo 插入 relay 步**

在 `sendVideo` 里,`cachedId` 失效回退块之后、`// v2-placeholder` 注释之前插入:

```ts
  // relay:source 字段齐全且无缓存时,转发抓本 bot file_id
  if (mediaFile.sourceChatId != null && mediaFile.sourceMessageId != null) {
    const relayId = await fetchFileIdViaRelay(ctx.api, mediaFile.sourceChatId, mediaFile.sourceMessageId, 'video');
    if (relayId) {
      const vopts: any = { supports_streaming: true };
      if (caption) vopts.caption = caption;
      if (caption && parseMode) vopts.parse_mode = parseMode;
      const msg = await ctx.replyWithVideo(relayId, vopts);
      const fid = extractFileId(msg, 'video');
      if (fid) await saveCachedFileId(botId, mediaFile.id, fid);
      if (thumbCleanup) thumbCleanup();
      return msg;
    }
  }
```

> 注:relay 发送用 Telegram 自带的 meta/缩略图(新资源没存 duration/width/thumbnail),故不复用 `opts`(其可能带本地缩略图 InputFile)。

- [ ] **Step 6: sendMediaGroupBatch 插入 relay 步**

在 `sendMediaGroupBatch` 里,`cachedIds` 那段 `await Promise.all(...)` 之后、`resolvedMain` 之前插入:

```ts
  // 2.5) relay:cache miss + 非 v2 + source 字段齐全 → 逐条转发抓(relay 内部串行)
  const relayIds: (string | null)[] = await Promise.all(
    mediaFiles.map((mf, i) => {
      if (cachedIds[i] || v2Ids[i]) return Promise.resolve(null);
      if (mf.sourceChatId == null || mf.sourceMessageId == null) return Promise.resolve(null);
      return fetchFileIdViaRelay(ctx.api, mf.sourceChatId, mf.sourceMessageId, mf.type);
    }),
  );
  // 抓到的 relay file_id 立即缓存(下次直接命中)
  await Promise.all(
    mediaFiles.map((mf, i) => (relayIds[i] ? saveCachedFileId(botId, mf.id, relayIds[i]!) : null)),
  );
```

把紧随其后的 `resolvedMain` 计算条件从 `cachedIds[i] || v2Ids[i]` 改为 `cachedIds[i] || v2Ids[i] || relayIds[i]`:

```ts
  const resolvedMain = await Promise.all(
    mediaFiles.map((mf, i) =>
      cachedIds[i] || v2Ids[i] || relayIds[i] ? Promise.resolve(null) : resolveLocalPath(mf.filePath),
    ),
  );
```

同理 `resolvedThumb` 的跳过条件 `if (cachedIds[i] || v2Ids[i])` 改为 `if (cachedIds[i] || v2Ids[i] || relayIds[i])`。

在批次内 source 选择处(`if (cachedId) { source = cachedId; } else if (v2Ids[i]) {...} else {...}`),在 `v2Ids[i]` 分支后、`else`(本地上传)分支前插入 relay 分支:

```ts
      } else if (relayIds[i]) {
        source = relayIds[i] as string;  // 已单独缓存,不计入 uploadedFromLocal
      } else {
```

最后,失效重试块里重新 resolve 的循环 `if (v2Ids[i]) continue;` 改为 `if (v2Ids[i] || relayIds[i]) continue;`,且 retry 的 source 映射 `v2Ids[i] ? (v2Ids[i] as string) : new InputFile(...)` 改为 `(v2Ids[i] || relayIds[i]) ? ((v2Ids[i] || relayIds[i]) as string) : new InputFile(resolvedMain[i]!.absPath)`。

- [ ] **Step 7: 编译确认**

Run: `cd packages/bot && npx tsc --noEmit`
Expected: exit 0。

- [ ] **Step 8: 回归现有发送相关测试**

Run: `npx tsx packages/bot/src/services/media-fileid.test.ts && npx tsx packages/bot/src/services/relay-fileid.test.ts`
Expected: 两个都 `✓ ... passed`。

- [ ] **Step 9: Commit**

```bash
git add packages/bot/src/services/sender.ts
git commit -m "feat(storage): sender 发送优先级接入 relay 转发抓取"
```

---

## Task 5: sender-direct.ts 接入 relay(广播主动推送)

新资源 `filePath` 为空串,`getAbsolutePath('')` 会解析成 uploads 根目录导致广播失败,故广播路径也必须接 relay。

**Files:**
- Modify: `packages/bot/src/services/sender-direct.ts`

- [ ] **Step 1: import relay + 类型加字段**

顶部加(`import { extractFileId } from './media-fileid';` 下面):

```ts
import { fetchFileIdViaRelay } from './relay-fileid';
```

`MediaFileLike` 类型加 `sourceChatId?: bigint | null; sourceMessageId?: number | null;`(与 sender.ts 一致)。

- [ ] **Step 2: getAbsolutePath 空串守卫**

`getAbsolutePath` 函数体开头加:

```ts
  if (!filePath) {
    throw new Error('mediaFile filePath 为空且无 file_id 来源(relay 失败,无 S3 回退)');
  }
```

- [ ] **Step 3: sendPhotoDirect 插 relay**

在 `sendPhotoDirect` 的 `cached` 失效回退块之后、`const msg = await api.sendPhoto(... new InputFile ...)` 之前插入:

```ts
  if (mf.sourceChatId != null && mf.sourceMessageId != null) {
    const relayId = await fetchFileIdViaRelay(api, mf.sourceChatId, mf.sourceMessageId, 'photo');
    if (relayId) {
      const m = await api.sendPhoto(chatId, relayId, opts);
      const f = extractFileId(m, 'photo');
      if (f) await saveCachedFileId(botId, mf.id, f);
      return m;
    }
  }
```

- [ ] **Step 4: sendVideoDirect 插 relay**

在 `sendVideoDirect` 的 `cached` 失效回退块之后、本地上传 `const msg = await api.sendVideo(... new InputFile ...)` 之前插入:

```ts
  if (mf.sourceChatId != null && mf.sourceMessageId != null) {
    const relayId = await fetchFileIdViaRelay(api, mf.sourceChatId, mf.sourceMessageId, 'video');
    if (relayId) {
      const vopts: any = { supports_streaming: true };
      if (caption) vopts.caption = caption;
      const m = await api.sendVideo(chatId, relayId, vopts);
      const f = extractFileId(m, 'video');
      if (f) await saveCachedFileId(botId, mf.id, f);
      return m;
    }
  }
```

- [ ] **Step 5: sendMediaGroupDirect 插 relay**

在批次循环内 `const cached = await getCachedFileId(botId, mf.id);` 之后,把 source 选择改为先试 relay:

```ts
      const cached = await getCachedFileId(botId, mf.id);
      const itemCaption = k === 0 ? (batchCaption ?? undefined) : undefined;
      let source: string | InputFile;
      let relayId: string | null = null;
      if (!cached && mf.sourceChatId != null && mf.sourceMessageId != null) {
        relayId = await fetchFileIdViaRelay(api, mf.sourceChatId, mf.sourceMessageId, mf.type);
        if (relayId) await saveCachedFileId(botId, mf.id, relayId);
      }
      if (cached) source = cached;
      else if (relayId) source = relayId;
      else {
        source = new InputFile(getAbsolutePath(mf.filePath));
        uploadedFromLocal.add(k);
      }
```

> 失效重试块(`catch` 里)仍走 `new InputFile(getAbsolutePath(...))`;新资源无本地副本时 `getAbsolutePath` 守卫会抛错,整批失败并被上层 catch 记录——符合设计"relay 失败 → 标错"。

- [ ] **Step 6: 编译确认**

Run: `cd packages/bot && npx tsc --noEmit`
Expected: exit 0。

- [ ] **Step 7: Commit**

```bash
git add packages/bot/src/services/sender-direct.ts
git commit -m "feat(storage): 广播 sender-direct 接入 relay 转发抓取"
```

---

## Task 6: channel-collector.ts 采集端切换(写 source、停 S3 上传、filePath 空串)

这是去掉磁盘灾难根因的一步:不再 `getFile` / 下载 `/tmp` / ffmpeg / 传 S3。

**Files:**
- Modify: `packages/bot/src/services/channel-collector.ts`

- [ ] **Step 1: 媒体组 buffer 记 sourceChatId**

`MediaGroupBufferEntry` 类型(约 70 行)加字段:

```ts
type MediaGroupBufferEntry = {
  resourceGroupId: number;
  botId: number;
  caption: string | null;
  sourceChatId: bigint;
  items: { meta: PostMeta; messageId: number }[];
  timer: NodeJS.Timeout;
  lastCtx: Context;
};
```

`bufferMediaGroupMessage` 里 `entry = { ... }` 初始化对象加 `sourceChatId: BigInt(post.chat.id),`(放在 `botId` 后即可)。

- [ ] **Step 2: persistSingleMedia 写 source + 空 filePath + 停 S3**

`persistSingleMedia` 里 `mediaFiles.create` 数组那一项改为:

```ts
        create: [{
          type: meta.type,
          filePath: '',
          fileName: meta.originalFileName,
          mimeType: meta.mimeType,
          fileSize: meta.fileSize,
          sortOrder: 0,
          uploadError: null,
          sourceChatId: BigInt(post.chat.id),
          sourceMessageId: post.message_id,
        }],
```

删除该函数末尾的后台上传调用整块:

```ts
  // 后台: tdlight 下载 + S3 上传 + 视频缩略图
  uploadMediaToS3InBackground(ctx.api, botId, mf.id, {
    type: meta.type, fileId: meta.fileId, mimeType: meta.mimeType, s3Key: meta.s3Key,
  }).catch(() => { /* 失败已写 uploadError + 打 log */ });
```

(保留其上方的 `cacheIngestFileId` 与 `sendAssignmentPrompt` 调用不动——采集 bot 立即缓存自己的 file_id。)

- [ ] **Step 3: flushMediaGroup 写 source + 空 filePath + 停 S3**

`flushMediaGroup` 里 `mediaFiles.create` 的 `.map` 改为:

```ts
        create: entry.items.map((it, i) => ({
          type: it.meta.type,
          filePath: '',
          fileName: it.meta.originalFileName,
          mimeType: it.meta.mimeType,
          fileSize: it.meta.fileSize,
          sortOrder: i,
          uploadError: null,
          sourceChatId: entry.sourceChatId,
          sourceMessageId: it.messageId,
        })),
```

删除函数末尾整个后台并发上传循环:

```ts
  // 后台并发上传所有 mediaFile (semaphore 限并发)
  for (let i = 0; i < resource.mediaFiles.length; i++) {
    const mf = resource.mediaFiles[i];
    const m = entry.items[i].meta;
    uploadMediaToS3InBackground(entry.lastCtx.api, entry.botId, mf.id, {
      type: m.type, fileId: m.fileId, mimeType: m.mimeType, s3Key: m.s3Key,
    }).catch(() => { /* 失败已写 uploadError + 打 log */ });
  }
```

(保留其上的 `cacheIngestFileId` 循环与 `sendAssignmentPrompt` 不动。)

- [ ] **Step 4: 编译确认(允许 uploadMediaToS3InBackground 变为未使用)**

Run: `cd packages/bot && npx tsc --noEmit`
Expected: exit 0(tsconfig 未开 `noUnusedLocals`,死函数不报错;保留它供老资源"上传异常重试"工具链)。

- [ ] **Step 5: 全量回归测试**

Run:
```bash
npx tsx packages/bot/src/services/media-fileid.test.ts && \
npx tsx packages/bot/src/services/relay-fileid.test.ts && \
npx tsx packages/bot/src/services/subscription-check.test.ts && \
npx tsx packages/bot/src/services/random-resource.test.ts && \
npx tsx packages/bot/src/services/favorite-list.test.ts && \
npx tsx packages/bot/src/services/local-date.test.ts
```
Expected: 全部 `✓ ... passed`。

- [ ] **Step 6: Commit**

```bash
git add packages/bot/src/services/channel-collector.ts
git commit -m "feat(storage): 采集端改写 source 快照+空 filePath,停止 S3 下载上传"
```

---

## Task 7: 端到端手工验证(无法自动化的部分)

代码改完后,在真实环境按下面顺序验证。**这是关键验收,不可跳过。**

- [ ] **Step 1: 写中转群配置**

按"运维前提"那段 SQL 写入 `SystemSetting.relayGroupId`,确认所有对外 bot 已加入采集频道 + 中转群,且采集频道已关"限制保存内容"。重启 bot-runner(清空 relayGroupId 进程缓存)。

- [ ] **Step 2: 采集一条新单图/单视频**

在采集频道发一条图/视频。预期:频道里收到"✅ 已收录"反馈;DB 里新 `MediaFile` 的 `filePath=''`、`sourceChatId/sourceMessageId` 非空、`uploadError=null`;`/tmp` 下**无新增 `sb-*` 目录**(根因已去除)。

- [ ] **Step 3: 用另一个对外 bot 首次浏览该资源**

通过该 bot 的邀请链接进入并翻到这条新资源。预期:首发有 1~2 秒延迟(转发抓取),媒体正常显示;中转群里短暂出现再消失一条转发消息;DB `BotFileId` 新增该 bot 对该 mediaFile 的缓存。

- [ ] **Step 4: 同一 bot 再次浏览**

预期:秒发(走缓存,无延迟、无中转群消息)。

- [ ] **Step 5: 采集并验证媒体组(相册)**

发一个 3~4 张的相册,另一 bot 首次浏览。预期:逐条转发抓取后整组正常显示,顺序与频道一致;之后再看秒发。

- [ ] **Step 6: 老资源回归**

浏览一条改造前就存在的老资源(`filePath` 以 `s3:` 开头)。预期:行为完全不变,正常从 S3/缓存发送。

---

## Self-Review(已核对)

- **Spec 覆盖**:数据模型(T1)、relay 模块 + 串行 + 429(T3)、发送优先级(T4/T5)、采集改动 + 停 S3 + 空 filePath(T6)、中转群 id 配置(运维段 + T7)、向后兼容老资源走 S3(T4 守卫 + T7S6)——全部对应到任务。
- **媒体组**:每条独立 `message_id`,采集逐条记(T6S3 `it.messageId`)、发送逐条 relay(T4S6 / T5S5),与设计 82–83 行一致。
- **类型一致**:`sourceChatId?: bigint | null` / `sourceMessageId?: number | null` 在 schema(BigInt?/Int?)、sender、sender-direct 三处签名统一;`extractFileId` 抽出后单一来源。
- **YAGNI**:不做预热抓取、不做老资源迁移、中转群 id 不做后台 UI——与设计"不做"段一致。
- **去重根因**:T6 移除 `getFile`/tmp 下载/ffmpeg/S3 上传调用,新资源不再触碰 `/tmp`。
