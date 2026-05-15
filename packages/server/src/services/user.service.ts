import prisma from './prisma';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from 'shared';
import type { PaginatedResponse, BotUserInfo, BotUserLookupResult } from 'shared';

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

  static async lookupByTelegramId(telegramId: bigint, botId?: number): Promise<BotUserLookupResult[]> {
    const where: any = { telegramId };
    if (botId !== undefined) where.botId = botId;

    const users = await prisma.botUser.findMany({
      where,
      include: {
        bot: { select: { id: true, name: true } },
        inviteLink: { select: { id: true, name: true, code: true } },
      },
      orderBy: { firstSeenAt: 'desc' },
    });

    return users.map((u) => ({
      id: u.id,
      telegramId: u.telegramId.toString(),
      firstName: u.firstName,
      lastName: u.lastName,
      username: u.username,
      firstSeenAt: u.firstSeenAt.toISOString(),
      lastSeenAt: u.lastSeenAt.toISOString(),
      bot: u.bot,
      inviteLink: u.inviteLink,
    }));
  }
}
