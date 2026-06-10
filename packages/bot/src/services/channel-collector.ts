import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import fs from 'fs';
import os from 'os';
import path from 'path';
import prisma from '../prisma';
import { sendResource } from './sender';
import { getVideoMeta, generateThumbnail } from '../utils/video';
import { uploadLocalFile, makeS3Path } from './storage';

/** 激活指令(精确匹配,trim 后) */
export const ACTIVATION_COMMAND = 'kakaco';

/** 重设指令(精确匹配,trim 后) — 弹分页键盘选某条资源重新设置可见性 */
const RESET_COMMAND = '重设';

/** 重设键盘每页条数 */
const RESET_PAGE_SIZE = 20;

/** 媒体组消息聚合 debounce */
const MEDIA_GROUP_DEBOUNCE_MS = 2000;

/**
 * 频道下载并发开关 - 来自 env CHANNEL_DOWNLOAD_CONCURRENCY
 *   - 未配置 / 0 / 1:串行(等同历史行为)
 *   - N >= 2:启用 semaphore,最多同时 N 个 downloadCurrentMedia 任务
 */
const CHANNEL_DOWNLOAD_CONCURRENCY = (() => {
  const raw = parseInt(process.env.CHANNEL_DOWNLOAD_CONCURRENCY || '1', 10);
  return Number.isFinite(raw) && raw > 1 ? raw : 1;
})();

/** semaphore 状态(仅当 CHANNEL_DOWNLOAD_CONCURRENCY > 1 时实际起作用) */
let activeDownloads = 0;
const downloadWaitQueue: (() => void)[] = [];

function acquireDownloadSlot(): Promise<void> {
  return new Promise((resolve) => {
    if (activeDownloads < CHANNEL_DOWNLOAD_CONCURRENCY) {
      activeDownloads++;
      resolve();
    } else {
      downloadWaitQueue.push(() => {
        activeDownloads++;
        resolve();
      });
    }
  });
}

function releaseDownloadSlot() {
  activeDownloads--;
  const next = downloadWaitQueue.shift();
  if (next) next();
}

const UPLOADS_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(process.cwd(), 'uploads');

if (!fs.existsSync(UPLOADS_ROOT)) {
  fs.mkdirSync(UPLOADS_ROOT, { recursive: true });
}

/** S3 上媒体对象的统一 key 前缀 */
const S3_MEDIA_PREFIX = 'media/';

type MediaGroupBufferEntry = {
  resourceGroupId: number;
  botId: number;
  sourceChatId: bigint;
  caption: string | null;
  // 缓冲期内只存元数据 (file_id + s3Key 等),真正下载 + 上传放到 flush 后的后台任务
  items: { meta: PostMeta; messageId: number }[];
  timer: NodeJS.Timeout;
  lastCtx: Context;  // debounce 触发时用来发反馈消息
};

// 媒体组缓冲:key = `${chatId}:${mediaGroupId}`
const mediaGroupBuffer = new Map<string, MediaGroupBufferEntry>();

// Bot token 缓存(避免每个 media 都查一次 DB)
const botTokenCache = new Map<number, string>();

async function getBotToken(botId: number): Promise<string> {
  const cached = botTokenCache.get(botId);
  if (cached) return cached;
  const bot = await prisma.bot.findUnique({ where: { id: botId } });
  if (!bot) throw new Error(`Bot ${botId} 不存在`);
  botTokenCache.set(botId, bot.token);
  return bot.token;
}

/**
 * 处理 channel_post:激活或资源收集
 */
