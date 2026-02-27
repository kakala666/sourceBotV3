import { Router, type IRouter } from 'express';
import { AdService } from '../services/ad.service';
import { authMiddleware } from '../middleware/auth';
import { success, fail } from '../utils/response';

const router: IRouter = Router();
router.use(authMiddleware);

router.get('/:linkId/ads', async (req, res) => {
  try {
    const linkId = parseInt(req.params.linkId);
    const ads = await AdService.list(linkId);
    return success(res, ads);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

router.put('/:linkId/ads', async (req, res) => {
  try {
    const linkId = parseInt(req.params.linkId);
    const { items } = req.body;
    if (!Array.isArray(items)) return fail(res, 'items 必须是数组');
    const ads = await AdService.batchSet(linkId, items);
    return success(res, ads);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

router.put('/:linkId/ads/sort', async (req, res) => {
  try {
    const linkId = parseInt(req.params.linkId);
    const { items } = req.body;
    if (!Array.isArray(items)) return fail(res, 'items 必须是数组');
    const ads = await AdService.sort(linkId, items);
    return success(res, ads);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

router.put('/:linkId/ads/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { buttons } = req.body;
    const ad = await AdService.updateOne(id, { buttons });
    return success(res, ad);
  } catch (err: any) {
    if (err.code === 'P2025') return fail(res, '广告绑定不存在', 404);
    return fail(res, err.message, 500);
  }
});

export default router;
