import prisma from '../prisma';

/**
 * 资源点赞:每用户每资源 unique;有则点赞过,无则未点赞。
 */

export async function isLiked(botUserId: number, resourceId: number): Promise<boolean> {
  const row = await prisma.resourceLike.findUnique({
    where: { botUserId_resourceId: { botUserId, resourceId } },
    select: { id: true },
  });
  return row !== null;
}

/** 返回 true=新创建,false=已存在 */
export async function addLike(botUserId: number, resourceId: number): Promise<boolean> {
  try {
    await prisma.resourceLike.create({
      data: { botUserId, resourceId },
    });
    return true;
  } catch {
    // unique 约束撞了视为已存在
    return false;
  }
}

/** 返回 true=删除了,false=本来就没有 */
export async function removeLike(botUserId: number, resourceId: number): Promise<boolean> {
  const res = await prisma.resourceLike.deleteMany({
    where: { botUserId, resourceId },
  });
  return res.count > 0;
}
