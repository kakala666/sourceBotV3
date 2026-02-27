import { Router, type IRouter } from 'express';
import { BotService } from '../services/bot.service';
import { authMiddleware } from '../middleware/auth';
import { success, fail } from '../utils/response';

const router: IRouter = Router();
router.use(authMiddleware);

router.get('/', async (_req, res) => {
  try {
    const bots = await BotService.list();
    return success(res, bots);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

router.post('/', async (req, res) => {
  try {
    const { token, name } = req.body;
    if (!token || !name) {
      return fail(res, 'token 和 name 不能为空');
    }
    const bot = await BotService.create({ token, name });
    return success(res, bot, 201);
  } catch (err: any) {
    if (err.code === 'P2002') {
      return fail(res, '该 Token 已存在', 409);
    }
    return fail(res, err.message, 500);
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const bot = await BotService.update(id, req.body);
    return success(res, bot);
  } catch (err: any) {
    if (err.code === 'P2025') return fail(res, '机器人不存在', 404);
    return fail(res, err.message, 500);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await BotService.delete(id);
    return success(res);
  } catch (err: any) {
    if (err.code === 'P2025') return fail(res, '机器人不存在', 404);
    return fail(res, err.message, 500);
  }
});

router.post('/:id/verify', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await BotService.verify(id);
    if (!result) return fail(res, '机器人不存在', 404);
    if (!result.ok) return fail(res, 'Token 验证失败: ' + (result.description || ''));
    return success(res, result.result);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

export default router;
