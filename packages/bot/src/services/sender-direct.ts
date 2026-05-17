import { InputFile, InputMediaBuilder } from 'grammy';
import type { Api } from 'grammy';
import prisma from '../prisma';
import path from 'path';

/**
 * ctx-free 资源发送 —— 用于主动推送(notify-resource)等场景,
 * 不依赖 grammy Context,直接用 bot.api + chatId。
 *
 * 设计上和 sender.ts 中的 ctx 版本对应,共用 file_id 缓存(BotFileId 表),
 * 但两份代码独立,避免给翻页主流程带来风险。
 */

const UPLOADS_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(process.cwd(), 'uploads');

function getAbsolutePath(filePath: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(UPLOADS_ROOT, filePath);
}

function isFileIdError(err: any): boolean {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('wrong file identifier') || msg.includes('file_id') || msg.includes('invalid file');
}

async function getCachedFileId(botId: number, mediaFileId: number): Promise<string | null> {
  const rec = await prisma.botFileId.findUnique({
    where: { botId_mediaFileId: { botId, mediaFileId } },
  });
  return rec?.fileId ?? null;
}

async function saveCachedFileId(botId: number, mediaFileId: number, fileId: string) {
  await prisma.botFileId.upsert({
    where: { botId_mediaFileId: { botId, mediaFileId } },
    create: { botId, mediaFileId, fileId },
    update: { fileId },
  });
}

async function deleteCachedFileId(botId: number, mediaFileId: number) {
  await prisma.botFileId.deleteMany({ where: { botId, mediaFileId } });
}

function extractFileId(message: any, mediaType: string): string | null {
  if (mediaType === 'photo' && message.photo?.length) {
    return message.photo[message.photo.length - 1].file_id;
  }
  if (mediaType === 'video' && message.video) return message.video.file_id;
  if (message.document) return message.document.file_id;
  return null;
}

type MediaFileLike = {
  id: number; filePath: string; type: string;
  duration?: number | null; width?: number | null; height?: number | null; thumbnailPath?: string | null;
};

function buildVideoOpts(mf: MediaFileLike, itemCaption?: string): any {
  const opts: any = { supports_streaming: true };
  if (itemCaption !== undefined) opts.caption = itemCaption;
  if (mf.duration) opts.duration = mf.duration;
  if (mf.width) opts.width = mf.width;
  if (mf.height) opts.height = mf.height;
  if (mf.thumbnailPath) {
    opts.thumbnail = new InputFile(getAbsolutePath(mf.thumbnailPath));
  }
  return opts;
}

async function sendPhotoDirect(
  api: Api, chatId: number, botId: number, mf: MediaFileLike, caption?: string | null,
) {
  const cached = await getCachedFileId(botId, mf.id);
  const opts: any = {};
  if (caption) opts.caption = caption;

  if (cached) {
    try { return await api.sendPhoto(chatId, cached, opts); }
    catch (err: any) {
      if (!isFileIdError(err)) throw err;
      await deleteCachedFileId(botId, mf.id);
    }
  }
  const msg = await api.sendPhoto(chatId, new InputFile(getAbsolutePath(mf.filePath)), opts);
  const fid = extractFileId(msg, 'photo');
  if (fid) await saveCachedFileId(botId, mf.id, fid);
  return msg;
}

async function sendVideoDirect(
  api: Api, chatId: number, botId: number, mf: MediaFileLike, caption?: string | null,
) {
  const cached = await getCachedFileId(botId, mf.id);
  const opts = buildVideoOpts(mf, caption ?? undefined);

  if (cached) {
    try { return await api.sendVideo(chatId, cached, opts); }
    catch (err: any) {
      if (!isFileIdError(err)) throw err;
      await deleteCachedFileId(botId, mf.id);
    }
  }
  const msg = await api.sendVideo(chatId, new InputFile(getAbsolutePath(mf.filePath)), opts);
  const fid = extractFileId(msg, 'video');
  if (fid) await saveCachedFileId(botId, mf.id, fid);
  return msg;
}

const MEDIA_GROUP_CHUNK_SIZE = 10;

async function sendMediaGroupDirect(
  api: Api, chatId: number, botId: number, mediaFiles: MediaFileLike[], caption?: string | null,
) {
  for (let i = 0; i < mediaFiles.length; i += MEDIA_GROUP_CHUNK_SIZE) {
    const chunk = mediaFiles.slice(i, i + MEDIA_GROUP_CHUNK_SIZE);
    const batchCaption = i === 0 ? caption : null;
    if (chunk.length === 1) {
      const mf = chunk[0];
      if (mf.type === 'video') await sendVideoDirect(api, chatId, botId, mf, batchCaption);
      else await sendPhotoDirect(api, chatId, botId, mf, batchCaption);
      continue;
    }

    const items: any[] = [];
    const uploadedFromLocal = new Set<number>();
    for (let k = 0; k < chunk.length; k++) {
      const mf = chunk[k];
      const cached = await getCachedFileId(botId, mf.id);
      const itemCaption = k === 0 ? (batchCaption ?? undefined) : undefined;
      let source: string | InputFile;
      if (cached) source = cached;
      else {
        source = new InputFile(getAbsolutePath(mf.filePath));
        uploadedFromLocal.add(k);
      }
      if (mf.type === 'video') items.push(InputMediaBuilder.video(source, buildVideoOpts(mf, itemCaption)));
      else items.push(InputMediaBuilder.photo(source, { caption: itemCaption }));
    }
    try {
      const messages = await api.sendMediaGroup(chatId, items as any);
      for (const idx of uploadedFromLocal) {
        const mf = chunk[idx];
        const fid = extractFileId(messages[idx], mf.type);
        if (fid) await saveCachedFileId(botId, mf.id, fid);
      }
    } catch (err: any) {
      if (!isFileIdError(err)) throw err;
      for (const mf of chunk) await deleteCachedFileId(botId, mf.id);
      const retry = chunk.map((mf, k) => {
        const src = new InputFile(getAbsolutePath(mf.filePath));
        const cap = k === 0 ? (batchCaption ?? undefined) : undefined;
        return mf.type === 'video'
          ? InputMediaBuilder.video(src, buildVideoOpts(mf, cap))
          : InputMediaBuilder.photo(src, { caption: cap });
      });
      const messages = await api.sendMediaGroup(chatId, retry as any);
      for (let k = 0; k < messages.length; k++) {
        const fid = extractFileId(messages[k], chunk[k].type);
        if (fid) await saveCachedFileId(botId, chunk[k].id, fid);
      }
    }
  }
}

/**
 * 主动推送一条 Resource 给单个用户。
 * 不带 keyboard;caption 由 caller 拼好后传入(含「资源{id}」前缀等)。
 */
export async function sendResourceDirect(
  api: Api,
  botId: number,
  chatId: bigint,
  resource: {
    id: number;
    type: string;
    caption: string | null;
    mediaFiles: MediaFileLike[];
  },
  captionOverride?: string,
) {
  const chatIdNum = Number(chatId);
  const caption = captionOverride ?? resource.caption ?? undefined;

  if (!resource.mediaFiles.length) {
    if (caption) await api.sendMessage(chatIdNum, caption);
    return;
  }

  if (resource.type === 'media_group') {
    await sendMediaGroupDirect(api, chatIdNum, botId, resource.mediaFiles, caption ?? null);
    return;
  }

  const mf = resource.mediaFiles[0];
  if (resource.type === 'video' || mf.type === 'video') {
    await sendVideoDirect(api, chatIdNum, botId, mf, caption ?? null);
  } else {
    await sendPhotoDirect(api, chatIdNum, botId, mf, caption ?? null);
  }
}
