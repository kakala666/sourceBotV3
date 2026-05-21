import { InputFile, InputMediaBuilder, InlineKeyboard, Keyboard } from 'grammy';
import type { Context } from 'grammy';
import prisma from '../prisma';
import path from 'path';
import { isS3Path, parseS3Key, downloadToTmp, cleanupTmp } from './storage';
import { getBotUsername } from './bot-meta';

/** 上传文件的根目录，优先使用环境变量，否则从 cwd 推断 */
const UPLOADS_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(process.cwd(), 'uploads');

/**
 * v2 系统迁过来的占位符:filePath 形如 'v2-<bucket>/<file_id>.<ext>'
 * 已知前缀:'v2-placeholder/', 'v2-media/'。这种 MediaFile 没有本地副本
 * 也没有 S3 副本,直接把 file_id 给 Telegram 用。
 * 返回 file_id 字符串,匹配不到返回 null。
 */
function extractV2PlaceholderFileId(filePath: string): string | null {
  const m = filePath.match(/^v2-[^/]+\/(.+)$/);
  if (!m) return null;
  // 去掉可能的扩展名(.mp4/.jpg/...)
  return m[1].replace(/\.[^/.]+$/, '');
}

/**
 * 把 DB filePath(可能是 's3:xxx' 也可能是本地文件名)解析成本地绝对路径,
 * 返回 cleanup 函数(发完后调一次)。本地路径 cleanup 是 no-op。
 * v2-placeholder 路径在调用前已经被 short-circuit,这里不应该再看到。
 */
async function resolveLocalPath(filePath: string): Promise<{ absPath: string; cleanup: () => void }> {
  if (!isS3Path(filePath)) {
    return {
      absPath: path.isAbsolute(filePath) ? filePath : path.resolve(UPLOADS_ROOT, filePath),
      cleanup: () => {},
    };
  }
  const tmpPath = await downloadToTmp(parseS3Key(filePath));
  return { absPath: tmpPath, cleanup: () => { cleanupTmp(tmpPath); } };
}

/**
 * 判断是否为 file_id 失效错误（而非 URL/键盘等其他错误）
 */
