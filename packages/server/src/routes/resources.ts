import { Router, type IRouter } from 'express';
import { ResourceService } from '../services/resource.service';
import { authMiddleware } from '../middleware/auth';
import { upload } from '../middleware/upload';
import { success, fail } from '../utils/response';

const router: IRouter = Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const { page, pageSize, groupId, search } = req.query;
    const result = await ResourceService.list({
      page: page ? parseInt(page as string) : undefined,
      pageSize: pageSize ? parseInt(pageSize as string) : undefined,
      groupId: groupId ? parseInt(groupId as string) : undefined,
      search: search as string | undefined,
    });
    return success(res, result);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

router.post('/', upload.array('files', 10), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return fail(res, '请上传至少一个文件');
    }
    const { caption, groupId, type } = req.body;
    const resource = await ResourceService.create({
      type: type || (files.length > 1 ? 'media_group' : (files[0].mimetype.startsWith('video/') ? 'video' : 'photo')),
      caption,
      groupId: groupId ? parseInt(groupId) : undefined,
      files,
    });
    return success(res, resource, 201);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { caption, groupId } = req.body;
    const resource = await ResourceService.update(id, {
      caption,
      groupId: groupId !== undefined ? (groupId === null ? null : parseInt(groupId)) : undefined,
    });
    return success(res, resource);
  } catch (err: any) {
    if (err.code === 'P2025') return fail(res, '资源不存在', 404);
    return fail(res, err.message, 500);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await ResourceService.delete(id);
    if (result.referenced) {
      return fail(res, '该资源正在被内容或广告引用，无法删除', 403);
    }
    return success(res);
  } catch (err: any) {
    if (err.code === 'P2025') return fail(res, '资源不存在', 404);
    return fail(res, err.message, 500);
  }
});

export default router;
