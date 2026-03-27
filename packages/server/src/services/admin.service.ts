import bcrypt from 'bcryptjs';
import prisma from './prisma';
import { BCRYPT_SALT_ROUNDS } from 'shared';
import type { AdminCreateInput, AdminUpdateInput } from 'shared';

const adminSelect = {
  id: true,
  name: true,
  username: true,
  telegramId: true,
  canManageAccounts: true,
  createdAt: true,
  updatedAt: true,
};

export class AdminService {
  static async list() {
    return prisma.admin.findMany({
      select: adminSelect,
      orderBy: { id: 'asc' },
    });
  }

  static async create(input: AdminCreateInput) {
    const hashedPassword = await bcrypt.hash(input.password, BCRYPT_SALT_ROUNDS);
    return prisma.admin.create({
      data: {
        name: input.name,
        username: input.username,
        password: hashedPassword,
        telegramId: input.telegramId || null,
        canManageAccounts: input.canManageAccounts ?? false,
      },
      select: adminSelect,
    });
  }

  static async update(id: number, input: AdminUpdateInput) {
    const data: any = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.username !== undefined) data.username = input.username;
    if (input.telegramId !== undefined) data.telegramId = input.telegramId || null;
    if (input.canManageAccounts !== undefined) data.canManageAccounts = input.canManageAccounts;
    if (input.password) {
      data.password = await bcrypt.hash(input.password, BCRYPT_SALT_ROUNDS);
    }

    return prisma.admin.update({
      where: { id },
      data,
      select: adminSelect,
    });
  }

  static async delete(id: number) {
    await prisma.admin.delete({ where: { id } });
  }
}
