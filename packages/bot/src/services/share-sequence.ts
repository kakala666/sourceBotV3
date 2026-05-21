import prisma from '../prisma';

/**
 * 「分享」入口的资源序列:
 *   池子同「随便看看 / 搜索」:type='media_group' + 至少被一个 ContentBinding 引用过
 *   排序:点赞数 desc → 收藏数 desc → 观看数 desc → id desc
 *   最多 100 条,首条强制为 originResourceId(若不在 top100 也插到首位,其余截到 99 条)
 */

const TOTAL_LIMIT = 100;

let prismaRef: any = prisma;
export function _setPrismaForTests(p: any) { prismaRef = p; }

export async function buildShareSequence(originResourceId: number): Promise<number[]> {
  const rows = await prismaRef.$queryRaw<{ id: number }[]>`
    SELECT r.id
    FROM "Resource" r
    LEFT JOIN (
      SELECT "resourceId", COUNT(*)::int AS cnt
      FROM "ResourceLike"
      GROUP BY "resourceId"
    ) l ON l."resourceId" = r.id
    LEFT JOIN (
      SELECT "resourceId", COUNT(*)::int AS cnt
      FROM "FavoriteResource"
      GROUP BY "resourceId"
    ) f ON f."resourceId" = r.id
    WHERE r.type = 'media_group'
      AND EXISTS (SELECT 1 FROM "ContentBinding" cb WHERE cb."resourceId" = r.id)
    ORDER BY
      COALESCE(l.cnt, 0) DESC,
      COALESCE(f.cnt, 0) DESC,
      COALESCE(r."viewCount", 0) DESC,
      r.id DESC
    LIMIT ${TOTAL_LIMIT};
  `;
  const ids = rows.map((r: { id: number }) => r.id);

  // origin 顶到首位:若已在 top100 则前移;若不在,也插入到首位(末尾溢出截掉)
  const filtered = ids.filter((id: number) => id !== originResourceId);
  return [originResourceId, ...filtered].slice(0, TOTAL_LIMIT);
}
