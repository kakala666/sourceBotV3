import prisma from './prisma';
import { verifyChannelForBot, parseChannelUrl } from './telegram-channel';

export class SubscriptionGateService {
  /** 拿配置;不存在则懒创建一个 default-off 记录返回 */
  static async getOrCreate(botId: number) {
    let gate = await prisma.subscriptionGate.findUnique({
      where: { botId },
      include: { channels: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!gate) {
      gate = await prisma.subscriptionGate.create({
        data: { botId },
        include: { channels: true },
      });
    }
    return gate;
  }

  static async update(botId: number, data: { isEnabled?: boolean; promptTemplate?: string | null }) {
    await this.getOrCreate(botId);
    return prisma.subscriptionGate.update({
      where: { botId },
      data,
      include: { channels: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  static async addChannel(botId: number, inviteUrl: string) {
    const bot = await prisma.bot.findUnique({ where: { id: botId } });
    if (!bot) throw new Error('Bot 不存在');

    const { username } = parseChannelUrl(inviteUrl);
    const verified = await verifyChannelForBot(bot.token, username);

    const gate = await this.getOrCreate(botId);

    const maxSort = await prisma.subscriptionGateChannel.aggregate({
      where: { gateId: gate.id },
      _max: { sortOrder: true },
    });

    return prisma.subscriptionGateChannel.create({
      data: {
        gateId: gate.id,
        username: verified.username,
        chatId: BigInt(verified.chatId),
        title: verified.title,
        inviteUrl: `https://t.me/${verified.username}`,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
        status: 'ok',
      },
    });
  }

  static async removeChannel(botId: number, channelId: number) {
    const channel = await prisma.subscriptionGateChannel.findUnique({
      where: { id: channelId },
      include: { gate: true },
    });
    if (!channel || channel.gate.botId !== botId) throw new Error('频道不存在');
    await prisma.subscriptionGateChannel.delete({ where: { id: channelId } });
  }

  static async recheckChannel(botId: number, channelId: number) {
    const channel = await prisma.subscriptionGateChannel.findUnique({
      where: { id: channelId },
      include: { gate: true },
    });
    if (!channel || channel.gate.botId !== botId) throw new Error('频道不存在');

    const bot = await prisma.bot.findUnique({ where: { id: botId } });
    if (!bot) throw new Error('Bot 不存在');

    try {
      const verified = await verifyChannelForBot(bot.token, channel.username);
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
