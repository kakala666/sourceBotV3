import { InputFile, InputMediaBuilder, InlineKeyboard, Keyboard } from 'grammy';
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

/** Telegram sendMediaGroup 单批上限,超过自动分批发送 */
const MEDIA_GROUP_CHUNK_SIZE = 10;

type MediaFileLike = {
  id: number; filePath: string; type: string;
  duration?: number | null; width?: number | null; height?: number | null; thumbnailPath?: string | null;
};

/**
 * 发送媒体组(超过 10 个自动分批;单文件批次降级为 sendPhoto/sendVideo)
 * caption 仅放在第一个批次的第一个文件上。
 */
async function sendMediaGroup(
  ctx: Context,
  botId: number,
  mediaFiles: MediaFileLike[],
  caption?: string | null,
) {
  for (let i = 0; i < mediaFiles.length; i += MEDIA_GROUP_CHUNK_SIZE) {
    const chunk = mediaFiles.slice(i, i + MEDIA_GROUP_CHUNK_SIZE);
    const batchCaption = i === 0 ? caption : null;

    if (chunk.length === 1) {
      // 单文件无法用 media group,降级单发(没有 keyboard,因为媒体组本身就不带)
      const mf = chunk[0];
      if (mf.type === 'video') {
        await sendVideo(ctx, botId, mf, batchCaption);
      } else {
        await sendPhoto(ctx, botId, mf, batchCaption);
      }
    } else {
      await sendMediaGroupBatch(ctx, botId, chunk, batchCaption);
    }
  }
}

/** 构建单条 video 的 InputMediaVideo 选项,带流媒体优化与缩略图 */
function buildVideoOpts(
  mf: MediaFileLike,
  itemCaption: string | undefined,
): any {
  const opts: any = { supports_streaming: true };
  if (itemCaption !== undefined) opts.caption = itemCaption;
  if (mf.duration) opts.duration = mf.duration;
  if (mf.width) opts.width = mf.width;
  if (mf.height) opts.height = mf.height;
  if (mf.thumbnailPath) {
    opts.thumbnail = new InputFile(getAbsoluteFilePath(mf.thumbnailPath));
  }
  return opts;
}

