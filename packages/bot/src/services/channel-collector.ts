import type { Context } from 'grammy';
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
  await prisma.resource.create({
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
  });
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
    };
    mediaGroupBuffer.set(key, entry);
  }

  entry.items.push({ file, messageId: post.message_id });
  if (!entry.caption && post.caption) entry.caption = post.caption;

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

  await prisma.resource.create({
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
  });
}
