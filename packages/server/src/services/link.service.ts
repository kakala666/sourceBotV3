import prisma from './prisma';
import type { InviteLinkCreateInput, InviteLinkUpdateInput } from 'shared';

export class LinkService {
  static async list(botId: number) {
    return prisma.inviteLink.findMany({
      where: { botId },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async create(botId: number, data: InviteLinkCreateInput) {
    return prisma.inviteLink.create({
      data: { botId, ...data },
    });
  }

  static async update(id: number, botId: number, data: InviteLinkUpdateInput) {
    return prisma.inviteLink.update({
      where: { id, botId },
      data,
    });
  }

  static async delete(id: number, botId: number) {
    return prisma.inviteLink.delete({
      where: { id, botId },
    });
  }
}
