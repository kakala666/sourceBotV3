import prisma from '../prisma';

/**
 * 「热搜」列表:按观看量 desc → id desc,池子同其他入口:
 *   - type='media_group'
 *   - 至少被一个 ContentBinding 引用过
 * 最多 100 条。
 */

const LIMIT = 100;

let prismaRef: any = prisma;
export function _setPrismaForTests(p: any) { prismaRef = p; }

export async function buildHotSequence(): Promise<number[]> {
  const rows = await prismaRef.$queryRaw<{ id: number }[]>`
    SELECT r.id
    FROM "Resource" r
    WHERE r.type = 'media_group'
      AND EXISTS (SELECT 1 FROM "ContentBinding" cb WHERE cb."resourceId" = r.id)
    ORDER BY COALESCE(r."viewCount", 0) DESC, r.id DESC
    LIMIT ${LIMIT};
  `;
  return rows.map((r: { id: number }) => r.id);
}
