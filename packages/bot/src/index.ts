import dotenv from 'dotenv';
import path from 'path';

// 加载项目根目录的 .env 文件
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { BotManager } from './manager/bot-manager';
import { startBroadcastServer } from './broadcast/server';
import { cleanupOrphanedTmpsOnStartup } from './services/storage';
import { startAutoSyncScheduler } from './services/bot-auto-sync-scheduler';

const manager = new BotManager();

async function main() {
  console.log('[Bot Runner] 启动...');

  // bot 重启意味着所有 in-flight 的 sender 下载/入库都已断,/tmp/sb-* 必然是孤儿
  cleanupOrphanedTmpsOnStartup();

  // 每天 00:00 跑一次 BotAutoSyncConfig.enabled=true 的同步
  startAutoSyncScheduler();

  await manager.start();

  // 启动广播 API 服务
  startBroadcastServer(manager);

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
