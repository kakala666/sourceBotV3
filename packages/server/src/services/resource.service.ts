import prisma from './prisma';
import fs from 'fs';
import path from 'path';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from 'shared';
import type { PaginatedResponse, ResourceInfo } from 'shared';
import { getVideoMeta, generateThumbnail } from '../utils/video';
import { notifyResource, type NotifyRecipient } from './notify-resource.client';

const uploadDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(__dirname, '../../../uploads');

/** group 含 BigInt channelChatId,JSON 序列化前转 string */
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
    if (params.groupId !== undefined) {
      where.groupId = params.groupId;
    }
    if (params.search) {
      const s = params.search.trim();
      // 纯数字:按 id 精确 OR caption 模糊;否则只 caption 模糊
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

  /**
   * 覆盖式更新资源标签。
   * 计算 diff:对新增的 tag,异步触发"对收藏过含该 tag 资源的用户推送当前资源"。
   * 删除/不变的 tag 不触发推送。
   */
  static async setTags(resourceId: number, tags: string[]): Promise<string[]> {
    // 规范化:trim + 去空 + 去重
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

    // 异步触发推送(只对新增 tag)
    if (toAdd.length > 0) {
      this.triggerPushForAddedTags(resourceId, toAdd).catch((e) =>
        console.error('[setTags] push trigger failed:', e.message),
      );
    }

    return normalized;
  }

  /**
   * 对新增的 tag 计算受众:
   *   "曾收藏过任何带这些 tag 中之一的资源的所有 BotUser"
   * 然后调 bot 内部 API 推送当前 resource。
   */
  private static async triggerPushForAddedTags(resourceId: number, addedTags: string[]) {
    // 找所有相关 botUserId
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