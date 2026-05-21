/**
 * file_id 缓存预热脚本
 * 把所有 bot 在 ContentBinding 可派发的 Resource 中 "缓存有缺失" 的
 * 主动发送一次给指定的 TELEGRAM 用户, 拿到 Telegram 返回的 file_id 写入
 * BotFileId 缓存。之后真实用户访问时直接走 file_id, 不再走 S3 download。
 *
 * 用法:
 *   pnpm --filter bot exec tsx scripts/warm-cache.ts [--bot=<id>] [--limit=<n>]
 *
 * 接收方 chat_id 见 TARGET_CHAT_ID。
 * 注意:接收方必须先 /start 过对应 bot, 否则 sendXxx 会 "chat not found"。
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Bot, InputFile, InputMediaBuilder } from 'grammy';
import {
  isS3Path,
  parseS3Key,
  downloadToTmp,
  cleanupTmp,
} from '../src/services/storage';
import path from 'path';

const TARGET_CHAT_ID = 989948147;
const SLEEP_BETWEEN_RESOURCES_MS = 1500;
const SLEEP_BETWEEN_CHUNKS_MS = 500;

const prisma = new PrismaClient();
const apiRoot = process.env.TELEGRAM_API_ROOT || 'https://api.telegram.org';
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : '/opt/sourceBotV3/uploads';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArg(name: string): string | null {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : null;
}

function extractFileId(msg: any, type: string): string | null {
  if (type === 'photo' && msg?.photo?.length) {
    return msg.photo[msg.photo.length - 1].file_id;
  }
  if (type === 'video' && msg?.video) return msg.video.file_id;
  if (msg?.document) return msg.document.file_id;
  return null;
}

type ResolvedSource =
  | { kind: 'fileId'; value: string }
  | { kind: 'file'; absPath: string; cleanup?: () => void };

async function resolveSource(filePath: string): Promise<ResolvedSource> {
  // v2-*/<file_id>.<ext>
  const v2 = filePath.match(/^v2-[^/]+\/(.+)$/);
  if (v2) {
    return { kind: 'fileId', value: v2[1].replace(/\.[^/.]+$/, '') };
  }
  if (isS3Path(filePath)) {
    const tmpPath = await downloadToTmp(parseS3Key(filePath));
    return { kind: 'file', absPath: tmpPath, cleanup: () => { cleanupTmp(tmpPath); } };
  }
  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(UPLOAD_DIR, filePath);
  return { kind: 'file', absPath };
}

