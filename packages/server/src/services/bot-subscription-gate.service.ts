import prisma from './prisma';
import {
  verifyChannelForBot,
  parseChannelUrl,
  verifyPrivateChannelForBot,
} from './telegram-channel';

export type ChannelKind = 'primary' | 'sponsor';

export class BotSubscriptionGateService {
  /** 拿配置;不存在则懒创建一个 default-off 记录返回 */
  static async getOrCreate(botId: number) {
    let gate = await prisma.botSubscriptionGate.findUnique({
      where: { botId },
      include: { channels: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!gate) {
      gate = await prisma.botSubscriptionGate.create({
        data: { botId },
        include: { channels: true },
      });
    }
    return gate;
  }

  static async update(botId: number, data: { isEnabled?: boolean; promptTemplate?: string | null }) {
    await this.getOrCreate(botId);
    return prisma.botSubscriptionGate.update({
      where: { botId },
      data,
      include: { channels: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  static async addChannel(
    botId: number,
    inviteUrl: string,
    chatIdInput?: string,
    kind: ChannelKind = 'primary',
  ) {
    if (kind !== 'primary' && kind !== 'sponsor') {
      throw new Error('kind 必须是 primary 或 sponsor');
    }
    const bot = await prisma.bot.findUnique({ where: { id: botId } });
    if (!bot) throw new Error('机器人不存在');

    const isPrivate = !!chatIdInput;
    let verified;
    let username: string | null;
    let storedInviteUrl: string;

    if (isPrivate) {
      verified = await verifyPrivateChannelForBot(bot.token, chatIdInput!);
      username = verified.username || null;
      if (!inviteUrl?.trim()) throw new Error('请提供私有频道的邀请链接');
      storedInviteUrl = inviteUrl.trim();
    } else {
      const parsed = parseChannelUrl(inviteUrl);
      verified = await verifyChannelForBot(bot.token, parsed.username);
      username = verified.username;
      storedInviteUrl = `https://t.me/${verified.username}`;
    }

    const gate = await this.getOrCreate(botId);

    const maxSort = await prisma.subscriptionGateChannel.aggregate({
      where: { botGateId: gate.id, kind },
      _max: { sortOrder: true },
    });

    return prisma.$transaction(async (tx) => {
      const channel = await tx.subscriptionGateChannel.create({
        data: {
          gateId: null,
          botGateId: gate.id,
          kind,
          isPrivate,
          username,
          chatId: BigInt(verified.chatId),
          title: verified.title,
          inviteUrl: storedInviteUrl,
          sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
          status: 'ok',
        },
      });

      if (kind === 'sponsor') {
        const last = gate.sponsorPositions[gate.sponsorPositions.length - 1] ?? 0;
        const nextPos = last > 0 ? last + 3 : 3;
        await tx.botSubscriptionGate.update({
          where: { id: gate.id },
          data: { sponsorPositions: [...gate.sponsorPositions, nextPos] },
        });
      }

      return channel;
    });
  }

  static async removeChannel(botId: number, channelId: number) {
    const channel = await prisma.subscriptionGateChannel.findUnique({
      where: { id: channelId },
      include: { botGate: true },
    });
    if (!channel || !channel.botGate || channel.botGate.botId !== botId) {
      throw new Error('频道不存在');
    }

    if (channel.kind !== 'sponsor') {
      await prisma.subscriptionGateChannel.delete({ where: { id: channelId } });
      return;
    }

    const sponsorChannels = await prisma.subscriptionGateChannel.findMany({
      where: { botGateId: channel.botGateId!, kind: 'sponsor' },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });
    const idx = sponsorChannels.findIndex((c) => c.id === channelId);
    const positions = [...channel.botGate.sponsorPositions];
    if (idx >= 0 && idx < positions.length) positions.splice(idx, 1);

    await prisma.$transaction([
      prisma.subscriptionGateChannel.delete({ where: { id: channelId } }),
      prisma.botSubscriptionGate.update({
        where: { id: channel.botGateId! },
        data: { sponsorPositions: positions },
      }),
    ]);
  }

  static async recheckChannel(botId: number, channelId: number) {
    const channel = await prisma.subscriptionGateChannel.findUnique({
      where: { id: channelId },
      include: { botGate: true },
    });
    if (!channel || !channel.botGate || channel.botGate.botId !== botId) {
      throw new Error('频道不存在');
    }

    const bot = await prisma.bot.findUnique({ where: { id: botId } });
    if (!bot) throw new Error('机器人不存在');

    try {
      const verified = channel.isPrivate
        ? await verifyPrivateChannelForBot(bot.token, channel.chatId.toString())
        : await verifyChannelForBot(bot.token, channel.username ?? '');
      return prisma.subscriptionGateChannel.update({
        where: { id: channelId },
        data: {
          chatId: BigInt(verified.chatId),
          title: verified.title,
          status: 'ok',
          lastCheckAt: new Date(),
        },
      });
    } catch (err: any) {
      const msg: string = err.message || '';
      const status = msg.includes('管理员') ? 'bot_not_admin' : 'channel_gone';
      return prisma.subscriptionGateChannel.update({
        where: { id: channelId },
        data: { status, lastCheckAt: new Date() },
      });
    }
  }

  static async updateSponsorPositions(botId: number, positions: number[]) {
    if (!Array.isArray(positions)) throw new Error('positions 必须是数组');
    for (const p of positions) {
      if (!Number.isInteger(p) || p <= 0) {
        throw new Error('触发位置必须是正整数');
      }
    }
    for (let i = 1; i < positions.length; i++) {
      if (positions[i] <= positions[i - 1]) {
        throw new Error('触发位置必须严格递增');
      }
    }
    const gate = await this.getOrCreate(botId);
    const sponsorCount = await prisma.subscriptionGateChannel.count({
      where: { botGateId: gate.id, kind: 'sponsor' },
    });
    if (positions.length !== sponsorCount) {
      throw new Error(`触发位置数量必须等于赞助商数量(当前赞助商 ${sponsorCount} 个,位置 ${positions.length} 个)`);
    }
    return prisma.botSubscriptionGate.update({
      where: { id: gate.id },
      data: { sponsorPositions: positions },
      include: { channels: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  static async reorderSponsorChannels(botId: number, orderedIds: number[]) {
    if (!Array.isArray(orderedIds)) throw new Error('orderedIds 必须是数组');
    const gate = await this.getOrCreate(botId);
    const existing = await prisma.subscriptionGateChannel.findMany({
      where: { botGateId: gate.id, kind: 'sponsor' },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((c) => c.id));
    if (orderedIds.length !== existingIds.size || !orderedIds.every((id) => existingIds.has(id))) {
      throw new Error('orderedIds 与当前赞助商列表不匹配');
    }
    await prisma.$transaction(
      orderedIds.map((id, idx) =>
        prisma.subscriptionGateChannel.update({
          where: { id },
          data: { sortOrder: idx },
        }),
      ),
    );
  }
}
