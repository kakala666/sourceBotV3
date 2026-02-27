import { Router, type IRouter } from 'express';
import { SettingsService } from '../services/settings.service';
import { authMiddleware } from '../middleware/auth';
import { success, fail } from '../utils/response';

const router: IRouter = Router();
router.use(authMiddleware);

router.get('/', async (_req, res) => {
  try {
    const settings = await SettingsService.getAll();
    return success(res, settings);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

router.put('/', async (req, res) => {
  try {
    const data = req.body;
    if (!data || typeof data !== 'object') {
      return fail(res, '请提供有效的设置数据');
    }
    const settings = await SettingsService.batchUpdate(data);
    return success(res, settings);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

export default router;