/** 发送单个媒体组批次(2-10 个文件) */
async function sendMediaGroupBatch(
  ctx: Context,
  botId: number,
  mediaFiles: MediaFileLike[],
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
      mediaItems.push(InputMediaBuilder.video(source, buildVideoOpts(mf, itemCaption)));
    } else {
      mediaItems.push(InputMediaBuilder.photo(source, { caption: itemCaption }));
    }
  }

  try {
    const messages = await ctx.replyWithMediaGroup(mediaItems);
    for (const i of uploadedFromLocal) {
      const mf = mediaFiles[i];
      if (!mf) continue;
      const fid = extractFileId(messages[i], mf.type);
      if (fid) await saveCachedFileId(botId, mf.id, fid);
    }
    return messages;
  } catch (err: any) {
    if (!isFileIdError(err)) throw err;

    console.error('[sender] 媒体组 file_id 失效，清除缓存重试', err.message);
    for (const mf of mediaFiles) {
      await deleteCachedFileId(botId, mf.id);
    }
    const retryItems = mediaFiles.map((mf, i) => {
      const src = new InputFile(getAbsoluteFilePath(mf.filePath));
      const cap = i === 0 ? (caption ?? undefined) : undefined;
      return mf.type === 'video'
        ? InputMediaBuilder.video(src, buildVideoOpts(mf, cap))
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
 * 当提供 searchMoreUrl 时,在「下一页」按钮上方插入一行「🔍 搜索更多资源」URL 按钮。
 */
function buildPageKeyboard(sessionId: number, nextIndex: number, searchMoreUrl?: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (searchMoreUrl) kb.url('🔍 搜索更多资源', searchMoreUrl).row();
  kb.text('下一页 ▶', `next:${sessionId}:${nextIndex}`);
  return kb;
}

/**
 * 构建内容键盘（内容按钮 + 可选「展开更多」 + 可选翻页按钮 + 可选「搜索更多」）
 * revealInfo:若该资源有隐藏的 mediaFile,传入 { sessionId, currentIndex } 即可在
 *           翻页按钮上方多加一个「🔽 展开更多」按钮。
 * searchMoreUrl:仅当存在翻页按钮时生效,在翻页按钮(以及可选的「展开更多」)上方插入跳转按钮。
 */
function buildContentKeyboard(
  contentButtons?: { text: string; url: string }[] | null,
  sessionId?: number,
  nextIndex?: number,
  revealInfo?: { sessionId: number; currentIndex: number } | null,
  searchMoreUrl?: string,
  favoriteInfo?: { sessionId: number; resourceId: number } | null,
): InlineKeyboard | undefined {
  // 过滤掉无效按钮:text 或 url 为空都会让 Telegram 把按钮解析成 KeyboardButton 报错
  const validContentButtons = (contentButtons ?? []).filter(
    (b) => b && typeof b.text === 'string' && b.text.trim() && typeof b.url === 'string' && b.url.trim(),
  );
  const hasContentBtns = validContentButtons.length > 0;
  const hasPageBtn = sessionId !== undefined && nextIndex !== undefined;
  const hasReveal = !!revealInfo;
  const hasFav = !!favoriteInfo;

  if (!hasContentBtns && !hasPageBtn && !hasReveal && !hasFav) return undefined;

  const keyboard = new InlineKeyboard();

  // 内容按钮在上方
  if (hasContentBtns) {
    for (const btn of validContentButtons) {
      keyboard.url(btn.text.trim(), btn.url.trim()).row();
    }
  }

  // 「展开更多」靠上(与当前页媒体相关的副动作)
  if (hasReveal) {
    keyboard.text('🔽 展开更多', `reveal:${revealInfo!.sessionId}:${revealInfo!.currentIndex}`).row();
  }

  // 「⭐ 收藏」在 展开 下方、搜索更多上方
  if (hasFav) {
    keyboard.text('⭐ 收藏', `fav:${favoriteInfo!.sessionId}:${favoriteInfo!.resourceId}`).row();
  }

  // 「搜索更多资源」紧贴翻页按钮上方(仅当有翻页按钮时显示)
  if (hasPageBtn && searchMoreUrl) {
    keyboard.url('🔍 搜索更多资源', searchMoreUrl).row();
  }

  // 翻页按钮
  if (hasPageBtn) {
    keyboard.text('下一页 ▶', `next:${sessionId}:${nextIndex}`);
  }

  return keyboard;
}

/**
 * 发送资源（根据类型自动选择发送方式）
 * 传入 resourceId 时,在 caption 开头加「资源{id}」前缀(占一行)。
 * mediaCounts:仅 media_group 锦文本用,有隐藏项时切到引导展开的文案。
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
  resourceId?: number,
  mediaCounts?: { total: number; visible: number; hidden: number },
) {
  const { type, mediaFiles } = resource;
  const caption = resourceId !== undefined
    ? (resource.caption ? `资源${resourceId}\n${resource.caption}` : `资源${resourceId}`)
    : resource.caption;

  if (!mediaFiles.length) {
    // 无媒体文件，仅发送文字
    if (caption) await ctx.reply(caption, keyboard ? { reply_markup: keyboard } : undefined);
    return;
  }

  if (type === 'media_group') {
    await sendMediaGroup(ctx, botId, mediaFiles, caption);
    // media_group 不支持 inline keyboard，单独发送键盘
    if (keyboard) {
      const anchorText = mediaCounts && mediaCounts.hidden > 0
        ? `✅ 第1组已经发送\n（此资源共${mediaCounts.total}文件 已发${mediaCounts.visible} 还剩${mediaCounts.hidden}文件 未发送）\n👇点击下方 展开更多 按钮 查看全部资源文件👇`
        : '👆 以上是当前资源';
      await ctx.reply(anchorText, { reply_markup: keyboard });
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
  // 构建广告内联按钮(过滤空 text/url,避免 Telegram 拒收 inline keyboard)
  let adKeyboard: InlineKeyboard | undefined;
  const buttons = (adBinding.buttons as { text: string; url: string }[] | null)?.filter(
    (b) => b && typeof b.text === 'string' && b.text.trim() && typeof b.url === 'string' && b.url.trim(),
  );
  if (buttons && buttons.length > 0) {
    adKeyboard = new InlineKeyboard();
    for (const btn of buttons) {
      adKeyboard.url(btn.text.trim(), btn.url.trim()).row();
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
  const buttons = endContent.buttons?.filter(
    (b) => b && typeof b.text === 'string' && b.text.trim() && typeof b.url === 'string' && b.url.trim(),
  );
  if (buttons && buttons.length > 0) {
    keyboard = new InlineKeyboard();
    for (const btn of buttons) {
      keyboard.url(btn.text.trim(), btn.url.trim()).row();
    }
  }
  await ctx.reply(endContent.text, keyboard ? { reply_markup: keyboard } : undefined);
}

/**
 * 常驻底部 reply keyboard:🎲 随便看看 / ⭐ 我的收藏
 * 一旦发出,Telegram 客户端持续显示直到 ReplyKeyboardRemove。
 */
export function buildHomeReplyKeyboard(): Keyboard {
  return new Keyboard()
    .text('🎲 随便看看').text('⭐ 我的收藏')
    .resized().persistent();
}

export { buildPageKeyboard, buildContentKeyboard };
