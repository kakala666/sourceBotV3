import prisma from './prisma';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from 'shared';
import type { PaginatedResponse, BotUserInfo, BotUserLookupResult, BotUserActionItem, ButtonType } from 'shared';

export class UserService {
  static async list(params: {
    page?: number;
    pageSize?: number;
    search?: string;
    botId?: number;
    linkId?: number;
  }): Promise<PaginatedResponse<BotUserInfo>> {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize || DEFAULT_PAGE_SIZE));
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (params.botId) where.botId = params.botId;
    if (params.linkId) where.inviteLinkId = params.linkId;
    if (params.search) {
      where.OR = [
        { firstName: { contains: params.search, mode: 'insensitive' } },
        { lastName: { contains: params.search, mode: 'insensitive' } },
        { username: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.botUser.findMany({
        where,
        orderBy: { firstSeenAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.botUser.count({ where }),
    ]);

    // BigInt -> string 转换
    const mapped = items.map((u) => ({
      ...u,
      telegramId: u.telegramId.toString(),
    })) as unknown as BotUserInfo[];

    return {
      items: mapped,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /** 用户最近的翻页/展开操作(分页) */
  static async listActions(
    botUserId: number,
    params: { page?: number; pageSize?: number },
  ): Promise<PaginatedResponse<BotUserActionItem>> {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize || DEFAULT_PAGE_SIZE));
    const skip = (page - 1) * pageSize;

    const where = { botUserId, buttonType: { in: ['next', 'reveal'] } };

    const [rows, total] = await Promise.all([
      prisma.buttonClick.findMany({
        where,
        orderBy: { clickedAt: 'desc' },
        skip,
        take: pageSize,
        select: { id: true, buttonType: true, inviteLinkId: true, clickedAt: true },
      }),
      prisma.buttonClick.count({ where }),
    ]);

    const linkIds = [...new Set(rows.map((r) => r.inviteLinkId))];
    const links = linkIds.length
      ? await prisma.inviteLink.findMany({
          where: { id: { in: linkIds } },
          select: { id: true, name: true },
        })
      : [];
    const linkMap = new Map(links.map((l) => [l.id, l.name]));

    const items: BotUserActionItem[] = rows.map((r) => ({
      id: r.id,
      buttonType: r.buttonType as ButtonType,
      linkName: linkMap.get(r.inviteLinkId) || `链接#${r.inviteLinkId}`,
      clickedAt: r.clickedAt.toISOString(),
    }));

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  static async lookupByTelegramId(telegramId: bigint, botId?: number): Promise<BotUserLookupResult | null> {
    const where: any = { telegramId };
    if (botId !== undefined) where.botId = botId;

    const u = await prisma.botUser.findFirst({
      where,
      include: {
        bot: { select: { id: true, name: true } },
        inviteLink: { select: { id: true, name: true, code: true } },
      },
      orderBy: { firstSeenAt: 'desc' },
    });

    if (!u) return null;

    return {
      id: u.id,
      telegramId: u.telegramId.toString(),
      firstName: u.firstName,
      lastName: u.lastName,
      username: u.username,
      firstSeenAt: u.firstSeenAt.toISOString(),
      lastSeenAt: u.lastSeenAt.toISOString(),
      bot: u.bot,
      inviteLink: u.inviteLink,
    };
  }
}
