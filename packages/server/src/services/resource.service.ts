import prisma from './prisma';
import fs from 'fs';
import path from 'path';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from 'shared';
import type { PaginatedResponse, ResourceInfo } from 'shared';
import { getVideoMeta, generateThumbnail } from '../utils/video';

const uploadDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(__dirname, '../../../uploads');

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
    if (params.groupId !== undefined) {
      where.groupId = params.groupId;
    }
    if (params.search) {
      where.caption = { contains: params.search, mode: 'insensitive' };
    }

    const [items, total] = await Promise.all([
      prisma.resource.findMany({
        where,
        include: { mediaFiles: { orderBy: { sortOrder: 'asc' } }, group: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.resource.count({ where }),
    ]);

    return {
      items: items as unknown as ResourceInfo[],
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  static async create(data: {
    type: string;
    caption?: string;
    groupId?: number;
    files: Express.Multer.File[];
  }) {
    // 先创建资源记录
    const resource = await prisma.resource.create({
      data: {
        type: data.type,
        caption: data.caption || null,
        groupId: data.groupId || null,
        mediaFiles: {
          create: data.files.map((file, index) => ({
            type: file.mimetype.startsWith('video/') ? 'video' : 'photo',
            filePath: file.filename,
            fileName: file.originalname,
            mimeType: file.mimetype,
            fileSize: file.size,
            sortOrder: index,
          })),
        },
      },
      include: { mediaFiles: true, group: true },
    });

    // 异步提取视频元数据和缩略图（不阻塞响应）
    this.processVideoFiles(resource.mediaFiles).catch((err) => {
      console.error('[resource] 视频处理失败:', err.message);
    });

    return resource;
  }

  /** 对视频文件提取元数据和缩略图 */
  private static async processVideoFiles(
    mediaFiles: { id: number; filePath: string; mimeType: string }[],
  ) {
    for (const mf of mediaFiles) {
      if (!mf.mimeType.startsWith('video/')) continue;
      const absPath = path.join(uploadDir, mf.filePath);
      try {
        const meta = await getVideoMeta(absPath);
        const thumbName = await generateThumbnail(absPath, uploadDir);
        await prisma.mediaFile.update({
          where: { id: mf.id },
          data: {
            duration: meta.duration,
            width: meta.width,
            height: meta.height,
            thumbnailPath: thumbName,
          },
        });
      } catch (err: any) {
        console.error(`[resource] 视频 ${mf.id} 元数据提取失败:`, err.message);
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
    // 检查是否被引用
    const [contentCount, adCount] = await Promise.all([
      prisma.contentBinding.count({ where: { resourceId: id } }),
      prisma.adBinding.count({ where: { resourceId: id } }),
    ]);

    if (contentCount > 0 || adCount > 0) {
      return { referenced: true };
    }

    // 删除关联的媒体文件（磁盘）
    const mediaFiles = await prisma.mediaFile.findMany({ where: { resourceId: id } });
    for (const mf of mediaFiles) {
      const fullPath = path.join(uploadDir, mf.filePath);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      if (mf.thumbnailPath) {
        const thumbPath = path.join(uploadDir, mf.thumbnailPath);
        if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
      }
    }

    await prisma.resource.delete({ where: { id } });
    return { referenced: false };
  }
}