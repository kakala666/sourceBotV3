import prisma from './prisma';
import {
  verifyChannelForBot,
  parseChannelUrl,
  verifyPrivateChannelForBot,
} from './telegram-channel';

export type ChannelKind = 'primary' | 'sponsor';

export class SubscriptionGateService {
  /** 拿配置;不存在则懒创建一个 default-off 记录返回 */
  static async getOrCreate(inviteLinkId: number) {
    let gate = await prisma.subscriptionGate.findUnique({
      where: { inviteLinkId },
      include: { channels: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!gate) {
      gate = await prisma.subscriptionGate.create({
        data: { inviteLinkId },
        include: { channels: true },
      });
    }
    return gate;
  }

  static async update(inviteLinkId: number, data: { isEnabled?: boolean; promptTemplate?: string | null }) {
    await this.getOrCreate(inviteLinkId);
    return prisma.subscriptionGate.update({
      where: { inviteLinkId },
      data,
      include: { channels: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  static async addChannel(
    inviteLinkId: number,
    inviteUrl: string,
    chatIdInput?: string,
    kind: ChannelKind = 'primary',
  ) {
    if (kind !== 'primary' && kind !== 'sponsor') {
      throw new Error('kind 必须是 primary 或 sponsor');
    }
    const link = await prisma.inviteLink.findUnique({
      where: { id: inviteLinkId },
      include: { bot: true },
    });
    if (!link) throw new Error('链接不存在');
    const bot = link.bot;

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

    const gate = await this.getOrCreate(inviteLinkId);

    // 同 kind 内的最大 sortOrder
    const maxSort = await prisma.subscriptionGateChannel.aggregate({
      where: { gateId: gate.id, kind },
      _max: { sortOrder: true },
    });

    // 事务:加 channel + (若 sponsor)同步追加 sponsorPositions
    return prisma.$transaction(async (tx) => {
      const channel = await tx.subscriptionGateChannel.create({
        data: {
          gateId: gate.id,
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
        await tx.subscriptionGate.update({
          where: { id: gate.id },
          data: { sponsorPositions: [...gate.sponsorPositions, nextPos] },
        });
      }

      return channel;
    });
  }

  static async removeChannel(inviteLinkId: number, channelId: number) {
    const channel = await prisma.subscriptionGateChannel.findUnique({
      where: { id: channelId },
      include: { gate: true },
    });
    if (!channel || channel.gate.inviteLinkId !== inviteLinkId) throw new Error('频道不存在');

    if (channel.kind !== 'sponsor') {
      await prisma.subscriptionGateChannel.delete({ where: { id: channelId } });
      return;
    }

    // sponsor: 找到该 channel 在 sponsor 列表中的 index(按 sortOrder),同步从 sponsorPositions 弹掉
    const sponsorChannels = await prisma.subscriptionGateChannel.findMany({
      where: { gateId: channel.gateId, kind: 'sponsor' },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });
    const idx = sponsorChannels.findIndex((c) => c.id === channelId);
    const positions = [...channel.gate.sponsorPositions];
    if (idx >= 0 && idx < positions.length) positions.splice(idx, 1);

    await prisma.$transaction([
      prisma.subscriptionGateChannel.delete({ where: { id: channelId } }),
      prisma.subscriptionGate.update({
        where: { id: channel.gateId },
        data: { sponsorPositions: positions },
      }),
    ]);
  }

  static async recheckChannel(inviteLinkId: number, channelId: number) {
    const channel = await prisma.subscriptionGateChannel.findUnique({
      where: { id: channelId },
      include: { gate: true },
    });
    if (!channel || channel.gate.inviteLinkId !== inviteLinkId) throw new Error('频道不存在');

    const link = await prisma.inviteLink.findUnique({
      where: { id: inviteLinkId },
      include: { bot: true },
    });
    if (!link) throw new Error('链接不存在');
    const bot = link.bot;

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

  /** 更新赞助商触发位置 */
  static async updateSponsorPositions(inviteLinkId: number, positions: number[]) {
    if (!Array.isArray(positions)) throw new Error('positions 必须是数组');
    // 校验:全正整数
    for (const p of positions) {
      if (!Number.isInteger(p) || p <= 0) {
        throw new Error('触发位置必须是正整数');
      }
    }
    // 严格递增
    for (let i = 1; i < positions.length; i++) {
      if (positions[i] <= positions[i - 1]) {
        throw new Error('触发位置必须严格递增');
      }
    }
    const gate = await this.getOrCreate(inviteLinkId);
    const sponsorCount = await prisma.subscriptionGateChannel.count({
      where: { gateId: gate.id, kind: 'sponsor' },
    });
    if (positions.length !== sponsorCount) {
      throw new Error(`触发位置数量必须等于赞助商数量(当前赞助商 ${sponsorCount} 个,位置 ${positions.length} 个)`);
    }
    return prisma.subscriptionGate.update({
      where: { id: gate.id },
      data: { sponsorPositions: positions },
      include: { channels: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  /** 重排 sponsor 频道(传 sponsor channel id 按目标顺序) */
  static async reorderSponsorChannels(inviteLinkId: number, orderedIds: number[]) {
    if (!Array.isArray(orderedIds)) throw new Error('orderedIds 必须是数组');
    const gate = await this.getOrCreate(inviteLinkId);
    const existing = await prisma.subscriptionGateChannel.findMany({
      where: { gateId: gate.id, kind: 'sponsor' },
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
