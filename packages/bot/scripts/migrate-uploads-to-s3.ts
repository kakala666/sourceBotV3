/**
 * 把 /opt/sourceBotV3/uploads/ 下所有 MediaFile.filePath / thumbnailPath
 * 上传到 Wasabi,然后改 DB 字段为 's3:media/<filename>',最后删本地文件。
 *
 * 边迁边释放本地空间。可重复跑(只看 's3:' 前缀)。
 *
 * 用法:
 *   pnpm --filter bot exec tsx scripts/migrate-uploads-to-s3.ts
 */
import path from 'path';
import fs from 'fs';
import prisma from '../src/prisma';
import { uploadLocalFile, headSize, makeS3Path, S3_PREFIX } from '../src/services/storage';

const UPLOADS_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : '/opt/sourceBotV3/uploads';

const S3_MEDIA_PREFIX = 'media/';

function isMigrated(stored: string | null): boolean {
  return !!stored && stored.startsWith(S3_PREFIX);
}

async function migrateOne(localFileName: string, contentType: string): Promise<string> {
  // localFileName: '1779125627985-832884527.mp4' (DB 里 filePath 的值,纯文件名)
  const localPath = path.join(UPLOADS_ROOT, localFileName);

  let localSize: number;
  try {
    localSize = fs.statSync(localPath).size;
  } catch {
    throw new Error(`MISSING_LOCAL`);
  }

  const key = `${S3_MEDIA_PREFIX}${localFileName}`;

  // 已经在 S3 → 跳过上传,直接进入校验/更新流程
  const existingSize = await headSize(key);
  if (existingSize === null) {
    await uploadLocalFile(localPath, key, contentType);
  } else if (existingSize !== localSize) {
    // 大小不一致,重传覆盖
    await uploadLocalFile(localPath, key, contentType);
  }

  // 校验
  const verified = await headSize(key);
  if (verified !== localSize) {
    throw new Error(`SIZE_MISMATCH local=${localSize} s3=${verified}`);
  }

  // 删本地
  await fs.promises.unlink(localPath).catch(() => {});

  return makeS3Path(key);
}

async function main() {
  console.log('[migrate] 启动,本地根目录:', UPLOADS_ROOT);

  const total = await prisma.mediaFile.count({
    where: {
      OR: [
        { NOT: { filePath: { startsWith: S3_PREFIX } } },
        { AND: [{ thumbnailPath: { not: null } }, { NOT: { thumbnailPath: { startsWith: S3_PREFIX } } }] },
      ],
    },
  });
  console.log(`[migrate] 待处理 MediaFile: ${total}`);

  let done = 0;
  let failedMain = 0;
  let failedThumb = 0;
  let skippedMissing = 0;
  const startedAt = Date.now();
  const batchSize = 50;

  for (;;) {
    const batch = await prisma.mediaFile.findMany({
      where: {
        OR: [
          { NOT: { filePath: { startsWith: S3_PREFIX } } },
          { AND: [{ thumbnailPath: { not: null } }, { NOT: { thumbnailPath: { startsWith: S3_PREFIX } } }] },
        ],
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true, type: true, filePath: true, thumbnailPath: true, mimeType: true },
    });
    if (batch.length === 0) break;

    for (const mf of batch) {
      const updates: { filePath?: string; thumbnailPath?: string } = {};

      // 主文件
      if (!isMigrated(mf.filePath)) {
        try {
          const newPath = await migrateOne(mf.filePath, mf.mimeType || 'application/octet-stream');
          updates.filePath = newPath;
        } catch (err: any) {
          if (err?.message === 'MISSING_LOCAL') {
            skippedMissing++;
            console.warn(`[migrate] MediaFile ${mf.id} 主文件本地缺失,跳过: ${mf.filePath}`);
          } else {
            failedMain++;
            console.error(`[migrate] MediaFile ${mf.id} 主文件上传失败:`, err.message);
            continue; // 这条整体跳过,缩略图也不动
          }
        }
      }

      // 缩略图(如果有且未迁)
      if (mf.thumbnailPath && !isMigrated(mf.thumbnailPath)) {
        try {
          const newPath = await migrateOne(mf.thumbnailPath, 'image/jpeg');
          updates.thumbnailPath = newPath;
        } catch (err: any) {
          if (err?.message === 'MISSING_LOCAL') {
            console.warn(`[migrate] MediaFile ${mf.id} 缩略图本地缺失,跳过: ${mf.thumbnailPath}`);
          } else {
            failedThumb++;
            console.error(`[migrate] MediaFile ${mf.id} 缩略图上传失败:`, err.message);
          }
        }
      }

      if (Object.keys(updates).length > 0) {
        await prisma.mediaFile.update({ where: { id: mf.id }, data: updates });
      }
      done++;
      if (done % 20 === 0) {
        const elapsed = (Date.now() - startedAt) / 1000;
        const rate = done / elapsed;
        const eta = total > done ? Math.round((total - done) / rate) : 0;
        console.log(`[migrate] 已处理 ${done}/${total} | 速率 ${rate.toFixed(1)}/s | ETA ${eta}s | 主失败 ${failedMain} 缩略失败 ${failedThumb} 缺失 ${skippedMissing}`);
      }
    }
  }

  console.log(`[migrate] 完成。处理 ${done},主失败 ${failedMain},缩略失败 ${failedThumb},本地缺失 ${skippedMissing}。`);
}

main()
  .catch((err) => {
    console.error('[migrate] 致命错误:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
