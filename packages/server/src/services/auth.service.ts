import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from './prisma';
import { JWT_EXPIRES_IN, BCRYPT_SALT_ROUNDS } from 'shared';

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
      admin: { id: admin.id, username: admin.username },
    };
  }

  static async getMe(adminId: number) {
    const admin = await prisma.admin.findUnique({
      where: { id: adminId },
      select: { id: true, username: true },
    });
    return admin;
  }
}