function isFileIdError(err: any): boolean {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('wrong file identifier') || msg.includes('file_id') || msg.includes('invalid file');
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

  // v2-placeholder:filePath 里就是 file_id,直接发,失败即抛(不要走本地/S3 IO)
  const v2FileId = extractV2PlaceholderFileId(mediaFile.filePath);
  if (v2FileId) {
    const msg = await ctx.replyWithPhoto(v2FileId, opts);
    const fid = extractFileId(msg, 'photo');
    if (fid) await saveCachedFileId(botId, mediaFile.id, fid);
    return msg;
  }

  // 从本地文件上传(S3 路径会先下到 /tmp)
  const { absPath, cleanup } = await resolveLocalPath(mediaFile.filePath);
  try {
    const msg = await ctx.replyWithPhoto(new InputFile(absPath), opts);
    const fileId = extractFileId(msg, 'photo');
    if (fileId) await saveCachedFileId(botId, mediaFile.id, fileId);
    return msg;
  } finally {
    cleanup();
  }
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
  let thumbCleanup: (() => void) | null = null;
  if (mediaFile.thumbnailPath) {
    const t = await resolveLocalPath(mediaFile.thumbnailPath);
    opts.thumbnail = new InputFile(t.absPath);
    thumbCleanup = t.cleanup;
  }

  if (cachedId) {
    try {
      return await ctx.replyWithVideo(cachedId, opts);
    } catch (err: any) {
      if (!isFileIdError(err)) throw err;
      console.error(`[sender] file_id 失效，重新上传: mediaFile=${mediaFile.id}`, err.message);
      await deleteCachedFileId(botId, mediaFile.id);
    } finally {
      // 缩略图只在 cachedId 路径下用了一次,这里清理一次;后续走本地上传会重新 resolve
      if (cachedId && thumbCleanup) { thumbCleanup(); thumbCleanup = null; }
    }
  }

  // v2-placeholder:filePath 里就是 file_id,直接发
  const v2FileId = extractV2PlaceholderFileId(mediaFile.filePath);
  if (v2FileId) {
    try {
      const msg = await ctx.replyWithVideo(v2FileId, opts);
      const fid = extractFileId(msg, 'video');
      if (fid) await saveCachedFileId(botId, mediaFile.id, fid);
      return msg;
    } finally {
      if (thumbCleanup) thumbCleanup();
    }
  }

  // cachedId 失败回退或首次上传:重新 resolve 缩略图(上一次可能已 cleanup)
  if (mediaFile.thumbnailPath && !thumbCleanup) {
    const t = await resolveLocalPath(mediaFile.thumbnailPath);
    opts.thumbnail = new InputFile(t.absPath);
    thumbCleanup = t.cleanup;
  }
  const { absPath, cleanup } = await resolveLocalPath(mediaFile.filePath);
  try {
    const msg = await ctx.replyWithVideo(new InputFile(absPath), opts);
    const fileId = extractFileId(msg, 'video');
    if (fileId) await saveCachedFileId(botId, mediaFile.id, fileId);
    return msg;
  } finally {
    cleanup();
    if (thumbCleanup) thumbCleanup();
  }
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

/** 构建单条 video 的 InputMediaVideo 选项,带流媒体优化与缩略图(thumbAbsPath 由调用方预先 resolve) */
function buildVideoOpts(
  mf: MediaFileLike,
  itemCaption: string | undefined,
  thumbAbsPath: string | null,
): any {
  const opts: any = { supports_streaming: true };
  if (itemCaption !== undefined) opts.caption = itemCaption;
  if (mf.duration) opts.duration = mf.duration;
  if (mf.width) opts.width = mf.width;
  if (mf.height) opts.height = mf.height;
  if (thumbAbsPath) {
    opts.thumbnail = new InputFile(thumbAbsPath);
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
  // 1) 预查 file_id 缓存 + v2 占位:这两类都不需要本地副本,跳过 S3 download
  const v2Ids: (string | null)[] = mediaFiles.map((mf) => extractV2PlaceholderFileId(mf.filePath));
  const cachedIds: (string | null)[] = await Promise.all(
    mediaFiles.map((mf) => getCachedFileId(botId, mf.id)),
  );
  // 2) 只对真正需要上传的(cache miss + 非 v2)mediaFile 拉 S3 / 本地 path
  const resolvedMain = await Promise.all(
    mediaFiles.map((mf, i) =>
      cachedIds[i] || v2Ids[i] ? Promise.resolve(null) : resolveLocalPath(mf.filePath),
    ),
  );
  // 缩略图同理:cachedId 命中时 Telegram 用缓存里的缩略图,无需我们再传
  const resolvedThumb = await Promise.all(
    mediaFiles.map((mf, i) => {
      if (!mf.thumbnailPath) return Promise.resolve(null);
      if (cachedIds[i] || v2Ids[i]) return Promise.resolve(null);
      return resolveLocalPath(mf.thumbnailPath);
    }),
  );
  const cleanupAll = () => {
    for (const r of resolvedMain) if (r) r.cleanup();
    for (const r of resolvedThumb) if (r) r.cleanup();
  };

  try {
    const mediaItems: any[] = [];
    const uploadedFromLocal = new Set<number>();

    for (let i = 0; i < mediaFiles.length; i++) {
      const mf = mediaFiles[i];
      const cachedId = cachedIds[i];  // 复用外层预查结果,不再二次查 DB
      const itemCaption = i === 0 ? (caption ?? undefined) : undefined;
      const thumbAbs = resolvedThumb[i]?.absPath ?? null;

      let source: string | InputFile;
      if (cachedId) {
        source = cachedId;
      } else if (v2Ids[i]) {
        // v2-placeholder:filePath 即 file_id,直接发
        source = v2Ids[i] as string;
        uploadedFromLocal.add(i);
      } else {
        source = new InputFile(resolvedMain[i]!.absPath);
        uploadedFromLocal.add(i);
      }

      if (mf.type === 'video') {
        mediaItems.push(InputMediaBuilder.video(source, buildVideoOpts(mf, itemCaption, thumbAbs)));
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
      // 之前缓存命中的 mediaFile 没下载本地 tmp,retry 要全部 resolve
      for (let i = 0; i < mediaFiles.length; i++) {
        if (v2Ids[i]) continue;
        if (!resolvedMain[i]) {
          resolvedMain[i] = await resolveLocalPath(mediaFiles[i].filePath);
        }
        if (mediaFiles[i].thumbnailPath && !resolvedThumb[i]) {
          resolvedThumb[i] = await resolveLocalPath(mediaFiles[i].thumbnailPath!);
        }
      }
      const retryItems = mediaFiles.map((mf, i) => {
        const src: string | InputFile = v2Ids[i]
          ? (v2Ids[i] as string)
          : new InputFile(resolvedMain[i]!.absPath);
        const cap = i === 0 ? (caption ?? undefined) : undefined;
        const thumbAbs = resolvedThumb[i]?.absPath ?? null;
        return mf.type === 'video'
          ? InputMediaBuilder.video(src, buildVideoOpts(mf, cap, thumbAbs))
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
  } finally {
    cleanupAll();
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
  globalButtons?: { text: string; url: string }[] | null,
  likeInfo?: { sessionId: number; resourceId: number; liked: boolean } | null,
  shareInfo?: { botId: number; resourceId: number } | null,
): InlineKeyboard | undefined {
  // 过滤掉无效按钮:text 或 url 为空都会让 Telegram 把按钮解析成 KeyboardButton 报错
  const validContentButtons = (contentButtons ?? []).filter(
    (b) => b && typeof b.text === 'string' && b.text.trim() && typeof b.url === 'string' && b.url.trim(),
  );
  const validGlobalButtons = (globalButtons ?? []).filter(
    (b) => b && typeof b.text === 'string' && b.text.trim() && typeof b.url === 'string' && b.url.trim(),
  );
  const hasContentBtns = validContentButtons.length > 0;
  const hasGlobalBtns = validGlobalButtons.length > 0;
  const hasPageBtn = sessionId !== undefined && nextIndex !== undefined;
  const hasReveal = !!revealInfo;
  const hasFav = !!favoriteInfo;
  const hasLike = !!likeInfo;
  // 分享按钮:只在 bot.username 已配置时才能造 deep link
  const shareUsername = shareInfo ? getBotUsername(shareInfo.botId) : null;
  const hasShare = !!(shareInfo && shareUsername);

  if (!hasContentBtns && !hasGlobalBtns && !hasPageBtn && !hasReveal && !hasFav && !hasLike && !hasShare) return undefined;

  const keyboard = new InlineKeyboard();

  // 内容按钮在上方
  if (hasContentBtns) {
    for (const btn of validContentButtons) {
      keyboard.url(btn.text.trim(), btn.url.trim()).row();
    }
  }

  // bot 全局按钮(放在资源按钮之后, 展开 / 收藏 / 翻页 之前)
  if (hasGlobalBtns) {
    for (const btn of validGlobalButtons) {
      keyboard.url(btn.text.trim(), btn.url.trim()).row();
    }
  }

  // 「展开更多」靠上(与当前页媒体相关的副动作)
  if (hasReveal) {
    keyboard.text('🔽 展开更多', `reveal:${revealInfo!.sessionId}:${revealInfo!.currentIndex}`).row();
  }

  // 「👍 点赞 / ❌ 取消点赞」+「⭐ 收藏」同一行(都是用户对资源的副动作)
  if (hasLike || hasFav) {
    if (hasLike) {
      const text = likeInfo!.liked ? '❌ 取消点赞' : '👍 点赞';
      const action = likeInfo!.liked ? 'unlike' : 'like';
      keyboard.text(text, `${action}:${likeInfo!.sessionId}:${likeInfo!.resourceId}`);
    }
    if (hasFav) {
      keyboard.text('⭐ 收藏', `fav:${favoriteInfo!.sessionId}:${favoriteInfo!.resourceId}`);
    }
    keyboard.row();
  }

  // 「搜索更多资源」紧贴翻页按钮上方(仅当有翻页按钮时显示)
  if (hasPageBtn && searchMoreUrl) {
    keyboard.url('🔍 搜索更多资源', searchMoreUrl).row();
  }

  // 翻页按钮
  if (hasPageBtn) {
    keyboard.text('下一页 ▶', `next:${sessionId}:${nextIndex}`);
    if (hasShare) keyboard.row();
  }

  // 「🔗 分享」放最末行:点击弹出 Telegram 原生「分享到」对话框,转发 deep link 给联系人
  if (hasShare) {
    const deepLink = `https://t.me/${shareUsername}?start=share_${shareInfo!.resourceId}`;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(deepLink)}&text=${encodeURIComponent('点击查看这条资源')}`;
    keyboard.url('🔗 分享', shareUrl);
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

  // 「观看量」累加(异步 fire-and-forget):仅在指定了 resourceId 时记一次,排除 reveal 重发
  if (resourceId !== undefined) {
    prisma.resource
      .update({ where: { id: resourceId }, data: { viewCount: { increment: 1 } } })
      .catch((e: any) => console.error('[view] +1 failed:', e.message));
  }

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
 * 常驻底部 reply keyboard:2 行 × 2 列
 *   随便看看 / 搜索
 *   热搜 / 我的收藏
 * 一旦发出,Telegram 客户端持续显示直到 ReplyKeyboardRemove。
 */
export function buildHomeReplyKeyboard(): Keyboard {
  return new Keyboard()
    .text('🎲 随便看看').text('🔍 搜索').row()
    .text('🔥 热搜').text('⭐ 我的收藏')
    .resized().persistent();
}

export { buildPageKeyboard, buildContentKeyboard };
