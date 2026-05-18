import prisma from '../prisma';

export interface RandomResource {
  id: number;
  type: string;
  caption: string | null;
  mediaFiles: any[];
}

let prismaRef: any = prisma;
export function _setPrismaForTests(p: any) { prismaRef = p; }

/**
 * 从「至少被一个 ContentBinding 引用过」的 Resource 中随机抽 1 条,
 * 包含按 sortOrder 排好的 mediaFiles。
 * 资源池为空时返回 null。
 */
export async function pickRandomContentResource(): Promise<RandomResource | null> {
  const rows = await prismaRef.$queryRaw<{ id: number }[]>`
    SELECT r.id
    FROM "Resource" r
    WHERE EXISTS (SELECT 1 FROM "ContentBinding" cb WHERE cb."resourceId" = r.id)
    ORDER BY random()
    LIMIT 1;
  `;
  if (rows.length === 0) return null;
  const r = await prismaRef.resource.findUnique({
    where: { id: rows[0].id },
    include: { mediaFiles: { orderBy: { sortOrder: 'asc' } } },
  });
  return r;
}
