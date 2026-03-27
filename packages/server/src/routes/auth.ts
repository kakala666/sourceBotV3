import { Router, type IRouter } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthService } from '../services/auth.service';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { success, fail } from '../utils/response';

const router: IRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: '登录尝试过于频繁，请稍后再试' },
});

// 第一步：用户名密码登录
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return fail(res, '用户名和密码不能为空');
    }
    const result = await AuthService.login(username, password);
    if (!result) {
      return fail(res, '用户名或密码错误', 401);
    }
    if ('error' in result) {
      return fail(res, result.error as string, 403);
    }
    return success(res, result);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

// 第二步：中央身份验证
router.post('/central-auth', loginLimiter, async (req, res) => {
  try {
    const { pendingToken } = req.body;
    if (!pendingToken) {
      return fail(res, '缺少验证凭证');
    }
    const result = await AuthService.centralAuth(pendingToken);
    if ('error' in result) {
      return fail(res, result.error as string, 403);
    }
    return success(res, result);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

// 第三步：查询验证码状态
router.post('/verify-code', async (req, res) => {
  try {
    const { pendingToken, code } = req.body;
    if (!pendingToken || !code) {
      return fail(res, '缺少验证凭证或验证码');
    }
    const result = await AuthService.checkVerifyCode(pendingToken, code);
    if ('error' in result) {
      return fail(res, result.error as string, (result as any).expired ? 410 : 403);
    }
    return success(res, result);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

router.get('/me', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const admin = await AuthService.getMe(req.adminId!);
    if (!admin) {
      return fail(res, '管理员不存在', 404);
    }
    return success(res, admin);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

export default router;