export async function handleChannelPost(ctx: Context, botId: number) {
  const post = ctx.channelPost;
  if (!post) return;

  const chat = post.chat;
  if (chat.type !== 'channel') return;

  // 1) 激活指令
  const text = (post.text || '').trim();
  if (text === ACTIVATION_COMMAND) {
    await tryActivate(ctx, botId);
    return;
  }

  // 2) 资源收集(仅当频道已激活且 sourceBot 为当前 bot)
  const channelChatId = BigInt(chat.id);
  const group = await prisma.resourceGroup.findUnique({ where: { channelChatId } });
  if (!group) return;
  if (group.sourceBotId !== botId) return;  // 防多 bot 重复入库

  // 2.5) 重设指令:弹分页键盘选某条资源重发 + 可见性键盘
  if (text === RESET_COMMAND) {
    await handleResetCommand(ctx, group.id).catch((err) => {
      console.error('[channel-collector] 重设指令处理失败:', err.message);
    });
    return;
  }

  // 必须有 media 才处理
  const hasMedia = !!(post.photo || post.video || post.document);
  if (!hasMedia) return;

  try {
    if (post.media_group_id) {
      await bufferMediaGroupMessage(ctx, botId, group.id, post);
    } else {
      await persistSingleMedia(ctx, botId, group.id, post);
    }
  } catch (err: any) {
    console.error(`[channel-collector] Bot ${botId} 资源入库失败:`, err.message);
  }
}

/* ============== 激活 ============== */

async function tryActivate(ctx: Context, botId: number) {
  const post = ctx.channelPost!;
  const chat = post.chat;
  const channelChatId = BigInt(chat.id);
  // grammy ChatTypeMap 在 channel 时一定有 title
  const channelTitle = (chat as any).title || `Channel ${chat.id}`;

  // create 优先,P2002 即已被其他 bot 激活过(或本 bot 重复发了 kakaco)
  let created = false;
  let groupName = channelTitle;
  try {
    const group = await prisma.resourceGroup.create({
      data: {
        name: channelTitle,
        channelChatId,
        channelTitle,
        sourceBotId: botId,
      },
    });
    created = true;
    groupName = group.name;
  } catch (err: any) {
    if (err.code !== 'P2002') throw err;
    // 已经激活过,幂等
    return;
  }

  if (created) {
    try {
      await ctx.reply(`✅ 资源频道已激活\n后台分类:${groupName}`);
    } catch (err: any) {
      console.error(`[channel-collector] Bot ${botId} 发送激活反馈失败:`, err.message);
    }
  }
}

/* ============== 元信息提取 (无 IO,纯读 ctx 对象) ============== */

type PostMeta = {
  type: 'photo' | 'video';
  fileId: string;           // Telegram bot-scoped file_id, 入库时直接进 BotFileId 缓存
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  s3Key: string;            // 后台异步上传后会落地到这个 key
};

/**
 * 从 channel_post 同步抽取 file_id + 元数据,不做任何 IO。
 * 用于"立即入库 + 同时把下载/上传 S3 推到后台"的快速反馈流程。
 */
function extractPostMeta(post: any): PostMeta | null {
  let type: 'photo' | 'video';
  let fileId: string;
  let originalFileName: string;
  let mimeType: string;
  let fileSize = 0;

  if (post.photo?.length) {
    type = 'photo';
    const largest = post.photo[post.photo.length - 1];
    fileId = largest.file_id;
    originalFileName = `photo-${post.message_id}.jpg`;
    mimeType = 'image/jpeg';
    fileSize = largest.file_size || 0;
  } else if (post.video) {
    type = 'video';
    fileId = post.video.file_id;
    originalFileName = post.video.file_name || `video-${post.message_id}.mp4`;
    mimeType = post.video.mime_type || 'video/mp4';
    fileSize = post.video.file_size || 0;
  } else if (post.document) {
    const doc = post.document;
    type = doc.mime_type?.startsWith('video') ? 'video' : 'photo';
    fileId = doc.file_id;
    originalFileName = doc.file_name || `file-${post.message_id}`;
    mimeType = doc.mime_type || 'application/octet-stream';
    fileSize = doc.file_size || 0;
  } else {
    return null;
  }

  const ext = path.extname(originalFileName) || (type === 'video' ? '.mp4' : '.jpg');
  const destFileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
  const s3Key = `${S3_MEDIA_PREFIX}${destFileName}`;

  return { type, fileId, originalFileName, mimeType, fileSize, s3Key };
}

