import prisma from '../prisma';

/**
 * 搜索资源:仅 Resource.caption 模糊匹配,池子规则同「随便看看」
 *   - type='media_group'
 *   - 至少被一个 ContentBinding 引用过(已绑定过 link)
 * 返回 resourceId 列表,最多 100,按 id desc(最新优先)。
 */

let prismaRef: any = prisma;
export function _setPrismaForTests(p: any) { prismaRef = p; }

/** 转义 LIKE 通配符,避免用户输入的 % / _ 被当作通配 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => '\\' + m);
}

export async function searchResources(keyword: string): Promise<number[]> {
  const trimmed = keyword.trim();
  if (!trimmed) return [];
  const pattern = `%${escapeLike(trimmed)}%`;
  const rows = await prismaRef.$queryRaw<{ id: number }[]>`
    SELECT r.id
    FROM "Resource" r
    WHERE r.type = 'media_group'
      AND EXISTS (SELECT 1 FROM "ContentBinding" cb WHERE cb."resourceId" = r.id)
      AND r.caption ILIKE ${pattern}
    ORDER BY r.id DESC
    LIMIT 100;
  `;
  return rows.map((r: { id: number }) => r.id);
}
