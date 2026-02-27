import { Router, type IRouter } from 'express';
import { LinkService } from '../services/link.service';
import { authMiddleware } from '../middleware/auth';
import { success, fail } from '../utils/response';

const router: IRouter = Router();
router.use(authMiddleware);

router.get('/:botId/links', async (req, res) => {
  try {
    const botId = parseInt(req.params.botId);
    const links = await LinkService.list(botId);
    return success(res, links);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

router.post('/:botId/links', async (req, res) => {
  try {
    const botId = parseInt(req.params.botId);
    const { code, name } = req.body;
    if (!code || !name) {
      return fail(res, 'code 和 name 不能为空');
    }
    const link = await LinkService.create(botId, { code, name });
    return success(res, link, 201);
  } catch (err: any) {
    if (err.code === 'P2002') return fail(res, '该链接代码已存在', 409);
    return fail(res, err.message, 500);
  }
});

router.put('/:botId/links/:id', async (req, res) => {
  try {
    const botId = parseInt(req.params.botId);
    const id = parseInt(req.params.id);
    const link = await LinkService.update(id, botId, req.body);
    return success(res, link);
  } catch (err: any) {
    if (err.code === 'P2025') return fail(res, '链接不存在', 404);
    return fail(res, err.message, 500);
  }
});

router.delete('/:botId/links/:id', async (req, res) => {
  try {
    const botId = parseInt(req.params.botId);
    const id = parseInt(req.params.id);
    await LinkService.delete(id, botId);
    return success(res);
  } catch (err: any) {
    if (err.code === 'P2025') return fail(res, '链接不存在', 404);
    return fail(res, err.message, 500);
  }
});

export default router;
