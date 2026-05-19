import prisma from './prisma';
import fs from 'fs';
import path from 'path';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from 'shared';
import type {
  PaginatedResponse,
  ResourceInfo,
  PresignUploadRequestItem,
  PresignUploadResponseItem,
  ResourceRegisterFile,
} from 'shared';
import { getVideoMeta, generateThumbnail } from '../utils/video';
import { notifyResource, type NotifyRecipient } from './notify-resource.client';
import {
  getPresignedPutUrl,
  headSize,
  downloadToTmp,
  uploadLocalFile,
  cleanupTmp,
  deleteFromS3,
  isS3Path,
  parseS3Key,
  makeS3Path,
  S3_MEDIA_PREFIX,
} from './storage.service';

/** 兼容老数据:个别 MediaFile 还可能是裸文件名(本地 uploads/)。删除时走 unlink */
const localUploadDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(__dirname, '../../../uploads');

function serializeGroup(g: any) {
  if (!g) return g;
  return {
    ...g,
    channelChatId: g.channelChatId != null ? g.channelChatId.toString() : null,
  };
}

export class ResourceService {
  static async list(params: {
    page?: number;
    pageSize?: number;
    groupId?: number;
    search?: string;
  }): Promise<PaginatedResponse<ResourceInfo>> {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize || DEFAULT_PAGE_SIZE));
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (params.groupId !== undefined) where.groupId = params.groupId;
    if (params.search) {
      const s = params.search.trim();
      if (/^\d+$/.test(s)) {
        where.OR = [
          { id: Number(s) },
          { caption: { contains: s, mode: 'insensitive' } },
        ];
      } else {
        where.caption = { contains: s, mode: 'insensitive' };
      }
    }

    const [items, total] = await Promise.all([
      prisma.resource.findMany({
        where,
        include: {
          mediaFiles: { orderBy: { sortOrder: 'asc' } },
          group: true,
          tags: { select: { tag: true }, orderBy: { tag: 'asc' } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.resource.count({ where }),
    ]);

    const serialized = items.map((r: any) => ({
      ...r,
      group: serializeGroup(r.group),
      tags: (r.tags ?? []).map((t: any) => t.tag),
    }));

    return {
      items: serialized as unknown as ResourceInfo[],
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /** 浏览器直传 - 第 1 步:为每个文件签发 presigned PUT URL */
  static async presignUploads(
    items: PresignUploadRequestItem[],
  ): Promise<PresignUploadResponseItem[]> {
    const out: PresignUploadResponseItem[] = [];
    for (const f of items) {
      const ext = path.extname(f.originalName) || (f.mimetype.startsWith('video/') ? '.mp4' : '.jpg');
      const key = `${S3_MEDIA_PREFIX}${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
      const url = await getPresignedPutUrl(key, f.mimetype);
      out.push({ key, url, contentType: f.mimetype });
    }
    return out;
  }

  /** 浏览器直传 - 第 2 步:client PUT 完成后登记 Resource */
  static async create(data: {
    type: string;
    caption?: string;
    groupId?: number;
    files: ResourceRegisterFile[];
  }) {
    // 校验每个 key 真的存在于 S3 (防止伪造)
    for (const f of data.files) {
      const size = await headSize(f.key);
      if (size === null) {
        throw new Error(`文件 ${f.originalName} 未上传成功 (S3 找不到 key)`);
      }
    }

    const resource = await prisma.resource.create({
      data: {
        type: data.type,
        caption: data.caption || null,
        groupId: data.groupId || null,
        mediaFiles: {
          create: data.files.map((f, index) => ({
            type: f.mimetype.startsWith('video/') ? 'video' : 'photo',
            filePath: makeS3Path(f.key),
            fileName: f.originalName,
            mimeType: f.mimetype,
            fileSize: f.size,
            sortOrder: index,
          })),
        },
      },
      include: { mediaFiles: true, group: true },
    });

    // 异步:对视频从 S3 拉 tmp → ffmpeg meta + 缩略图 → upload 缩略图
    this.processVideoFiles(resource.mediaFiles).catch((err) => {
      console.error('[resource] 视频处理失败:', err.message);
    });

    return resource;
  }

  private static async processVideoFiles(
    mediaFiles: { id: number; filePath: string; mimeType: string }[],
  ) {
    for (const mf of mediaFiles) {
      if (!mf.mimeType.startsWith('video/')) continue;
      // 只处理 S3 存的视频(新上传的);兼容老的本地视频(虽然 create 路径下不会再产生)
      let tmpPath: string | null = null;
      try {
        if (isS3Path(mf.filePath)) {
          tmpPath = await downloadToTmp(parseS3Key(mf.filePath));
        } else {
          tmpPath = path.join(localUploadDir, mf.filePath);
          if (!fs.existsSync(tmpPath)) {
            console.warn(`[resource] 视频 ${mf.id} 本地缺失:`, tmpPath);
            continue;
          }
        }
        const meta = await getVideoMeta(tmpPath);
        const thumbName = await generateThumbnail(tmpPath, path.dirname(tmpPath));
        const thumbLocal = path.join(path.dirname(tmpPath), thumbName);
        const thumbKey = `${S3_MEDIA_PREFIX}${thumbName}`;
        await uploadLocalFile(thumbLocal, thumbKey, 'image/jpeg');
        await prisma.mediaFile.update({
          where: { id: mf.id },
          data: {
            duration: meta.duration,
            width: meta.width,
            height: meta.height,
            thumbnailPath: makeS3Path(thumbKey),
          },
        });
      } catch (err: any) {
        console.error(`[resource] 视频 ${mf.id} 元数据提取失败:`, err.message);
      } finally {
        // 只清 S3 临时目录;本地老资源不能清
        if (tmpPath && isS3Path(mf.filePath)) {
          await cleanupTmp(tmpPath);
        }
      }
    }
  }

  static async update(id: number, data: { caption?: string; groupId?: number | null }) {
    return prisma.resource.update({
      where: { id },
      data,
      include: { mediaFiles: true, group: true },
    });
  }

  static async delete(id: number) {
    const [contentCount, adCount] = await Promise.all([
      prisma.contentBinding.count({ where: { resourceId: id } }),
      prisma.adBinding.count({ where: { resourceId: id } }),
    ]);
    if (contentCount > 0 || adCount > 0) {
      return { referenced: true };
    }

    const mediaFiles = await prisma.mediaFile.findMany({ where: { resourceId: id } });
    for (const mf of mediaFiles) {
      // 删主文件
      try {
        if (isS3Path(mf.filePath)) {
          await deleteFromS3(parseS3Key(mf.filePath));
        } else {
          const fullPath = path.join(localUploadDir, mf.filePath);
          if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        }
      } catch (err: any) {
        console.error(`[resource] 删除主文件失败 mediaFile=${mf.id}:`, err?.message || err);
      }
      // 删缩略图
      if (mf.thumbnailPath) {
        try {
          if (isS3Path(mf.thumbnailPath)) {
            await deleteFromS3(parseS3Key(mf.thumbnailPath));
          } else {
            const thumbPath = path.join(localUploadDir, mf.thumbnailPath);
            if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
          }
        } catch (err: any) {
          console.error(`[resource] 删除缩略图失败 mediaFile=${mf.id}:`, err?.message || err);
        }
      }
    }

    await prisma.resource.delete({ where: { id } });
    return { referenced: false };
  }

  static async setTags(resourceId: number, tags: string[]): Promise<string[]> {
    const normalized = Array.from(new Set(
      tags.map((t) => String(t).trim()).filter((t) => t.length > 0 && t.length <= 50)
    ));

    const existing = await prisma.resourceTag.findMany({
      where: { resourceId },
      select: { tag: true },
    });
    const oldSet = new Set(existing.map((e) => e.tag));
    const newSet = new Set(normalized);

    const toAdd = normalized.filter((t) => !oldSet.has(t));
    const toRemove = [...oldSet].filter((t) => !newSet.has(t));

    await prisma.$transaction([
      ...(toRemove.length
        ? [prisma.resourceTag.deleteMany({ where: { resourceId, tag: { in: toRemove } } })]
        : []),
      ...toAdd.map((tag) =>
        prisma.resourceTag.create({ data: { resourceId, tag } }),
      ),
    ]);

    if (toAdd.length > 0) {
      this.triggerPushForAddedTags(resourceId, toAdd).catch((e) =>
        console.error('[setTags] push trigger failed:', e.message),
      );
    }

    return normalized;
  }

  private static async triggerPushForAddedTags(resourceId: number, addedTags: string[]) {
    const rows = await prisma.$queryRaw<{ botUserId: number; botId: number; telegramId: bigint }[]>`
      SELECT DISTINCT fr."botUserId", bu."botId", bu."telegramId"
      FROM "FavoriteResource" fr
      JOIN "ResourceTag" rt ON rt."resourceId" = fr."resourceId"
      JOIN "BotUser" bu ON bu.id = fr."botUserId"
      WHERE rt.tag = ANY(${addedTags}::text[])
    `;
    if (rows.length === 0) return;

    const recipients: NotifyRecipient[] = rows.map((r) => ({
      botId: r.botId,
      telegramId: r.telegramId.toString(),
    }));

    const tagDisplay = addedTags.map((t) => `#${t}`).join(' ');
    const prefixText = `📢 您关注的标签 ${tagDisplay} 有新资源`;

    await notifyResource(resourceId, recipients, prefixText);
  }
}
