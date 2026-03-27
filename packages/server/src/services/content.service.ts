import prisma from './prisma';
import type { Prisma } from '@prisma/client';
import type { AdButton } from 'shared';

function toJsonValue(buttons?: AdButton[] | null): Prisma.InputJsonValue | undefined {
  if (!buttons || buttons.length === 0) return undefined;
  return buttons as unknown as Prisma.InputJsonValue;
}

export class ContentService {
  static async list(inviteLinkId: number) {
    return prisma.contentBinding.findMany({
      where: { inviteLinkId },
      include: {
        resource: {
          include: { mediaFiles: { orderBy: { sortOrder: 'asc' } }, group: true },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  static async batchSet(inviteLinkId: number, items: { resourceId: number; sortOrder: number; buttons?: AdButton[] }[]) {
    await prisma.$transaction([
      prisma.contentBinding.deleteMany({ where: { inviteLinkId } }),
      ...items.map((item) =>
        prisma.contentBinding.create({
          data: {
            inviteLinkId,
            resourceId: item.resourceId,
            sortOrder: item.sortOrder,
            buttons: toJsonValue(item.buttons),
          },
        })
      ),
    ]);
    return this.list(inviteLinkId);
  }

  static async sort(inviteLinkId: number, items: { id: number; sortOrder: number }[]) {
    const ops = items.map((item) =>
      prisma.contentBinding.update({
        where: { id: item.id },
        data: { sortOrder: item.sortOrder },
      })
    );
    await prisma.$transaction(ops);
    return this.list(inviteLinkId);
  }
}
