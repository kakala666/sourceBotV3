import { Router, type IRouter } from 'express';
import type { BotManager } from '../manager/bot-manager';
import prisma from '../prisma';
import { sendResourceDirect } from '../services/sender-direct';

interface Recipient {
  botId: number;
  telegramId: string;  // 数字字符串(BigInt-safe)
}

interface NotifyRequest {
  resourceId: number;
  recipients: Recipient[];
  /** 在 caption 开头额外加一行(比如 "📢 您关注的标签 #xxx 有新资源"),可选 */
  prefixText?: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 创建 notify-resource 路由。
 * POST /api/notify-resource
 *
 * 不走广播任务表,异步执行(立即返回 accepted),适合管理员加标签触发的"找到关心此标签的用户推送资源"场景。
 * 节流:每条消息间隔 50ms (约 20 msg/s),失败仅记录日志不阻塞剩余目标。
 */
export function createNotifyResourceRouter(botManager: BotManager): IRouter {
  const router = Router();

  router.post('/', async (req, res) => {
    const body = req.body as NotifyRequest;
    if (!body?.resourceId || !Array.isArray(body.recipients)) {
      return res.status(400).json({ code: 400, message: 'resourceId and recipients[] required' });
    }
    if (body.recipients.length === 0) {
      return res.json({ code: 200, data: { queued: 0 } });
    }

    const resource = await prisma.resource.findUnique({
      where: { id: body.resourceId },
      include: { mediaFiles: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!resource) {
      return res.status(404).json({ code: 404, message: 'resource not found' });
    }

    // 立即响应,异步处理
    res.json({ code: 200, data: { queued: body.recipients.length } });

    runNotify(botManager, resource, body.recipients, body.prefixText).catch((err) => {
      console.error('[notify-resource] 任务失败:', err.message);
    });
  });

  return router;
}

async function runNotify(
  botManager: BotManager,
  resource: any,
  recipients: Recipient[],
  prefixText: string | undefined,
) {
  // 拼最终 caption:可选 prefixText + 资源{id} 前缀 + 原 caption
  const idLine = `资源${resource.id}`;
  const captionParts: string[] = [];
  if (prefixText) captionParts.push(prefixText);
  captionParts.push(idLine);
  if (resource.caption) captionParts.push(resource.caption);
  const finalCaption = captionParts.join('\n');

  let ok = 0;
  let fail = 0;
  for (const r of recipients) {
    const api = botManager.getBotApi(r.botId);
    if (!api) {
      fail++;
      continue;
    }
    try {
      await sendResourceDirect(api, r.botId, BigInt(r.telegramId), {
        id: resource.id,
        type: resource.type,
        caption: resource.caption,
        mediaFiles: resource.mediaFiles,
      }, finalCaption);
      ok++;
    } catch (err: any) {
      fail++;
      // user blocked / chat not found / file failed:吞掉单条失败,继续
      const m = err.message || '';
      if (!m.includes('blocked') && !m.includes('chat not found') && !m.includes('user is deactivated')) {
        console.error(`[notify-resource] send fail bot=${r.botId} tg=${r.telegramId}:`, m);
      }
    }
    await sleep(50);
  }
  console.log(`[notify-resource] resource=${resource.id} done ok=${ok} fail=${fail}`);
}
