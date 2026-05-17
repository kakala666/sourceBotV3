import prisma from './prisma';
import {
  verifyChannelForBot,
  parseChannelUrl,
  verifyPrivateChannelForBot,
} from './telegram-channel';

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

  static async addChannel(inviteLinkId: number, inviteUrl: string, chatIdInput?: string) {
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

    const maxSort = await prisma.subscriptionGateChannel.aggregate({
      where: { gateId: gate.id },
      _max: { sortOrder: true },
    });

    return prisma.subscriptionGateChannel.create({
      data: {
        gateId: gate.id,
        isPrivate,
        username,
        chatId: BigInt(verified.chatId),
        title: verified.title,
        inviteUrl: storedInviteUrl,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
        status: 'ok',
      },
    });
  }

  static async removeChannel(inviteLinkId: number, channelId: number) {
    const channel = await prisma.subscriptionGateChannel.findUnique({
      where: { id: channelId },
      include: { gate: true },
    });
    if (!channel || channel.gate.inviteLinkId !== inviteLinkId) throw new Error('频道不存在');
    await prisma.subscriptionGateChannel.delete({ where: { id: channelId } });
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
}
