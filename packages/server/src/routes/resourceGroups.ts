import { Router, type IRouter } from 'express';
import { ResourceGroupService } from '../services/resourceGroup.service';
import { authMiddleware } from '../middleware/auth';
import { success, fail } from '../utils/response';

const router: IRouter = Router();
router.use(authMiddleware);

router.get('/', async (_req, res) => {
  try {
    const groups = await ResourceGroupService.list();
    return success(res, groups);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, sortOrder } = req.body;
    if (!name) return fail(res, 'name 不能为空');
    const group = await ResourceGroupService.create({ name, sortOrder });
    return success(res, group, 201);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

router.put('/sort', async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) return fail(res, 'items 必须是数组');
    await ResourceGroupService.sort(items);
    return success(res);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const group = await ResourceGroupService.update(id, req.body);
    return success(res, group);
  } catch (err: any) {
    if (err.code === 'P2025') return fail(res, '分组不存在', 404);
    return fail(res, err.message, 500);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await ResourceGroupService.delete(id);
    return success(res);
  } catch (err: any) {
    if (err.code === 'P2025') return fail(res, '分组不存在', 404);
    return fail(res, err.message, 500);
  }
});

export default router;
