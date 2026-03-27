import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { fail } from '../utils/response';
import prisma from '../services/prisma';

export async function requireAccountManager(req: AuthRequest, res: Response, next: NextFunction) {
  const admin = await prisma.admin.findUnique({
    where: { id: req.adminId },
    select: { canManageAccounts: true },
  });

  if (!admin?.canManageAccounts) {
    return fail(res, '无账号管理权限', 403);
  }

  next();
}
