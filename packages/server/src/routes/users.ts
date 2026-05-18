import { Router, type IRouter } from 'express';
import { UserService } from '../services/user.service';
import { authMiddleware } from '../middleware/auth';
import { success, fail } from '../utils/response';

const router: IRouter = Router();

// /lookup 是免验证的公开接口;其他路由仍需 authMiddleware
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { page, pageSize, search, botId, linkId } = req.query;
    const result = await UserService.list({
      page: page ? parseInt(page as string) : undefined,
      pageSize: pageSize ? parseInt(pageSize as string) : undefined,
      search: search as string | undefined,
      botId: botId ? parseInt(botId as string) : undefined,
      linkId: linkId ? parseInt(linkId as string) : undefined,
    });
    return success(res, result);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

router.get('/:id/actions', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) return fail(res, 'id 必须是数字', 400);
    const { page, pageSize } = req.query;
    const result = await UserService.listActions(id, {
      page: page ? parseInt(page as string) : undefined,
      pageSize: pageSize ? parseInt(pageSize as string) : undefined,
    });
    return success(res, result);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

router.get('/lookup', async (req, res) => {
  try {
    const { telegramId, botId } = req.query;
    if (!telegramId) return fail(res, 'telegramId 必填', 400);

    let tgId: bigint;
    try {
      tgId = BigInt(String(telegramId).trim());
    } catch {
      return fail(res, 'telegramId 必须是数字', 400);
    }

    const botIdNum = botId ? parseInt(botId as string) : undefined;
    if (botId && Number.isNaN(botIdNum)) return fail(res, 'botId 必须是数字', 400);

    const result = await UserService.lookupByTelegramId(tgId, botIdNum);
    return success(res, result);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

export default router;
