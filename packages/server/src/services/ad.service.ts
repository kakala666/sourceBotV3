import prisma from './prisma';
import { Prisma } from '@prisma/client';
import type { AdButton } from 'shared';

function toJsonValue(buttons: AdButton[] | null | undefined): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (buttons === null || buttons === undefined) return Prisma.JsonNull;
  return buttons as unknown as Prisma.InputJsonValue;
}

export class AdService {
  static async list(inviteLinkId: number) {
    return prisma.adBinding.findMany({
      where: { inviteLinkId },
      include: {
        resource: {
          include: { mediaFiles: { orderBy: { sortOrder: 'asc' } }, group: true },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  static async batchSet(
    inviteLinkId: number,
    items: { resourceId: number; sortOrder: number; buttons?: AdButton[] }[]
  ) {
    await prisma.$transaction([
      prisma.adBinding.deleteMany({ where: { inviteLinkId } }),
      ...items.map((item) =>
        prisma.adBinding.create({
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

  static async updateOne(id: number, data: { buttons?: AdButton[] | null }) {
    return prisma.adBinding.update({
      where: { id },
      data: { buttons: toJsonValue(data.buttons) },
      include: {
        resource: {
          include: { mediaFiles: { orderBy: { sortOrder: 'asc' } }, group: true },
        },
      },
    });
  }

  static async sort(inviteLinkId: number, items: { id: number; sortOrder: number }[]) {
    const ops = items.map((item) =>
      prisma.adBinding.update({
        where: { id: item.id },
        data: { sortOrder: item.sortOrder },
      })
    );
    await prisma.$transaction(ops);
    return this.list(inviteLinkId);
  }
}
