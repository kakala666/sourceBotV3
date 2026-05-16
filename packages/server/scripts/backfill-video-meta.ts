/**
 * 给历史视频补 duration/width/height/thumbnailPath。
 *
 * 用法(在 packages/server 下):
 *   npx tsx scripts/backfill-video-meta.ts
 *
 * 仅处理 MediaFile.type='video' 且 duration 为空 OR thumbnailPath 为空 的记录。
 * 串行处理避免 ffmpeg 撑爆 CPU。失败仅日志,继续下一个。
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import prisma from '../src/services/prisma';
import { getVideoMeta, generateThumbnail } from '../src/utils/video';

const uploadDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(__dirname, '../../../uploads');

async function main() {
  const targets = await prisma.mediaFile.findMany({
    where: {
      type: 'video',
      OR: [{ duration: null }, { thumbnailPath: null }],
    },
    orderBy: { id: 'asc' },
  });

  console.log(`upload dir: ${uploadDir}`);
  console.log(`需要回填:${targets.length} 个 video MediaFile`);

  let ok = 0, fail = 0;
  for (const mf of targets) {
    const absPath = path.join(uploadDir, mf.filePath);
    if (!fs.existsSync(absPath)) {
      console.error(`✗ ${mf.id} 文件不存在: ${absPath}`);
      fail++;
      continue;
    }
    try {
      const meta = await getVideoMeta(absPath);
      const thumb = await generateThumbnail(absPath, uploadDir);
      await prisma.mediaFile.update({
        where: { id: mf.id },
        data: {
          duration: meta.duration,
          width: meta.width,
          height: meta.height,
          thumbnailPath: thumb,
        },
      });
      console.log(`✓ ${mf.id} ${mf.fileName} → ${meta.duration}s ${meta.width}x${meta.height}, thumb=${thumb}`);
      ok++;
    } catch (err: any) {
      console.error(`✗ ${mf.id} ${mf.fileName}: ${err.message}`);
      fail++;
    }
  }

  console.log(`\n完成:成功 ${ok},失败 ${fail}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
