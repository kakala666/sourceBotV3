import { Router, type IRouter } from 'express';
import { ResourceService } from '../services/resource.service';
import { authMiddleware } from '../middleware/auth';
import { success, fail } from '../utils/response';
import { ALLOWED_PHOTO_TYPES, ALLOWED_VIDEO_TYPES, MAX_PHOTO_SIZE, MAX_VIDEO_SIZE } from 'shared';
import type { PresignUploadRequestItem, ResourceRegisterFile } from 'shared';

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

/**
 * 浏览器直传 S3 模式 - 第 1 步:为每个文件签发 presigned PUT URL。
 * body: { files: [{ originalName, mimetype, size }, ...] }
 */
router.post('/presign', async (req, res) => {
  try {
    const items = (req.body?.files ?? []) as PresignUploadRequestItem[];
    if (!Array.isArray(items) || items.length === 0) {
      return fail(res, 'files 必须是非空数组', 400);
    }
    const allAllowed = new Set([...ALLOWED_PHOTO_TYPES, ...ALLOWED_VIDEO_TYPES]);
    for (const f of items) {
      if (!f.originalName || !f.mimetype || typeof f.size !== 'number') {
        return fail(res, '文件元信息不完整 (originalName/mimetype/size)', 400);
      }
      if (!allAllowed.has(f.mimetype)) {
        return fail(res, `不支持的文件类型: ${f.mimetype}`, 400);
      }
      const limit = f.mimetype.startsWith('video/') ? MAX_VIDEO_SIZE : MAX_PHOTO_SIZE;
      if (f.size > limit) {
        return fail(res, `文件 ${f.originalName} 超过大小限制`, 400);
      }
    }
    const presigned = await ResourceService.presignUploads(items);
    return success(res, presigned);
  } catch (err: any) {
    return fail(res, err.message, 500);
  }
});

/**
 * 浏览器直传 S3 模式 - 第 2 步:client PUT 完所有文件后通知 server 登记 Resource。
 * body: { type, caption, groupId, files: [{ key, originalName, mimetype, size }, ...] }
 */
router.post('/', async (req, res) => {
  try {
    const { type, caption, groupId, files } = req.body ?? {};
    const fileList = (files ?? []) as ResourceRegisterFile[];
    if (!Array.isArray(fileList) || fileList.length === 0) {
      return fail(res, '至少需要一个 file', 400);
    }
    for (const f of fileList) {
      if (!f.key || !f.originalName || !f.mimetype) {
        return fail(res, 'file 元信息不完整 (key/originalName/mimetype)', 400);
      }
    }
    const inferredType = type
      || (fileList.length > 1 ? 'media_group' : (fileList[0].mimetype.startsWith('video/') ? 'video' : 'photo'));
    const resource = await ResourceService.create({
      type: inferredType,
      caption,
      groupId: groupId ? parseInt(groupId) : undefined,
      files: fileList,
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
