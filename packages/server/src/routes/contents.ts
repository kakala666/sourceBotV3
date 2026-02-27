import { Router, type IRouter } from 'express';
import { ContentService } from '../services/content.service';
import { authMiddleware } from '../middleware/auth';
import { success, fail } from '../utils/response';

const router: IRouter = Router();
router.use(authMiddleware);

router.get('/:linkId/contents', async (req, res) => {
  try {
    const linkId = parseInt(req.params.linkId);
    const contents = await ContentService.list(linkId);
    return success(res, contents);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

router.put('/:linkId/contents', async (req, res) => {
  try {
    const linkId = parseInt(req.params.linkId);
    const { items } = req.body;
    if (!Array.isArray(items)) return fail(res, 'items 必须是数组');
    const contents = await ContentService.batchSet(linkId, items);
    return success(res, contents);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

router.put('/:linkId/contents/sort', async (req, res) => {
  try {
    const linkId = parseInt(req.params.linkId);
    const { items } = req.body;
    if (!Array.isArray(items)) return fail(res, 'items 必须是数组');
    const contents = await ContentService.sort(linkId, items);
    return success(res, contents);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

export default router;
