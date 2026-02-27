import { Router, type IRouter } from 'express';
import { UserService } from '../services/user.service';
import { authMiddleware } from '../middleware/auth';
import { success, fail } from '../utils/response';

const router: IRouter = Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
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

export default router;
