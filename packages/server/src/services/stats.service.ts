import prisma from './prisma';
import type {
  StatsOverview, DailyStat, LinkStat,
  ButtonClickStat, SecondaryOpRateStat, LatencySummary, LatencyItem,
} from 'shared';

function parseRange(startDate?: string, endDate?: string): { start: Date; end: Date } {
  const start = startDate ? new Date(startDate) : new Date(0);
  start.setHours(0, 0, 0, 0);
  const end = endDate ? new Date(endDate) : new Date();
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export class StatsService {
  static async overview(): Promise<StatsOverview> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [todayNewUsers, totalUsers, todayAdImpressions] = await Promise.all([
      prisma.botUser.count({ where: { firstSeenAt: { gte: todayStart } } }),
      prisma.botUser.count(),
      prisma.adImpression.count({ where: { viewedAt: { gte: todayStart } } }),
    ]);

    return { todayNewUsers, totalUsers, todayAdImpressions };
  }

  static async daily(startDate: string, endDate: string): Promise<DailyStat[]> {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    // 生成日期范围
    const dates: Date[] = [];
    const cur = new Date(start);
    while (cur <= end) {
      dates.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }

    const results: DailyStat[] = [];
    for (const date of dates) {
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);

      const [newUsers, adImpressions] = await Promise.all([
        prisma.botUser.count({
          where: { firstSeenAt: { gte: dayStart, lte: dayEnd } },
        }),
        prisma.adImpression.count({
          where: { viewedAt: { gte: dayStart, lte: dayEnd } },
        }),
      ]);

      results.push({
        date: dayStart.toISOString().split('T')[0],
        newUsers,
        adImpressions,
      });
    }

    return results;
  }

  static async byLink(params: {
    botId?: number;
    startDate?: string;
    endDate?: string;
  }): Promise<LinkStat[]> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const linkWhere: any = {};
    if (params.botId) linkWhere.botId = params.botId;

    const links = await prisma.inviteLink.findMany({
      where: linkWhere,
      include: { bot: { select: { name: true } } },
    });

    const results: LinkStat[] = [];

    for (const link of links) {
      const userWhere: any = { inviteLinkId: link.id };
      const adWhere: any = { inviteLinkId: link.id };

      if (params.startDate) {
        const start = new Date(params.startDate);
        start.setHours(0, 0, 0, 0);
        userWhere.firstSeenAt = { ...userWhere.firstSeenAt, gte: start };
        adWhere.viewedAt = { ...adWhere.viewedAt, gte: start };
      }
      if (params.endDate) {
        const end = new Date(params.endDate);
        end.setHours(23, 59, 59, 999);
        userWhere.firstSeenAt = { ...userWhere.firstSeenAt, lte: end };
        adWhere.viewedAt = { ...adWhere.viewedAt, lte: end };
      }

      const [totalUsers, todayUsers, totalAdImpressions] = await Promise.all([
        prisma.botUser.count({ where: { inviteLinkId: link.id } }),
        prisma.botUser.count({
          where: { inviteLinkId: link.id, firstSeenAt: { gte: todayStart } },
        }),
        prisma.adImpression.count({ where: adWhere }),
      ]);

      results.push({
        linkId: link.id,
        linkName: link.name,
        linkCode: link.code,
        botName: link.bot.name,
        totalUsers,
        todayUsers,
        totalAdImpressions,
      });
    }

    return results;
  }

  /**
   * 按钮点击统计:按 buttonType 聚合
   * uniqueClickers = count distinct (botUserId, inviteLinkId)
   */
  static async buttonClicks(params: {
    startDate?: string;
    endDate?: string;
    botId?: number;
    inviteLinkId?: number;
  }): Promise<ButtonClickStat[]> {
    const { start, end } = parseRange(params.startDate, params.endDate);
    const rows = await prisma.$queryRaw<
      { buttonType: string; totalClicks: bigint; uniqueClickers: bigint }[]
    >`
      SELECT
        "buttonType",
        COUNT(*)::bigint AS "totalClicks",
        COUNT(DISTINCT ("botUserId"::text || ':' || "inviteLinkId"::text))::bigint AS "uniqueClickers"
      FROM "ButtonClick"
      WHERE "clickedAt" BETWEEN ${start} AND ${end}
        AND (${params.botId ?? null}::int IS NULL OR "botId" = ${params.botId ?? null}::int)
        AND (${params.inviteLinkId ?? null}::int IS NULL OR "inviteLinkId" = ${params.inviteLinkId ?? null}::int)
      GROUP BY "buttonType"
      ORDER BY "buttonType";
    `;
    return rows.map((r) => ({
      buttonType: r.buttonType as 'next' | 'reveal',
      totalClicks: Number(r.totalClicks),
      uniqueClickers: Number(r.uniqueClickers),
    }));
  }

  /**
   * 二次操作率:按链接计算
   * 分母 = 范围内新增用户(newUsers,无论是否操作)
   * 分子 = 范围内点过 next/reveal 的去重用户(activeUsers,可能包含老用户)
   * rate = activeUsers / newUsers (可能 >1)
   */
  static async secondaryOpRate(params: {
    startDate?: string;
    endDate?: string;
    botId?: number;
  }): Promise<SecondaryOpRateStat[]> {
    const { start, end } = parseRange(params.startDate, params.endDate);
    const rows = await prisma.$queryRaw<
      { linkId: number; linkName: string; linkCode: string; botName: string;
        newUsers: bigint; activeUsers: bigint }[]
    >`
      WITH new_users AS (
        SELECT id, "inviteLinkId"
        FROM "BotUser"
        WHERE "firstSeenAt" BETWEEN ${start} AND ${end}
          AND (${params.botId ?? null}::int IS NULL OR "botId" = ${params.botId ?? null}::int)
      ),
      active_users AS (
        SELECT DISTINCT bc."botUserId", bc."inviteLinkId"
        FROM "ButtonClick" bc
        WHERE bc."clickedAt" BETWEEN ${start} AND ${end}
          AND bc."buttonType" IN ('next', 'reveal')
          AND (${params.botId ?? null}::int IS NULL OR bc."botId" = ${params.botId ?? null}::int)
      )
      SELECT
        l.id AS "linkId",
        l.name AS "linkName",
        l.code AS "linkCode",
        b.name AS "botName",
        COUNT(DISTINCT nu.id)::bigint AS "newUsers",
        COUNT(DISTINCT au."botUserId")::bigint AS "activeUsers"
      FROM "InviteLink" l
      JOIN "Bot" b ON b.id = l."botId"
      LEFT JOIN new_users nu ON nu."inviteLinkId" = l.id
      LEFT JOIN active_users au ON au."inviteLinkId" = l.id
      WHERE (${params.botId ?? null}::int IS NULL OR l."botId" = ${params.botId ?? null}::int)
      GROUP BY l.id, l.name, l.code, b.name
      HAVING (COUNT(DISTINCT nu.id) > 0 OR COUNT(DISTINCT au."botUserId") > 0)
      ORDER BY "activeUsers" DESC;
    `;
    return rows.map((r) => {
      const newUsers = Number(r.newUsers);
      const activeUsers = Number(r.activeUsers);
      return {
        linkId: r.linkId,
        linkName: r.linkName,
        linkCode: r.linkCode,
        botName: r.botName,
        newUsers,
        activeUsers,
        rate: newUsers > 0 ? activeUsers / newUsers : 0,
      };
    });
  }

  /**
   * 延迟统计:汇总 p50/p95/p99/max + 分页明细列表
   */
  static async latency(params: {
    startDate?: string;
    endDate?: string;
    botId?: number;
    inviteLinkId?: number;
    buttonType?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ summary: LatencySummary; items: LatencyItem[]; total: number }> {
    const { start, end } = parseRange(params.startDate, params.endDate);
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize || 50));
    const offset = (page - 1) * pageSize;
    const buttonType = params.buttonType ?? null;

    const summaryRows = await prisma.$queryRaw<
      { count: bigint; p50: number | null; p95: number | null; p99: number | null;
        max: number | null; avg: number | null }[]
    >`
      SELECT
        COUNT(*)::bigint AS "count",
        percentile_cont(0.50) WITHIN GROUP (ORDER BY "latencyMs") AS "p50",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs") AS "p95",
        percentile_cont(0.99) WITHIN GROUP (ORDER BY "latencyMs") AS "p99",
        MAX("latencyMs") AS "max",
        AVG("latencyMs") AS "avg"
      FROM "ButtonClick"
      WHERE "clickedAt" BETWEEN ${start} AND ${end}
        AND (${params.botId ?? null}::int IS NULL OR "botId" = ${params.botId ?? null}::int)
        AND (${params.inviteLinkId ?? null}::int IS NULL OR "inviteLinkId" = ${params.inviteLinkId ?? null}::int)
        AND (${buttonType}::text IS NULL OR "buttonType" = ${buttonType}::text);
    `;
    const s = summaryRows[0];
    const total = Number(s?.count ?? 0);
    const summary: LatencySummary = {
      count: total,
      p50: Math.round(s?.p50 ?? 0),
      p95: Math.round(s?.p95 ?? 0),
      p99: Math.round(s?.p99 ?? 0),
      max: Math.round(s?.max ?? 0),
      avg: Math.round(s?.avg ?? 0),
    };

    const items = await prisma.$queryRaw<
      { id: number; botName: string; linkName: string; linkCode: string;
        buttonType: string; latencyMs: number; clickedAt: Date }[]
    >`
      SELECT bc.id, b.name AS "botName", l.name AS "linkName", l.code AS "linkCode",
             bc."buttonType", bc."latencyMs", bc."clickedAt"
      FROM "ButtonClick" bc
      JOIN "InviteLink" l ON l.id = bc."inviteLinkId"
      JOIN "Bot" b ON b.id = bc."botId"
      WHERE bc."clickedAt" BETWEEN ${start} AND ${end}
        AND (${params.botId ?? null}::int IS NULL OR bc."botId" = ${params.botId ?? null}::int)
        AND (${params.inviteLinkId ?? null}::int IS NULL OR bc."inviteLinkId" = ${params.inviteLinkId ?? null}::int)
        AND (${buttonType}::text IS NULL OR bc."buttonType" = ${buttonType}::text)
      ORDER BY bc."clickedAt" DESC
      LIMIT ${pageSize} OFFSET ${offset};
    `;

    return {
      summary,
      total,
      items: items.map((it) => ({
        id: it.id,
        botName: it.botName,
        linkName: it.linkName,
        linkCode: it.linkCode,
        buttonType: it.buttonType as 'next' | 'reveal',
        latencyMs: it.latencyMs,
        clickedAt: it.clickedAt.toISOString(),
      })),
    };
  }
}