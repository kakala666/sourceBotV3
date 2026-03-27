import { InputFile, InputMediaBuilder, InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import prisma from '../prisma';
import path from 'path';

/** 上传文件的根目录，优先使用环境变量，否则从 cwd 推断 */
const UPLOADS_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(process.cwd(), 'uploads');

/**
 * 判断是否为 file_id 失效错误（而非 URL/键盘等其他错误）
 */
function isFileIdError(err: any): boolean {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('wrong file identifier') || msg.includes('file_id') || msg.includes('invalid file');
}

/**
 * 获取文件的绝对路径
 */
function getAbsoluteFilePath(filePath: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(UPLOADS_ROOT, filePath);
}

/**
 * 查询缓存的 file_id
 */
async function getCachedFileId(botId: number, mediaFileId: number): Promise<string | null> {
  const record = await prisma.botFileId.findUnique({
    where: { botId_mediaFileId: { botId, mediaFileId } },
  });
  return record?.fileId ?? null;
}

/**
 * 保存 file_id 到缓存
 */
async function saveCachedFileId(botId: number, mediaFileId: number, fileId: string) {
  await prisma.botFileId.upsert({
    where: { botId_mediaFileId: { botId, mediaFileId } },
    create: { botId, mediaFileId, fileId },
    update: { fileId },
  });
}

/**
 * 删除失效的 file_id 缓存
 */
async function deleteCachedFileId(botId: number, mediaFileId: number) {
  await prisma.botFileId.deleteMany({
    where: { botId, mediaFileId },
  });
}

/**
 * 从 Telegram 返回的消息中提取 file_id
 */
function extractFileId(message: any, mediaType: string): string | null {
  if (mediaType === 'photo' && message.photo?.length) {
    // photo 是数组，取最大尺寸的（最后一个）
    return message.photo[message.photo.length - 1].file_id;
  }
  if (mediaType === 'video' && message.video) {
    return message.video.file_id;
  }
  if (message.document) {
    return message.document.file_id;
  }
  return null;
}

/**
 * 发送单张图片（带 file_id 缓存）
 */
async function sendPhoto(
  ctx: Context,
  botId: number,
  mediaFile: { id: number; filePath: string; type: string },
  caption?: string | null,
  keyboard?: InlineKeyboard,
) {
  const cachedId = await getCachedFileId(botId, mediaFile.id);
  const opts: any = {};
  if (caption) opts.caption = caption;
  if (keyboard) opts.reply_markup = keyboard;

  if (cachedId) {
    try {
      return await ctx.replyWithPhoto(cachedId, opts);
    } catch (err: any) {
      if (!isFileIdError(err)) throw err;
      console.error(`[sender] file_id 失效，重新上传: mediaFile=${mediaFile.id}`, err.message);
      await deleteCachedFileId(botId, mediaFile.id);
    }
  }

  // 从本地文件上传
  const absPath = getAbsoluteFilePath(mediaFile.filePath);
  const msg = await ctx.replyWithPhoto(new InputFile(absPath), opts);
  const fileId = extractFileId(msg, 'photo');
  if (fileId) await saveCachedFileId(botId, mediaFile.id, fileId);
  return msg;
}

/**
 * 发送视频（带 file_id 缓存 + 流媒体优化）
 */
async function sendVideo(
  ctx: Context,
  botId: number,
  mediaFile: { id: number; filePath: string; type: string; duration?: number | null; width?: number | null; height?: number | null; thumbnailPath?: string | null },
  caption?: string | null,
  keyboard?: InlineKeyboard,
) {
  const cachedId = await getCachedFileId(botId, mediaFile.id);
  const opts: any = { supports_streaming: true };
  if (caption) opts.caption = caption;
  if (keyboard) opts.reply_markup = keyboard;
  if (mediaFile.duration) opts.duration = mediaFile.duration;
  if (mediaFile.width) opts.width = mediaFile.width;
  if (mediaFile.height) opts.height = mediaFile.height;
  if (mediaFile.thumbnailPath) {
    opts.thumbnail = new InputFile(getAbsoluteFilePath(mediaFile.thumbnailPath));
  }

  if (cachedId) {
    try {
      return await ctx.replyWithVideo(cachedId, opts);
    } catch (err: any) {
      if (!isFileIdError(err)) throw err;
      console.error(`[sender] file_id 失效，重新上传: mediaFile=${mediaFile.id}`, err.message);
      await deleteCachedFileId(botId, mediaFile.id);
    }
  }

  const absPath = getAbsoluteFilePath(mediaFile.filePath);
  const msg = await ctx.replyWithVideo(new InputFile(absPath), opts);
  const fileId = extractFileId(msg, 'video');
  if (fileId) await saveCachedFileId(botId, mediaFile.id, fileId);
  return msg;
}

/**
 * 发送媒体组（每个文件独立缓存 file_id）
 */
async function sendMediaGroup(
  ctx: Context,
  botId: number,
  mediaFiles: { id: number; filePath: string; type: string; duration?: number | null; width?: number | null; height?: number | null; thumbnailPath?: string | null }[],
  caption?: string | null,
) {
  const mediaItems: any[] = [];
  const uploadedFromLocal = new Set<number>();

  for (let i = 0; i < mediaFiles.length; i++) {
    const mf = mediaFiles[i];
    const cachedId = await getCachedFileId(botId, mf.id);
    const itemCaption = i === 0 ? (caption ?? undefined) : undefined;

    let source: string | InputFile;
    if (cachedId) {
      source = cachedId;
    } else {
      source = new InputFile(getAbsoluteFilePath(mf.filePath));
      uploadedFromLocal.add(i);
    }

    if (mf.type === 'video') {
      mediaItems.push(InputMediaBuilder.video(source, { caption: itemCaption }));
    } else {
      mediaItems.push(InputMediaBuilder.photo(source, { caption: itemCaption }));
    }
  }

  try {
    const messages = await ctx.replyWithMediaGroup(mediaItems);
    // 仅对本地上传的文件缓存 file_id
    for (const i of uploadedFromLocal) {
      const mf = mediaFiles[i];
      if (!mf) continue;
      const fid = extractFileId(messages[i], mf.type);
      if (fid) await saveCachedFileId(botId, mf.id, fid);
    }
    return messages;
  } catch (err: any) {
    // 非 file_id 错误直接抛出
    if (!isFileIdError(err)) throw err;

    console.error('[sender] 媒体组 file_id 失效，清除缓存重试', err.message);
    for (const mf of mediaFiles) {
      await deleteCachedFileId(botId, mf.id);
    }
    // 重建全部使用本地文件
    const retryItems = mediaFiles.map((mf, i) => {
      const src = new InputFile(getAbsoluteFilePath(mf.filePath));
      const cap = i === 0 ? (caption ?? undefined) : undefined;
      return mf.type === 'video'
        ? InputMediaBuilder.video(src, { caption: cap })
        : InputMediaBuilder.photo(src, { caption: cap });
    });
    const messages = await ctx.replyWithMediaGroup(retryItems);
    for (let i = 0; i < messages.length; i++) {
      const mf = mediaFiles[i];
      if (!mf) continue;
      const fid = extractFileId(messages[i], mf.type);
      if (fid) await saveCachedFileId(botId, mf.id, fid);
    }
    return messages;
  }
}

/**
 * 构建翻页键盘
 */
function buildPageKeyboard(sessionId: number, nextIndex: number): InlineKeyboard {
  return new InlineKeyboard().text('下一页 ▶', `next:${sessionId}:${nextIndex}`);
}

/**
 * 构建内容键盘（内容按钮 + 可选翻页按钮）
 */
function buildContentKeyboard(
  contentButtons?: { text: string; url: string }[] | null,
  sessionId?: number,
  nextIndex?: number,
): InlineKeyboard | undefined {
  const hasContentBtns = contentButtons && contentButtons.length > 0;
  const hasPageBtn = sessionId !== undefined && nextIndex !== undefined;

  if (!hasContentBtns && !hasPageBtn) return undefined;

  const keyboard = new InlineKeyboard();

  // 内容按钮在上方
  if (hasContentBtns) {
    for (const btn of contentButtons) {
      keyboard.url(btn.text, btn.url).row();
    }
  }

  // 翻页按钮在下方
  if (hasPageBtn) {
    keyboard.text('下一页 ▶', `next:${sessionId}:${nextIndex}`);
  }

  return keyboard;
}

/**
 * 发送资源（根据类型自动选择发送方式）
 */
export async function sendResource(
  ctx: Context,
  botId: number,
  resource: {
    type: string;
    caption: string | null;
    mediaFiles: { id: number; filePath: string; type: string; duration?: number | null; width?: number | null; height?: number | null; thumbnailPath?: string | null }[];
  },
  keyboard?: InlineKeyboard,
) {
  const { type, caption, mediaFiles } = resource;

  if (!mediaFiles.length) {
    // 无媒体文件，仅发送文字
    if (caption) await ctx.reply(caption, keyboard ? { reply_markup: keyboard } : undefined);
    return;
  }

  if (type === 'media_group') {
    await sendMediaGroup(ctx, botId, mediaFiles, caption);
    // media_group 不支持 inline keyboard，单独发送键盘
    if (keyboard) {
      await ctx.reply('👆 以上是当前资源', { reply_markup: keyboard });
    }
    return;
  }

  // 单文件
  const mf = mediaFiles[0];
  if (type === 'video' || mf.type === 'video') {
    await sendVideo(ctx, botId, mf, caption, keyboard);
  } else {
    await sendPhoto(ctx, botId, mf, caption, keyboard);
  }
}

/**
 * 发送广告资源（带内联按钮）
 */
export async function sendAd(
  ctx: Context,
  botId: number,
  adBinding: {
    id: number;
    buttons: any;
    resource: {
      type: string;
      caption: string | null;
      mediaFiles: { id: number; filePath: string; type: string; duration?: number | null; width?: number | null; height?: number | null; thumbnailPath?: string | null }[];
    };
  },
  adDisplaySeconds: number,
) {
  // 构建广告内联按钮
  let adKeyboard: InlineKeyboard | undefined;
  const buttons = adBinding.buttons as { text: string; url: string }[] | null;
  if (buttons?.length) {
    adKeyboard = new InlineKeyboard();
    for (const btn of buttons) {
      adKeyboard.url(btn.text, btn.url).row();
    }
  }

  // 发送广告资源
  await sendResource(ctx, botId, adBinding.resource, adKeyboard);

  // 发送倒计时提示
  await ctx.reply(`⏳ 广告展示中，${adDisplaySeconds}秒后继续...`);
}

/**
 * 发送预览结束内容
 */
export async function sendEndContent(
  ctx: Context,
  endContent: { text: string; buttons?: { text: string; url: string }[] },
) {
  let keyboard: InlineKeyboard | undefined;
  if (endContent.buttons?.length) {
    keyboard = new InlineKeyboard();
    for (const btn of endContent.buttons) {
      keyboard.url(btn.text, btn.url).row();
    }
  }
  await ctx.reply(endContent.text, keyboard ? { reply_markup: keyboard } : undefined);
}

export { buildPageKeyboard, buildContentKeyboard };
