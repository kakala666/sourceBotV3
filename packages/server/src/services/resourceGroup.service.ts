import prisma from './prisma';
import type { ResourceGroupCreateInput } from 'shared';

/** channelChatId 是 BigInt,JSON 序列化前转 string */
function serialize(g: any) {
  return {
    ...g,
    channelChatId: g.channelChatId != null ? g.channelChatId.toString() : null,
  };
}

export class ResourceGroupService {
  static async list() {
    const groups = await prisma.resourceGroup.findMany({
      orderBy: { sortOrder: 'asc' },
    });
    return groups.map(serialize);
  }

  static async create(data: ResourceGroupCreateInput) {
    const group = await prisma.resourceGroup.create({ data });
    return serialize(group);
  }

  static async update(id: number, data: { name?: string; sortOrder?: number }) {
    const group = await prisma.resourceGroup.update({ where: { id }, data });
    return serialize(group);
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
