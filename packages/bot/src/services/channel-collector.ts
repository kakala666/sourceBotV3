import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import fs from 'fs';
import path from 'path';
import prisma from '../prisma';

/** 激活指令(精确匹配,trim 后) */
export const ACTIVATION_COMMAND = 'kakaco';

/** 媒体组消息聚合 debounce */
const MEDIA_GROUP_DEBOUNCE_MS = 2000;

const UPLOADS_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(process.cwd(), 'uploads');

if (!fs.existsSync(UPLOADS_ROOT)) {
  fs.mkdirSync(UPLOADS_ROOT, { recursive: true });
}

type DownloadedFile = {
  type: 'photo' | 'video';
  fileName: string;          // 落到 uploads 后的文件名
  originalFileName: string;  // 原始名(展示用)
  mimeType: string;
  fileSize: number;
};

type MediaGroupBufferEntry = {
  resourceGroupId: number;
  caption: string | null;
  items: { file: DownloadedFile; messageId: number }[];
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

/* ============== 媒体下载 ============== */

/**
 * 从当前 channel_post 提取媒体信息并下载到 uploads。
 * 兼容 local-mode telegram-bot-api(file_path 是本地绝对路径,直接 copy)
 * 和 standard 模式(file_path 是相对路径,走 HTTP 下载)。
 */
async function downloadCurrentMedia(ctx: Context, botId: number): Promise<DownloadedFile | null> {
  const post = ctx.channelPost!;

  let type: 'photo' | 'video';
  let originalFileName: string;
  let mimeType: string;
  let fileSize = 0;

  if (post.photo?.length) {
    type = 'photo';
    originalFileName = `photo-${post.message_id}.jpg`;
    mimeType = 'image/jpeg';
    fileSize = post.photo[post.photo.length - 1].file_size || 0;
  } else if (post.video) {
    type = 'video';
    originalFileName = (post.video as any).file_name || `video-${post.message_id}.mp4`;
    mimeType = post.video.mime_type || 'video/mp4';
    fileSize = post.video.file_size || 0;
  } else if (post.document) {
    const doc = post.document;
    type = doc.mime_type?.startsWith('video') ? 'video' : 'photo';
    originalFileName = doc.file_name || `file-${post.message_id}`;
    mimeType = doc.mime_type || 'application/octet-stream';
    fileSize = doc.file_size || 0;
  } else {
    return null;
  }

  const ext = path.extname(originalFileName) || (type === 'video' ? '.mp4' : '.jpg');
  const destFileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
  const destPath = path.join(UPLOADS_ROOT, destFileName);

  const fileInfo = await ctx.getFile();
  const filePath = fileInfo.file_path;
  if (!filePath) {
    throw new Error('getFile 未返回 file_path');
  }

  if (path.isAbsolute(filePath)) {
    // local-mode telegram-bot-api:file_path 是本地绝对路径,直接复制
    await fs.promises.copyFile(filePath, destPath);
  } else {
    // standard 模式或 local API 但非 local-mode:走 HTTP 下载
    const token = await getBotToken(botId);
    const apiRoot = (process.env.TELEGRAM_API_ROOT || 'https://api.telegram.org').replace(/\/$/, '');
    const url = `${apiRoot}/file/bot${token}/${filePath}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`下载文件失败:HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.promises.writeFile(destPath, buf);
  }

  if (!fileSize) {
    try { fileSize = fs.statSync(destPath).size; } catch { /* ignore */ }
  }

  return { type, fileName: destFileName, originalFileName, mimeType, fileSize };
}

/* ============== 单条 photo / video / document ============== */

async function persistSingleMedia(ctx: Context, botId: number, groupId: number, post: any) {
  const file = await downloadCurrentMedia(ctx, botId);
  if (!file) return;

  const resourceType = file.type === 'video' ? 'video' : 'photo';
  const resource = await prisma.resource.create({
    data: {
      type: resourceType,
      caption: post.caption || null,
      groupId,
      mediaFiles: {
        create: [{
          type: file.type,
          filePath: file.fileName,
          fileName: file.originalFileName,
          mimeType: file.mimeType,
          fileSize: file.fileSize,
          sortOrder: 0,
        }],
      },
    },
    include: { mediaFiles: true },
  });

  await sendAssignmentPrompt(ctx, resource, groupId).catch((err) =>
    console.error('[channel-collector] sendAssignmentPrompt 失败:', err.message)
  );
}

/* ============== 媒体组缓冲 ============== */

async function bufferMediaGroupMessage(ctx: Context, botId: number, groupId: number, post: any) {
  // 先下载,避免在 debounce 触发时丢失 ctx
  const file = await downloadCurrentMedia(ctx, botId);
  if (!file) return;

  const key = `${post.chat.id}:${post.media_group_id}`;
  let entry = mediaGroupBuffer.get(key);
  if (!entry) {
    entry = {
      resourceGroupId: groupId,
      caption: null,
      items: [],
      timer: null as unknown as NodeJS.Timeout,
      lastCtx: ctx,
    };
    mediaGroupBuffer.set(key, entry);
  }

  entry.items.push({ file, messageId: post.message_id });
  if (!entry.caption && post.caption) entry.caption = post.caption;
  entry.lastCtx = ctx;

  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    mediaGroupBuffer.delete(key);
    flushMediaGroup(entry!).catch((err) => {
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
          type: it.file.type,
          filePath: it.file.fileName,
          fileName: it.file.originalFileName,
          mimeType: it.file.mimeType,
          fileSize: it.file.fileSize,
          sortOrder: i,
        })),
      },
    },
    include: { mediaFiles: true },
  });

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

  if (target === 'new') {
    await ctx.answerCallbackQuery({ text: '✓ 已确认为新条目' }).catch(() => {});
    await ctx.editMessageReplyMarkup({ reply_markup: undefined as any }).catch(() => {});
    return;
  }

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

  // 算目标在 group 中是第几条(按 createdAt 升序),反馈给用户
  const all = await prisma.resource.findMany({
    where: { groupId: targetRes.groupId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  const ordinal = all.findIndex((r) => r.id === targetRes.id) + 1;

  await ctx.answerCallbackQuery({
    text: `✓ 已合并到第 ${ordinal} 条`,
  }).catch(() => {});
  await ctx.editMessageReplyMarkup({ reply_markup: undefined as any }).catch(() => {});
}
