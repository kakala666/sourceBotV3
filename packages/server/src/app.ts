import dotenv from 'dotenv';
dotenv.config();

// 让 res.json 能序列化 BigInt(默认会抛 TypeError)。
// 适用于所有 schema 中 BigInt 字段(telegramId / channelChatId / chatId 等)。
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

import express, { type Express } from 'express';
import cors from 'cors';
import path from 'path';
import apiRouter from './routes';

const app: Express = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静态文件服务（上传目录）
const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'));
app.use('/uploads', express.static(uploadDir));

// API 路由
app.use('/api', apiRouter);

// 健康检查
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// 启动服务
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export default app;
