import { Router, type IRouter } from 'express';
import { BotAutoSyncService } from '../services/bot-auto-sync.service';
import { authMiddleware } from '../middleware/auth';
import { success, fail } from '../utils/response';

const router: IRouter = Router();
router.use(authMiddleware);

router.get('/:botId/auto-sync', async (req, res) => {
  try {
    const botId = parseInt(req.params.botId, 10);
    if (Number.isNaN(botId)) return fail(res, 'botId 必须是数字', 400);
    const cfg = await BotAutoSyncService.getConfig(botId);
    return success(res, cfg);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

router.put('/:botId/auto-sync', async (req, res) => {
  try {
    const botId = parseInt(req.params.botId, 10);
    if (Number.isNaN(botId)) return fail(res, 'botId 必须是数字', 400);
    const { enabled, targetBotId } = req.body ?? {};
    if (typeof enabled !== 'boolean') return fail(res, 'enabled 必须是布尔', 400);
    const cfg = await BotAutoSyncService.upsertConfig(botId, {
      enabled,
      targetBotId: targetBotId ?? null,
    });
    return success(res, cfg);
  } catch (err: any) {
    return fail(res, err.message, 400);
  }
});

/** 立即手动触发一次同步(便于测试,不影响每天 0 点的定时调度) */
router.post('/:botId/auto-sync/run', async (req, res) => {
  try {
    const botId = parseInt(req.params.botId, 10);
    if (Number.isNaN(botId)) return fail(res, 'botId 必须是数字', 400);
    const result = await BotAutoSyncService.runSync(botId);
    return success(res, result);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

export default router;
