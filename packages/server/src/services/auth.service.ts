import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from './prisma';
import { JWT_EXPIRES_IN } from 'shared';

export class AuthService {
  static async login(username: string, password: string) {
    const admin = await prisma.admin.findUnique({ where: { username } });
    if (!admin) return null;

    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) return null;

    const secret = process.env.JWT_SECRET || 'default-secret';
    const token = jwt.sign(
      { id: admin.id, username: admin.username },
      secret,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return {
      token,
      admin: {
        id: admin.id,
        name: admin.name,
        username: admin.username,
        telegramId: admin.telegramId,
        canManageAccounts: admin.canManageAccounts,
      },
    };
  }

  static async getMe(adminId: number) {
    return prisma.admin.findUnique({
      where: { id: adminId },
      select: {
        id: true,
        name: true,
        username: true,
        telegramId: true,
        canManageAccounts: true,
      },
    });
  }
}
