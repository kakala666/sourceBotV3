import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { fail } from '../utils/response';

export interface AuthRequest extends Request {
  adminId?: number;
  adminUsername?: string;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return fail(res, '未提供认证令牌', 401);
  }

  const token = authHeader.substring(7);
  try {
    const secret = process.env.JWT_SECRET || 'default-secret';
    const decoded = jwt.verify(token, secret) as { id: number; username: string };
    req.adminId = decoded.id;
    req.adminUsername = decoded.username;
    next();
  } catch {
    return fail(res, '认证令牌无效或已过期', 401);
  }
}
