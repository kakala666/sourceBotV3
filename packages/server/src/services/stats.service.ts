import prisma from './prisma';
import type { StatsOverview, DailyStat, LinkStat } from 'shared';

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
}