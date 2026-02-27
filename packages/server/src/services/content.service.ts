import prisma from './prisma';

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

  static async batchSet(inviteLinkId: number, items: { resourceId: number; sortOrder: number }[]) {
    await prisma.$transaction([
      prisma.contentBinding.deleteMany({ where: { inviteLinkId } }),
      ...items.map((item) =>
        prisma.contentBinding.create({
          data: {
            inviteLinkId,
            resourceId: item.resourceId,
            sortOrder: item.sortOrder,
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
