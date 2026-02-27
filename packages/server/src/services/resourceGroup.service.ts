import prisma from './prisma';
import type { ResourceGroupCreateInput } from 'shared';

export class ResourceGroupService {
  static async list() {
    return prisma.resourceGroup.findMany({
      orderBy: { sortOrder: 'asc' },
    });
  }

  static async create(data: ResourceGroupCreateInput) {
    return prisma.resourceGroup.create({ data });
  }

  static async update(id: number, data: { name?: string; sortOrder?: number }) {
    return prisma.resourceGroup.update({ where: { id }, data });
  }

  static async delete(id: number) {
    return prisma.resourceGroup.delete({ where: { id } });
  }

  static async sort(items: { id: number; sortOrder: number }[]) {
    const ops = items.map((item) =>
      prisma.resourceGroup.update({
        where: { id: item.id },
        data: { sortOrder: item.sortOrder },
      })
    );
    await prisma.$transaction(ops);
  }
}
