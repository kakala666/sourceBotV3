import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { BotManager } from '../manager/bot-manager';
import { createBroadcastRouter } from './routes';

/**
 * X-API-Key 认证中间件
 */
function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const apiKey = process.env.BROADCAST_API_KEY;
  if (!apiKey) {
    console.error('[Broadcast] BROADCAST_API_KEY 未配置');
    return res.status(500).json({ code: 500, message: 'Server misconfigured' });
  }

  const provided = req.headers['x-api-key'];
  if (!provided || provided !== apiKey) {
    return res.status(401).json({ code: 401, message: 'Invalid API key' });
  }
  next();
}

/**
 * 启动广播 API HTTP 服务器
 */
export function startBroadcastServer(botManager: BotManager) {
  const port = parseInt(process.env.BROADCAST_PORT || '8080', 10);
  const app = express();

  app.use(express.json({ limit: '50mb' }));
  app.use('/api/broadcast', apiKeyAuth, createBroadcastRouter(botManager));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'broadcast' });
  });

  app.listen(port, () => {
    console.log(`[Broadcast] API 服务已启动: http://localhost:${port}`);
  });
}