/* ============== 后台异步上传 ============== */

/**
 * 后台任务:用 api.getFile(fileId) 拉到本地 tmp → upload S3。
 * 视频额外做 ffmpeg meta + 缩略图。完成后写 DB; 失败时 uploadError 标错让管理员可见。
 * 走 semaphore 限并发避免拖垮 tdlight。
 */
async function uploadMediaToS3InBackground(
  api: Context['api'],
  botId: number,
  mediaFileId: number,
  meta: { type: 'photo' | 'video'; fileId: string; mimeType: string; s3Key: string },
): Promise<void> {
  await acquireDownloadSlot();
  let tmpDir: string | null = null;
  try {
    const fileInfo = await api.getFile(meta.fileId);
    const filePath = fileInfo.file_path;
    if (!filePath) throw new Error('getFile 未返回 file_path');

    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sb-ingest-'));
    const ext = path.extname(meta.s3Key) || (meta.type === 'video' ? '.mp4' : '.jpg');
    const tmpPath = path.join(tmpDir, `media-${mediaFileId}${ext}`);

    if (path.isAbsolute(filePath)) {
      await fs.promises.copyFile(filePath, tmpPath);
    } else {
      const token = await getBotToken(botId);
      const apiRoot = (process.env.TELEGRAM_API_ROOT || 'https://api.telegram.org').replace(/\/$/, '');
      const url = `${apiRoot}/file/bot${token}/${filePath}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`下载文件失败:HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.promises.writeFile(tmpPath, buf);
    }

    await uploadLocalFile(tmpPath, meta.s3Key, meta.mimeType);

    if (meta.type === 'video') {
      try {
        const videoMeta = await getVideoMeta(tmpPath);
        const thumbName = await generateThumbnail(tmpPath, tmpDir);
        const thumbS3Key = `${S3_MEDIA_PREFIX}${thumbName}`;
        await uploadLocalFile(path.join(tmpDir, thumbName), thumbS3Key, 'image/jpeg');
        await prisma.mediaFile.update({
          where: { id: mediaFileId },
          data: {
            duration: videoMeta.duration,
            width: videoMeta.width,
            height: videoMeta.height,
            thumbnailPath: makeS3Path(thumbS3Key),
            uploadError: null,
          },
        });
      } catch (thumbErr: any) {
        // 缩略图失败不算整体失败,主文件已上传成功;只清除 uploadError 表示资源可用
        console.error(`[channel-collector] mediaFile ${mediaFileId} 缩略图处理失败:`, thumbErr?.message || thumbErr);
        await prisma.mediaFile.update({
          where: { id: mediaFileId },
          data: { uploadError: null },
        }).catch(() => {});
      }
    } else {
      await prisma.mediaFile.update({
        where: { id: mediaFileId },
        data: { uploadError: null },
      }).catch(() => {});
    }
  } catch (err: any) {
    const msg = String(err?.message || err).slice(0, 500);
    console.error(`[channel-collector] mediaFile ${mediaFileId} 后台上传失败:`, msg);
    await prisma.mediaFile
      .update({ where: { id: mediaFileId }, data: { uploadError: msg } })
      .catch(() => {});
  } finally {
    releaseDownloadSlot();
    if (tmpDir) {
      fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/** 写 BotFileId 缓存 (channel ingest 时用)。失败仅日志,不影响主流程 */
async function cacheIngestFileId(botId: number, mediaFileId: number, fileId: string) {
  await prisma.botFileId
    .upsert({
      where: { botId_mediaFileId: { botId, mediaFileId } },
      create: { botId, mediaFileId, fileId },
      update: { fileId },
    })
    .catch((err: any) =>
      console.error(`[channel-collector] cacheIngestFileId 失败 botId=${botId} mediaFileId=${mediaFileId}:`, err?.message || err),
    );
}

/* ============== 单条 photo / video / document ============== */

async function persistSingleMedia(ctx: Context, botId: number, groupId: number, post: any) {
  const meta = extractPostMeta(post);
  if (!meta) return;

  const resourceType = meta.type === 'video' ? 'video' : 'photo';
  // DB 占位:filePath 标为 s3:media/xxx (后台异步上传),uploadError 初始 null
  const resource = await prisma.resource.create({
    data: {
      type: resourceType,
      caption: post.caption || null,
      groupId,
      mediaFiles: {
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
      },
    },
    include: { mediaFiles: true },
  });

  const mf = resource.mediaFiles[0];
  // 立刻缓存 file_id, 本 bot 之后发该资源直接走 cachedId, 不依赖 S3 是否上传完成
  await cacheIngestFileId(botId, mf.id, meta.fileId);

  // 立刻反馈, 不等 S3 上传
  await sendAssignmentPrompt(ctx, resource, groupId).catch((err) =>
    console.error('[channel-collector] sendAssignmentPrompt 失败:', err.message)
  );
}

/* ============== 媒体组缓冲 ============== */

async function bufferMediaGroupMessage(ctx: Context, botId: number, groupId: number, post: any) {
  const meta = extractPostMeta(post);
  if (!meta) return;

  const key = `${post.chat.id}:${post.media_group_id}`;
  let entry = mediaGroupBuffer.get(key);
  if (!entry) {
    entry = {
      resourceGroupId: groupId,
      botId,
      sourceChatId: BigInt(post.chat.id),
      caption: null,
      items: [],
      timer: null as unknown as NodeJS.Timeout,
      lastCtx: ctx,
    };
    mediaGroupBuffer.set(key, entry);
  }

  entry.items.push({ meta, messageId: post.message_id });
  if (!entry.caption && post.caption) entry.caption = post.caption;
  entry.lastCtx = ctx;

  if (entry.timer) clearTimeout(entry.timer);
  const bufferEntry = entry;
  entry.timer = setTimeout(() => {
    mediaGroupBuffer.delete(key);
    flushMediaGroup(bufferEntry).catch((err) => {
      console.error('[channel-collector] 媒体组入库失败:', err.message);
    });
  }, MEDIA_GROUP_DEBOUNCE_MS);
}

async function flushMediaGroup(entry: MediaGroupBufferEntry) {
  // 按 messageId 排序,保证用户看到的顺序
  entry.items.sort((a, b) => a.messageId - b.messageId);

  const resource = await prisma.resource.create({
    data: {
      type: 'media_group',
      caption: entry.caption,
      groupId: entry.resourceGroupId,
      mediaFiles: {
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
      },
    },
    include: { mediaFiles: { orderBy: { sortOrder: 'asc' } } },
  });

  // 立刻给每张照片/视频写 file_id 缓存, 本 bot 之后发该资源直接走 cachedId
  for (let i = 0; i < resource.mediaFiles.length; i++) {
    await cacheIngestFileId(entry.botId, resource.mediaFiles[i].id, entry.items[i].meta.fileId);
  }

  // 立刻反馈
  await sendAssignmentPrompt(entry.lastCtx, resource, entry.resourceGroupId).catch((err) =>
    console.error('[channel-collector] sendAssignmentPrompt 失败:', err.message)
  );
}

/* ============== 反馈消息 + 归属选择键盘 ============== */

/**
 * 在频道里发反馈消息:
 *   "✅ 已收录 · N 图 · M 视频 · 有/无描述"
 * 附带 N+1 个序号按钮:
 *   1..N 合并到该 group 中已有的第 i 个 Resource
 *   ✨ 作为新条目(no-op,默认不点也是新条目)
 */
async function sendAssignmentPrompt(
  ctx: Context,
  newResource: { id: number; caption: string | null; mediaFiles: { type: string }[] },
  groupId: number,
) {
  let photoCount = 0, videoCount = 0;
  for (const mf of newResource.mediaFiles) {
    if (mf.type === 'video') videoCount++;
    else photoCount++;
  }
  const hasCaption = !!newResource.caption;

  // group 中已有 Resource(排除自己,按 createdAt 升序对应"第 1, 第 2, ...")
  const others = await prisma.resource.findMany({
    where: { groupId, id: { not: newResource.id } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  const parts: string[] = ['✅ 已收录'];
  if (photoCount > 0) parts.push(`${photoCount} 图`);
  if (videoCount > 0) parts.push(`${videoCount} 视频`);
  parts.push(hasCaption ? '有描述' : '无描述');
  const text = `${parts.join(' · ')}\n\n请选择归属(默认作为新条目):`;

  const kb = new InlineKeyboard();
  for (let i = 0; i < others.length; i++) {
    kb.text(`${i + 1}`, `resassign:${newResource.id}:${others[i].id}`);
    if ((i + 1) % 5 === 0) kb.row();
  }
  if (others.length % 5 !== 0) kb.row();
  kb.text(`✨ 新条目 (${others.length + 1})`, `resassign:${newResource.id}:new`);

  await ctx.reply(text, { reply_markup: kb });
}

/* ============== 处理归属选择 callback ============== */

/**
 * 处理 resassign:{newId}:{target} callback。
 * target = 'new':仅清空键盘,标记"作为新条目"
 * target = 数字 id:把 newResource 的 mediaFiles 转移到目标 Resource,删除空壳
 */
export async function handleResourceAssignment(
  ctx: Context,
  botId: number,
  newResourceId: number,
  target: string,
) {
  const newRes = await prisma.resource.findUnique({
    where: { id: newResourceId },
    include: { mediaFiles: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!newRes) {
    await ctx.answerCallbackQuery({ text: '资源已不存在', show_alert: true }).catch(() => {});
    return;
  }

  // 决定最终生效的 Resource id
  let finalResourceId: number;

  if (target === 'new') {
    finalResourceId = newRes.id;
    await ctx.answerCallbackQuery({ text: '✓ 已确认为新条目' }).catch(() => {});
    await ctx.editMessageReplyMarkup({ reply_markup: undefined as any }).catch(() => {});
  } else {
    const targetId = parseInt(target, 10);
    if (!Number.isFinite(targetId) || targetId === newRes.id) {
      await ctx.answerCallbackQuery({ text: '无效的归属', show_alert: true }).catch(() => {});
      return;
    }

    const targetRes = await prisma.resource.findUnique({
      where: { id: targetId },
      include: { mediaFiles: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!targetRes) {
      await ctx.answerCallbackQuery({ text: '目标资源已不存在', show_alert: true }).catch(() => {});
      return;
    }
    if (targetRes.groupId !== newRes.groupId) {
      await ctx.answerCallbackQuery({ text: '不能跨分类合并', show_alert: true }).catch(() => {});
      return;
    }

    const targetMaxSort = targetRes.mediaFiles.reduce(
      (m, mf) => (mf.sortOrder > m ? mf.sortOrder : m),
      -1,
    );
    const newCount = newRes.mediaFiles.length;
    const mergedTotal = targetRes.mediaFiles.length + newCount;
    const mergedType = mergedTotal > 1 ? 'media_group' : targetRes.type;
    const mergedCaption = targetRes.caption ?? newRes.caption;

    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < newRes.mediaFiles.length; i++) {
        await tx.mediaFile.update({
          where: { id: newRes.mediaFiles[i].id },
          data: {
            resourceId: targetRes.id,
            sortOrder: targetMaxSort + 1 + i,
          },
        });
      }
      await tx.resource.update({
        where: { id: targetRes.id },
        data: { type: mergedType, caption: mergedCaption },
      });
      await tx.resource.delete({ where: { id: newRes.id } });
    });

    finalResourceId = targetRes.id;

    const all = await prisma.resource.findMany({
      where: { groupId: targetRes.groupId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const ordinal = all.findIndex((r) => r.id === targetRes.id) + 1;

    await ctx.answerCallbackQuery({ text: `✓ 已合并到第 ${ordinal} 条` }).catch(() => {});
    await ctx.editMessageReplyMarkup({ reply_markup: undefined as any }).catch(() => {});
  }

  // 选完后:把最终 Resource 的全部 mediaFiles 发到频道供员工预览,然后发可见性键盘
  try {
    const finalRes = await prisma.resource.findUnique({
      where: { id: finalResourceId },
      include: { mediaFiles: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!finalRes) return;
    // sender.sendResource 处理单文件/媒体组(>10 自动分批)
    await sendResource(ctx, botId, {
      type: finalRes.type,
      caption: finalRes.caption,
      mediaFiles: finalRes.mediaFiles,
    });
    await sendVisibilityKeyboard(ctx, finalRes);
  } catch (err: any) {
    console.error('[channel-collector] 预览+可见性键盘失败:', err.message);
  }
}

/* ============== 可见性键盘 ============== */

function buildVisibilityKeyboard(resource: { id: number; mediaFiles: { id: number; sortOrder: number; isHidden: boolean }[] }) {
  const kb = new InlineKeyboard();
  // 按 sortOrder 排序后展示序号 1..N
  const sorted = [...resource.mediaFiles].sort((a, b) => a.sortOrder - b.sortOrder);
  for (let i = 0; i < sorted.length; i++) {
    const mf = sorted[i];
    const label = `${i + 1}:${mf.isHidden ? '隐藏' : '公开'}`;
    kb.text(label, `medvis:${resource.id}:${mf.id}`);
    if ((i + 1) % 4 === 0) kb.row();
  }
  if (sorted.length % 4 !== 0) kb.row();
  kb.text('💾 保存', `medsave:${resource.id}`);
  return kb;
}

async function sendVisibilityKeyboard(ctx: Context, resource: { id: number; mediaFiles: { id: number; sortOrder: number; isHidden: boolean }[] }) {
  if (resource.mediaFiles.length === 0) return;
  const kb = buildVisibilityKeyboard(resource);
  await ctx.reply('请选择各项的可见性(默认公开),完成后点保存:', { reply_markup: kb });
}

/* ============== 处理 visibility callback ============== */

/** 切换某个 MediaFile 的 isHidden,并刷新键盘文字 */
export async function handleMediaVisibilityToggle(
  ctx: Context,
  resourceId: number,
  mediaFileId: number,
) {
  const mf = await prisma.mediaFile.findUnique({ where: { id: mediaFileId } });
  if (!mf || mf.resourceId !== resourceId) {
    await ctx.answerCallbackQuery({ text: '项不存在', show_alert: true }).catch(() => {});
    return;
  }
  const nextHidden = !mf.isHidden;
  await prisma.mediaFile.update({
    where: { id: mediaFileId },
    data: { isHidden: nextHidden },
  });

  const resource = await prisma.resource.findUnique({
    where: { id: resourceId },
    include: { mediaFiles: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!resource) {
    await ctx.answerCallbackQuery({ text: '资源已不存在', show_alert: true }).catch(() => {});
    return;
  }
  const kb = buildVisibilityKeyboard(resource);

  await ctx.answerCallbackQuery({ text: nextHidden ? '已设隐藏' : '已设公开' }).catch(() => {});
  await ctx.editMessageReplyMarkup({ reply_markup: kb }).catch(() => {});
}

/** 保存:仅清空键盘 */
export async function handleMediaVisibilitySave(ctx: Context, _resourceId: number) {
  await ctx.answerCallbackQuery({ text: '✓ 已保存' }).catch(() => {});
  await ctx.editMessageReplyMarkup({ reply_markup: undefined as any }).catch(() => {});
}

/* ============== 重设指令:分页键盘 ============== */

/**
 * 频道内发送「重设」后:列出本分类所有资源,弹分页键盘。
 * 序号按 createdAt asc(和频道里发的顺序一致,最早的是 1)。
 */
async function handleResetCommand(ctx: Context, groupId: number) {
  const total = await prisma.resource.count({ where: { groupId } });
  if (total === 0) {
    await ctx.reply('当前分类还没有资源').catch(() => {});
    return;
  }
  const kb = await buildResetPickerKeyboard(groupId, 0, total);
  const totalPages = Math.ceil(total / RESET_PAGE_SIZE);
  await ctx.reply(`选择要重设的资源(共 ${total} 条,第 1/${totalPages} 页):`, { reply_markup: kb }).catch(() => {});
}

/**
 * 构造第 page 页(0-based)的键盘。
 * 每页 RESET_PAGE_SIZE 条 = 5 行 × 4 列;底部一行翻页(上/页码/下)。
 */
async function buildResetPickerKeyboard(groupId: number, page: number, totalKnown?: number) {
  const total = totalKnown ?? await prisma.resource.count({ where: { groupId } });
  const totalPages = Math.max(1, Math.ceil(total / RESET_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));

  const pageItems = await prisma.resource.findMany({
    where: { groupId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
    skip: safePage * RESET_PAGE_SIZE,
    take: RESET_PAGE_SIZE,
  });

  const kb = new InlineKeyboard();
  for (let i = 0; i < pageItems.length; i++) {
    const ordinal = safePage * RESET_PAGE_SIZE + i + 1;
    kb.text(String(ordinal), `reset_pick:${pageItems[i].id}`);
    if ((i + 1) % 4 === 0) kb.row();
  }
  if (pageItems.length % 4 !== 0) kb.row();

  if (totalPages > 1) {
    kb.text(safePage > 0 ? '⬅️ 上一页' : '·', safePage > 0 ? `reset_page:${groupId}:${safePage - 1}` : 'reset_noop');
    kb.text(`${safePage + 1}/${totalPages}`, 'reset_noop');
    kb.text(safePage + 1 < totalPages ? '下一页 ➡️' : '·', safePage + 1 < totalPages ? `reset_page:${groupId}:${safePage + 1}` : 'reset_noop');
  }
  return kb;
}

/** 翻页:编辑当前消息的 reply_markup + 文本 */
export async function handleResetPage(ctx: Context, groupId: number, page: number) {
  const total = await prisma.resource.count({ where: { groupId } });
  if (total === 0) {
    await ctx.answerCallbackQuery({ text: '该分类已无资源', show_alert: true }).catch(() => {});
    await ctx.editMessageReplyMarkup({ reply_markup: undefined as any }).catch(() => {});
    return;
  }
  const totalPages = Math.max(1, Math.ceil(total / RESET_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const kb = await buildResetPickerKeyboard(groupId, safePage, total);
  await ctx.answerCallbackQuery().catch(() => {});
  await ctx.editMessageText(`选择要重设的资源(共 ${total} 条,第 ${safePage + 1}/${totalPages} 页):`, { reply_markup: kb }).catch(() => {});
}

/** 选中某条:删除选择消息 → 重发完整资源(含已隐藏项)→ 发可见性键盘 */
export async function handleResetPick(ctx: Context, botId: number, resourceId: number) {
  const resource = await prisma.resource.findUnique({
    where: { id: resourceId },
    include: { mediaFiles: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!resource) {
    await ctx.answerCallbackQuery({ text: '资源已不存在', show_alert: true }).catch(() => {});
    await ctx.editMessageReplyMarkup({ reply_markup: undefined as any }).catch(() => {});
    return;
  }
  await ctx.answerCallbackQuery().catch(() => {});
  await ctx.deleteMessage().catch(() => {});

  await sendResource(ctx, botId, {
    type: resource.type,
    caption: resource.caption,
    mediaFiles: resource.mediaFiles,
  });
  await sendVisibilityKeyboard(ctx, resource);
}
