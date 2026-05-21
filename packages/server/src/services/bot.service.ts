import prisma from './prisma';
import type { BotCreateInput, BotUpdateInput } from 'shared';

export class BotService {
  static async list() {
    return prisma.bot.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  static async create(data: BotCreateInput) {
    return prisma.bot.create({ data });
  }

  static async update(id: number, data: BotUpdateInput) {
    return prisma.bot.update({ where: { id }, data });
  }

  static async delete(id: number) {
    return prisma.bot.delete({ where: { id } });
  }

  /**
   * 克隆一个 bot 的全部配置(链接、内容/广告绑定、链接级订阅、bot 全局订阅)。
   * 不复制用户数据(BotUser/UserSession/FavoriteResource/BotFileId)。
   * 整个流程在事务内,失败回滚。
   */
  static async cloneBot(token: string, name: string, sourceBotId: number) {
    const source = await prisma.bot.findUnique({ where: { id: sourceBotId } });
    if (!source) throw new Error('源机器人不存在');

    return prisma.$transaction(async (tx) => {
      // 1. 新 bot
      const newBot = await tx.bot.create({
        data: { token, name, isActive: true },
      });

      // 2. 链接
      const oldLinks = await tx.inviteLink.findMany({ where: { botId: sourceBotId } });
      const linkIdMap = new Map<number, number>();
      for (const old of oldLinks) {
        const created = await tx.inviteLink.create({
          data: { botId: newBot.id, code: old.code, name: old.name },
        });
        linkIdMap.set(old.id, created.id);
      }
      const oldLinkIds = [...linkIdMap.keys()];

      // 3. ContentBinding
      const oldCB = await tx.contentBinding.findMany({ where: { inviteLinkId: { in: oldLinkIds } } });
      for (const old of oldCB) {
        await tx.contentBinding.create({
          data: {
            inviteLinkId: linkIdMap.get(old.inviteLinkId)!,
            resourceId: old.resourceId,
            sortOrder: old.sortOrder,
            buttons: old.buttons as any,
          },
        });
      }

      // 4. AdBinding
      const oldAB = await tx.adBinding.findMany({ where: { inviteLinkId: { in: oldLinkIds } } });
      for (const old of oldAB) {
        await tx.adBinding.create({
          data: {
            inviteLinkId: linkIdMap.get(old.inviteLinkId)!,
            resourceId: old.resourceId,
            sortOrder: old.sortOrder,
            buttons: old.buttons as any,
          },
        });
      }

      // 5. link 级 SubscriptionGate + channels
      const oldLinkGates = await tx.subscriptionGate.findMany({
        where: { inviteLinkId: { in: oldLinkIds } },
        include: { channels: true },
      });
      for (const og of oldLinkGates) {
        const ng = await tx.subscriptionGate.create({
          data: {
            inviteLinkId: linkIdMap.get(og.inviteLinkId)!,
            isEnabled: og.isEnabled,
            promptTemplate: og.promptTemplate,
            sponsorPositions: og.sponsorPositions,
          },
        });
        for (const c of og.channels) {
          await tx.subscriptionGateChannel.create({
            data: {
              gateId: ng.id, botGateId: null,
              kind: c.kind, isPrivate: c.isPrivate, username: c.username,
              chatId: c.chatId, title: c.title, inviteUrl: c.inviteUrl,
              sortOrder: c.sortOrder, status: c.status,
            },
          });
        }
      }

      // 6. bot 全局 SubscriptionGate + channels
      const oldBG = await tx.botSubscriptionGate.findUnique({
        where: { botId: sourceBotId },
        include: { channels: true },
      });
      if (oldBG) {
        const nbg = await tx.botSubscriptionGate.create({
          data: {
            botId: newBot.id,
            isEnabled: oldBG.isEnabled,
            promptTemplate: oldBG.promptTemplate,
            sponsorPositions: oldBG.sponsorPositions,
          },
        });
        for (const c of oldBG.channels) {
          await tx.subscriptionGateChannel.create({
            data: {
              gateId: null, botGateId: nbg.id,
              kind: c.kind, isPrivate: c.isPrivate, username: c.username,
              chatId: c.chatId, title: c.title, inviteUrl: c.inviteUrl,
              sortOrder: c.sortOrder, status: c.status,
            },
          });
        }
      }

      return {
        newBot,
        copied: {
          links: oldLinks.length,
          contentBindings: oldCB.length,
          adBindings: oldAB.length,
          linkGates: oldLinkGates.length,
          botGate: oldBG ? 1 : 0,
        },
      };
    }, { timeout: 60_000, maxWait: 10_000 });
  }

  static async verify(id: number) {
    const bot = await prisma.bot.findUnique({ where: { id } });
    if (!bot) return null;

    const root = process.env.TELEGRAM_API_ROOT || 'https://api.telegram.org';
    const res = await fetch(`${root}/bot${bot.token}/getMe`);
    const json = (await res.json()) as { ok: boolean; result?: { username?: string }; description?: string };

    if (json.ok && json.result?.username) {
      await prisma.bot.update({
        where: { id },
        data: { username: json.result.username },
      });
    }

    return json;
  }

  /** 获取 bot 的全局按钮(每条常规资源都会附加) */
  static async getGlobalButtons(id: number): Promise<{ text: string; url: string }[]> {
    const bot = await prisma.bot.findUnique({ where: { id }, select: { globalButtons: true } });
    if (!bot) throw new Error('机器人不存在');
    const arr = (bot.globalButtons ?? []) as any;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((b) => b && typeof b.text === 'string' && typeof b.url === 'string')
      .map((b) => ({ text: String(b.text).trim(), url: String(b.url).trim() }))
      .filter((b) => b.text && b.url);
  }

  /** 覆盖式更新全局按钮;空数组等于清空 */
  static async setGlobalButtons(id: number, buttons: { text: string; url: string }[]) {
    if (!Array.isArray(buttons)) throw new Error('buttons 必须是数组');
    const sanitized = buttons
      .map((b) => ({ text: String(b?.text ?? '').trim(), url: String(b?.url ?? '').trim() }))
      .filter((b) => b.text && b.url);
    if (sanitized.length > 20) throw new Error('全局按钮不能超过 20 个');
    await prisma.bot.update({ where: { id }, data: { globalButtons: sanitized as any } });
    return sanitized;
  }
}
