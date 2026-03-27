import { Router, type IRouter } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { requireAccountManager } from '../middleware/permission';
import { AdminService } from '../services/admin.service';
import { success, fail } from '../utils/response';

const router: IRouter = Router();
router.use(authMiddleware);
router.use(requireAccountManager);

router.get('/', async (_req, res) => {
  try {
    const admins = await AdminService.list();
    return success(res, admins);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, username, password, telegramId, canManageAccounts } = req.body;
    if (!name || !username || !password) {
      return fail(res, '姓名、账号和密码不能为空');
    }
    const admin = await AdminService.create({ name, username, password, telegramId, canManageAccounts });
    return success(res, admin, 201);
  } catch (err: any) {
    if (err.code === 'P2002') {
      const field = err.meta?.target?.includes('username') ? '账号' : 'Telegram ID';
      return fail(res, `${field}已存在`, 409);
    }
    return fail(res, err.message, 500);
  }
});

router.put('/:id', async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, username, password, telegramId, canManageAccounts } = req.body;

    // 不可关闭自己的管理权限
    if (id === req.adminId && canManageAccounts === false) {
      return fail(res, '不可关闭自己的账号管理权限', 403);
    }

    const admin = await AdminService.update(id, { name, username, password, telegramId, canManageAccounts });
    return success(res, admin);
  } catch (err: any) {
    if (err.code === 'P2002') {
      const field = err.meta?.target?.includes('username') ? '账号' : 'Telegram ID';
      return fail(res, `${field}已存在`, 409);
    }
    if (err.code === 'P2025') return fail(res, '账号不存在', 404);
    return fail(res, err.message, 500);
  }
});

router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (id === req.adminId) {
      return fail(res, '不可删除自己的账号', 403);
    }
    await AdminService.delete(id);
    return success(res);
  } catch (err: any) {
    if (err.code === 'P2025') return fail(res, '账号不存在', 404);
    return fail(res, err.message, 500);
  }
});

export default router;
