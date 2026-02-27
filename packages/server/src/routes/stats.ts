import { Router, type IRouter } from 'express';
import { StatsService } from '../services/stats.service';
import { authMiddleware } from '../middleware/auth';
import { success, fail } from '../utils/response';

const router: IRouter = Router();
router.use(authMiddleware);

router.get('/overview', async (_req, res) => {
  try {
    const data = await StatsService.overview();
    return success(res, data);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

router.get('/daily', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return fail(res, 'startDate 和 endDate 参数必填');
    }
    const data = await StatsService.daily(startDate as string, endDate as string);
    return success(res, data);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

router.get('/by-link', async (req, res) => {
  try {
    const { botId, startDate, endDate } = req.query;
    const data = await StatsService.byLink({
      botId: botId ? parseInt(botId as string) : undefined,
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
    });
    return success(res, data);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

export default router;
