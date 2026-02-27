import dotenv from 'dotenv';
import path from 'path';

// 加载项目根目录的 .env 文件
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { BotManager } from './manager/bot-manager';

const manager = new BotManager();

async function main() {
  console.log('[Bot Runner] 启动...');

  await manager.start();

  // 优雅退出
  process.once('SIGINT', async () => {
    console.log('[Bot Runner] 收到 SIGINT，正在退出...');
    await manager.stop();
    process.exit(0);
  });

  process.once('SIGTERM', async () => {
    console.log('[Bot Runner] 收到 SIGTERM，正在退出...');
    await manager.stop();
    process.exit(0);
  });

  console.log('[Bot Runner] 运行中，按 Ctrl+C 退出');
}

main().catch((err) => {
  console.error('[Bot Runner] 启动失败:', err);
  process.exit(1);
});
