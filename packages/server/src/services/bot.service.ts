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

  static async verify(id: number) {
    const bot = await prisma.bot.findUnique({ where: { id } });
    if (!bot) return null;

    const res = await fetch(`https://api.telegram.org/bot${bot.token}/getMe`);
    const json = (await res.json()) as { ok: boolean; result?: { username?: string }; description?: string };

    if (json.ok && json.result?.username) {
      await prisma.bot.update({
        where: { id },
        data: { username: json.result.username },
      });
    }

    return json;
  }
}
