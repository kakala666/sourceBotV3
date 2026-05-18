import prisma from '../prisma';

export interface FavoriteItem {
  resource: {
    id: number;
    type: string;
    caption: string | null;
    mediaFiles: any[];
  };
  buttons: null;
  sortOrder: number;
}

let prismaRef: any = prisma;
export function _setPrismaForTests(p: any) { prismaRef = p; }

/**
 * 加载某 botUser 的全部收藏,按 createdAt desc 排序,
 * 转成与 loadContentBindings 兼容的形状(buttons=null,sortOrder=i)。
 */
export async function loadFavoriteList(botUserId: number): Promise<FavoriteItem[]> {
  const favs = await prismaRef.favoriteResource.findMany({
    where: { botUserId },
    orderBy: { createdAt: 'desc' },
    include: {
      resource: { include: { mediaFiles: { orderBy: { sortOrder: 'asc' } } } },
    },
  });
  return favs.map((f: any, i: number) => ({
    resource: f.resource,
    buttons: null,
    sortOrder: i,
  }));
}
