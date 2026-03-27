import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from './prisma';
import { JWT_EXPIRES_IN } from 'shared';

const CENTRAL_AUTH_URL = 'http://129.226.161.215:16000';

/**
 * 读取系统设置
 */
async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  const setting = await prisma.systemSetting.findUnique({ where: { key } });
  if (!setting) return defaultValue;
  return setting.value as T;
}

/**
 * 生成 JWT token
 */
function generateToken(admin: { id: number; username: string }): string {
  const secret = process.env.JWT_SECRET || 'default-secret';
  return jwt.sign({ id: admin.id, username: admin.username }, secret, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * 生成临时 pendingToken（短期有效，仅用于验证流程）
 */
function generatePendingToken(admin: { id: number; username: string }): string {
  const secret = process.env.JWT_SECRET || 'default-secret';
  return jwt.sign({ id: admin.id, username: admin.username, pending: true }, secret, { expiresIn: '10m' });
}

/**
 * 验证 pendingToken
 */
function verifyPendingToken(token: string): { id: number; username: string } | null {
  try {
    const secret = process.env.JWT_SECRET || 'default-secret';
    const decoded = jwt.verify(token, secret) as any;
    if (!decoded.pending) return null;
    return { id: decoded.id, username: decoded.username };
  } catch {
    return null;
  }
}

/**
 * 格式化管理员信息（不含密码）
 */
function formatAdmin(admin: { id: number; name: string; username: string; telegramId: string | null; canManageAccounts: boolean }) {
  return {
    id: admin.id,
    name: admin.name,
    username: admin.username,
    telegramId: admin.telegramId,
    canManageAccounts: admin.canManageAccounts,
  };
}

export class AuthService {
  /**
   * 第一步：密码验证 + 判断需要哪些额外验证
   */
  static async login(username: string, password: string) {
    const admin = await prisma.admin.findUnique({ where: { username } });
    if (!admin) return null;

    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) return null;

    const centralAuthEnabled = await getSetting<boolean>('centralAuthEnabled', false);
    const verifyCodeEnabled = await getSetting<boolean>('verifyCodeEnabled', false);

    // 不需要任何额外验证，直接返回 token
    if (!centralAuthEnabled && !verifyCodeEnabled) {
      return {
        token: generateToken(admin),
        admin: formatAdmin(admin),
      };
    }

    // 需要额外验证
    const pendingToken = generatePendingToken(admin);

    // 需要中央身份验证
    if (centralAuthEnabled) {
      if (!admin.telegramId) {
        return { error: '该账号未绑定 Telegram ID，无法进行中央身份验证，请联系管理员' };
      }
      return {
        needCentralAuth: true,
        needVerifyCode: verifyCodeEnabled,
        pendingToken,
      };
    }

    // 仅需要验证码验证
    if (verifyCodeEnabled) {
      if (!admin.telegramId) {
        return { error: '该账号未绑定 Telegram ID，无法进行验证码认证，请联系管理员' };
      }
      // 直接获取验证码
      const verifyCode = await this.fetchVerifyCode(admin.telegramId);
      if (!verifyCode) {
        return { error: '获取验证码失败，请稍后重试' };
      }
      return {
        needVerifyCode: true,
        verifyCode,
        pendingToken,
      };
    }

    return {
      token: generateToken(admin),
      admin: formatAdmin(admin),
    };
  }

  /**
   * 中央身份验证
   */
  static async centralAuth(pendingToken: string) {
    const decoded = verifyPendingToken(pendingToken);
    if (!decoded) return { error: '验证凭证无效或已过期，请重新登录' };

    const admin = await prisma.admin.findUnique({ where: { id: decoded.id } });
    if (!admin || !admin.telegramId) return { error: '账号不存在或未绑定 Telegram ID' };

    // 调用中央身份验证 API
    try {
      const res = await fetch(`${CENTRAL_AUTH_URL}/check?id=${admin.telegramId}`);
      const data = (await res.json()) as { ok: boolean };
      if (!data.ok) {
        return { error: '中央身份验证失败，请联系管理员将你加入中央身份验证系统' };
      }
    } catch {
      return { error: '中央身份验证服务不可用，请稍后重试' };
    }

    // 中央验证通过，检查是否还需要验证码
    const verifyCodeEnabled = await getSetting<boolean>('verifyCodeEnabled', false);
    if (verifyCodeEnabled) {
      const verifyCode = await this.fetchVerifyCode(admin.telegramId);
      if (!verifyCode) {
        return { error: '获取验证码失败，请稍后重试' };
      }
      return {
        needVerifyCode: true,
        verifyCode,
        pendingToken,
      };
    }

    // 全部验证通过，发放 token
    return {
      token: generateToken(admin),
      admin: formatAdmin(admin),
    };
  }

  /**
   * 查询验证码状态
   */
  static async checkVerifyCode(pendingToken: string, code: string) {
    const decoded = verifyPendingToken(pendingToken);
    if (!decoded) return { error: '验证凭证无效或已过期，请重新登录' };

    try {
      const res = await fetch(`${CENTRAL_AUTH_URL}/status?code=${code}`);
      const data = (await res.json()) as { status: string };

      if (data.status === 'verified') {
        const admin = await prisma.admin.findUnique({ where: { id: decoded.id } });
        if (!admin) return { error: '账号不存在' };
        return {
          token: generateToken(admin),
          admin: formatAdmin(admin),
        };
      }

      if (data.status === 'not_found') {
        return { error: '验证码不存在或已过期，请重新登录', expired: true };
      }

      // pending
      return { status: 'pending' };
    } catch {
      return { error: '验证码查询服务不可用，请稍后重试' };
    }
  }

  /**
   * 获取验证码
   */
  static async fetchVerifyCode(telegramId: string): Promise<string | null> {
    try {
      const res = await fetch(`${CENTRAL_AUTH_URL}/verify?id=${telegramId}`);
      const data = (await res.json()) as { code?: string };
      return data.code || null;
    } catch {
      return null;
    }
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
