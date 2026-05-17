import { Router, type IRouter } from 'express';
import multer from 'multer';
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

router.post('/', (req, res) => {
  // 不限制单次上传文件数量;发送时按 10 个/批拆分发送
  const uploadMiddleware = upload.array('files');
  uploadMiddleware(req, res, async (err: any) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        switch (err.code) {
          case 'LIMIT_FILE_SIZE':
            return fail(res, '单个文件大小超过 2GB 限制', 413);
          case 'LIMIT_UNEXPECTED_FILE':
            return fail(res, '不支持的文件字段', 400);
          default:
            return fail(res, `上传错误: ${err.message}`, 400);
        }
      }
      return fail(res, err.message || '文件类型不支持', 400);
    }
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

/**
 * 覆盖式更新资源标签(管理员标记,机器人前端不可见)。
 * body: { tags: string[] }
 * 对新增的 tag 异步触发对相关收藏用户的资源推送。
 */
router.put('/:id/tags', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { tags } = req.body ?? {};
    if (!Array.isArray(tags)) return fail(res, 'tags 必须是数组', 400);
    const normalized = await ResourceService.setTags(id, tags as string[]);
    return success(res, { tags: normalized });
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

export default router;