async function warmResource(
  bot: Bot,
  botId: number,
  resource: {
    id: number;
    type: string;
    mediaFiles: {
      id: number;
      type: string;
      filePath: string;
      duration: number | null;
      width: number | null;
      height: number | null;
      botFileIds: { fileId: string }[];
    }[];
  },
): Promise<'ok' | 'skip' | 'fail'> {
  const mfs = resource.mediaFiles;
  if (mfs.length === 0) return 'skip';
  if (mfs.every((m) => m.botFileIds.length > 0)) return 'skip';

  const resolveds = await Promise.all(mfs.map((m) => resolveSource(m.filePath)));
  const allCleanups: (() => void)[] = [];
  for (const r of resolveds) if (r.kind === 'file' && r.cleanup) allCleanups.push(r.cleanup);

  try {
    if (resource.type === 'media_group' || mfs.length > 1) {
      const CHUNK = 10;
      for (let i = 0; i < mfs.length; i += CHUNK) {
        const chunk = mfs.slice(i, i + CHUNK);
        const chunkSrcs = resolveds.slice(i, i + CHUNK);
        const items = chunk.map((m, idx) => {
          const src = chunkSrcs[idx];
          const source: string | InputFile =
            src.kind === 'fileId' ? src.value : new InputFile(src.absPath);
          if (m.type === 'video') {
            const opts: any = { supports_streaming: true };
            if (m.duration) opts.duration = m.duration;
            if (m.width) opts.width = m.width;
            if (m.height) opts.height = m.height;
            return InputMediaBuilder.video(source, opts);
          }
          return InputMediaBuilder.photo(source, {});
        });
        const messages = await bot.api.sendMediaGroup(TARGET_CHAT_ID, items);
        for (let j = 0; j < messages.length; j++) {
          const m = chunk[j];
          const fid = extractFileId(messages[j], m.type);
          if (fid) {
            await prisma.botFileId.upsert({
              where: { botId_mediaFileId: { botId, mediaFileId: m.id } },
              create: { botId, mediaFileId: m.id, fileId: fid },
              update: { fileId: fid },
            });
          }
        }
        if (i + CHUNK < mfs.length) await sleep(SLEEP_BETWEEN_CHUNKS_MS);
      }
    } else {
      const m = mfs[0];
      const src = resolveds[0];
      const source: string | InputFile =
        src.kind === 'fileId' ? src.value : new InputFile(src.absPath);
      let msg: any;
      if (m.type === 'video') {
        const opts: any = { supports_streaming: true };
        if (m.duration) opts.duration = m.duration;
        if (m.width) opts.width = m.width;
        if (m.height) opts.height = m.height;
        msg = await bot.api.sendVideo(TARGET_CHAT_ID, source as any, opts);
      } else {
        msg = await bot.api.sendPhoto(TARGET_CHAT_ID, source as any, {});
      }
      const fid = extractFileId(msg, m.type);
      if (fid) {
        await prisma.botFileId.upsert({
          where: { botId_mediaFileId: { botId, mediaFileId: m.id } },
          create: { botId, mediaFileId: m.id, fileId: fid },
          update: { fileId: fid },
        });
      }
    }
    return 'ok';
  } catch (err: any) {
    console.error(`  Resource ${resource.id} 失败:`, err?.message || err);
    return 'fail';
  } finally {
    for (const c of allCleanups) c();
  }
}

async function main() {
  const onlyBotId = parseArg('bot') ? Number(parseArg('bot')) : null;
  const limit = parseArg('limit') ? Number(parseArg('limit')) : null;

  const bots = await prisma.bot.findMany({
    where: { isActive: true, ...(onlyBotId ? { id: onlyBotId } : {}) },
    select: { id: true, token: true, name: true },
    orderBy: { id: 'asc' },
  });

  console.log(`[warm-cache] 目标 chat_id=${TARGET_CHAT_ID}, 共 ${bots.length} 个 bot${limit ? `, 每 bot 最多 ${limit} 条` : ''}`);

  for (const b of bots) {
    console.log(`\n=== bot ${b.id} (${b.name}) ===`);
    const reachable = await prisma.resource.findMany({
      where: { contentBindings: { some: { inviteLink: { botId: b.id } } } },
      include: {
        mediaFiles: {
          orderBy: { sortOrder: 'asc' },
          include: { botFileIds: { where: { botId: b.id }, select: { fileId: true } } },
        },
      },
      orderBy: { id: 'asc' },
    });
    const needWarm = reachable.filter(
      (r) => r.mediaFiles.length > 0 && r.mediaFiles.some((m) => m.botFileIds.length === 0),
    );
    const list = limit ? needWarm.slice(0, limit) : needWarm;
    console.log(`  reachable ${reachable.length}, 待预热 ${needWarm.length}${limit ? ` (本次跑 ${list.length})` : ''}`);

    const bot = new Bot(b.token, { client: { apiRoot } });
    let ok = 0, fail = 0, skip = 0;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const status = await warmResource(bot, b.id, r);
      if (status === 'ok') ok++;
      else if (status === 'fail') fail++;
      else skip++;
      if ((i + 1) % 5 === 0 || i === list.length - 1) {
        console.log(`  [${i + 1}/${list.length}] ok=${ok} fail=${fail} skip=${skip}`);
      }
      if (i < list.length - 1) await sleep(SLEEP_BETWEEN_RESOURCES_MS);
    }
    console.log(`bot ${b.id} 完成: ok=${ok} fail=${fail} skip=${skip}`);
  }
}

main()
  .catch((err) => {
    console.error('[warm-cache] 致命错误:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
