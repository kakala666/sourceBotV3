import { Router, type IRouter } from 'express';
import type { BotManager } from '../manager/bot-manager';
import type { BroadcastRequest } from './types';
import { generateTaskId, createTask, getTask, hasRunningTask, updateTask } from './store';
import { executeBroadcast } from './executor';

export function createBroadcastRouter(botManager: BotManager): IRouter {
  const router = Router();

  // POST /api/broadcast — 创建广播任务
  router.post('/', async (req, res) => {
    const body = req.body as BroadcastRequest;

    // 参数校验
    if (!body.caption || typeof body.caption !== 'string') {
      return res.status(400).json({ code: 400, message: 'caption is required' });
    }
    if (!body.config || !body.config.rate || !body.config.interval === undefined) {
      return res.status(400).json({ code: 400, message: 'config is required with rate, interval, max_recipients' });
    }
    if (body.config.rate < 1) {
      return res.status(400).json({ code: 400, message: 'config.rate must be >= 1' });
    }
    if (body.config.max_recipients === undefined || body.config.max_recipients === null) {
      return res.status(400).json({ code: 400, message: 'config.max_recipients is required' });
    }

    // 校验 image base64（如果提供）
    if (body.image) {
      try {
        let raw = body.image;
        const match = raw.match(/^data:image\/\w+;base64,(.+)$/);
        if (match) raw = match[1];
        const buf = Buffer.from(raw, 'base64');
        if (buf.length === 0) throw new Error('empty');
      } catch {
        return res.status(400).json({ code: 400, message: 'Invalid image: base64 decode failed' });
      }
    }

    // 检查是否有运行中任务
    if (hasRunningTask()) {
      return res.status(409).json({ code: 409, message: 'A broadcast task is already running' });
    }

    const taskId = generateTaskId();
    const task = createTask(taskId, 0);

    // 异步执行，不阻塞响应
    executeBroadcast(taskId, body, botManager).catch((err) => {
      console.error(`[Broadcast] 异步执行错误:`, err);
    });

    return res.json({
      code: 200,
      data: {
        task_id: task.task_id,
        total_recipients: task.total_recipients,
        status: task.status,
        created_at: task.created_at,
      },
    });
  });

  // GET /api/broadcast/:task_id — 查询任务状态
  router.get('/:task_id', (req, res) => {
    const task = getTask(req.params.task_id);
    if (!task) {
      return res.status(404).json({ code: 404, message: 'Task not found' });
    }
    return res.json({ code: 200, data: task });
  });

  // POST /api/broadcast/:task_id/stop — 停止任务
  router.post('/:task_id/stop', (req, res) => {
    const task = getTask(req.params.task_id);
    if (!task) {
      return res.status(404).json({ code: 404, message: 'Task not found' });
    }
    if (task.status !== 'running') {
      return res.status(400).json({ code: 400, message: `Task is not running (current: ${task.status})` });
    }
    updateTask(task.task_id, { status: 'stopped', finished_at: new Date().toISOString() });

    return res.json({
      code: 200,
      data: {
        task_id: task.task_id,
        status: 'stopped',
        sent_count: task.sent_count,
        success_count: task.success_count,
        fail_count: task.fail_count,
      },
    });
  });

  return router;
}
