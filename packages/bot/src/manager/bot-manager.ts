import { Bot } from 'grammy';
import prisma from '../prisma';
import { handleStart } from '../handlers/start';
import { handleCallback } from '../handlers/callback';
import { handleForward } from '../handlers/forward';
import fs from 'fs';
import path from 'path';

/** 信号文件路径 */
const RELOAD_SIGNAL_FILE = path.resolve(__dirname, '../../../../.bot-reload');

/** 轮询间隔（毫秒） */
const POLL_INTERVAL = 30_000;

interface BotInstance {
  bot: Bot;
  botId: number;
  isRunning: boolean;
}

export class BotManager {
  private instances = new Map<number, BotInstance>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private signalTimer: ReturnType<typeof setInterval> | null = null;
  private isShuttingDown = false;

  /**
   * 启动管理器：加载所有活跃 Bot，启动轮询
   */
  async start() {
    console.log('[BotManager] 启动中...');
    await this.loadAllBots();
    this.startPolling();
    this.startSignalWatcher();
    console.log('[BotManager] 启动完成');
  }

  /**
   * 停止管理器：停止所有 Bot 和定时器
   */
  async stop() {
    this.isShuttingDown = true;
    console.log('[BotManager] 停止中...');

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.signalTimer) {
      clearInterval(this.signalTimer);
      this.signalTimer = null;
    }

    const stopPromises: Promise<void>[] = [];
    for (const [botId] of this.instances) {
      stopPromises.push(this.stopBot(botId));
    }
    await Promise.allSettled(stopPromises);

    console.log('[BotManager] 已停止');
  }

  /**
   * 从数据库加载所有活跃 Bot
   */
  private async loadAllBots() {
    const bots = await prisma.bot.findMany({ where: { isActive: true } });
    console.log(`[BotManager] 发现 ${bots.length} 个活跃 Bot`);

    for (const botRecord of bots) {
      if (!this.instances.has(botRecord.id)) {
        await this.startBot(botRecord.id, botRecord.token);
      }
    }

    // 停止已不在活跃列表中的 Bot
    const activeIds = new Set(bots.map((b) => b.id));
    for (const [botId] of this.instances) {
      if (!activeIds.has(botId)) {
        await this.stopBot(botId);
      }
    }
  }

  /**
   * 启动单个 Bot
   */
  async startBot(botId: number, token?: string) {
    if (this.instances.has(botId)) {
      console.log(`[BotManager] Bot ${botId} 已在运行中`);
      return;
    }

    if (!token) {
      const botRecord = await prisma.bot.findUnique({ where: { id: botId } });
      if (!botRecord) {
        console.error(`[BotManager] Bot ${botId} 不存在`);
        return;
      }
      token = botRecord.token;
    }

    try {
      const bot = new Bot(token);
      this.registerHandlers(bot, botId);

      // 启动 polling（非阻塞）
      bot.start({
        onStart: () => console.log(`[BotManager] Bot ${botId} 已启动 polling`),
      });

      this.instances.set(botId, { bot, botId, isRunning: true });
    } catch (err: any) {
      console.error(`[BotManager] Bot ${botId} 启动失败:`, err.message);
      // 标记异常，不影响其他 Bot
    }
  }

  /**
   * 停止单个 Bot
   */
  async stopBot(botId: number) {
    const instance = this.instances.get(botId);
    if (!instance) return;

    try {
      await instance.bot.stop();
      console.log(`[BotManager] Bot ${botId} 已停止`);
    } catch (err: any) {
      console.error(`[BotManager] Bot ${botId} 停止失败:`, err.message);
    }

    this.instances.delete(botId);
  }

  /**
   * 重启单个 Bot
   */
  async restartBot(botId: number) {
    console.log(`[BotManager] 重启 Bot ${botId}`);
    await this.stopBot(botId);
    await this.startBot(botId);
  }

  /**
   * 为 Bot 注册统一的消息处理器
   */
  private registerHandlers(bot: Bot, botId: number) {
    // /start 命令处理
    bot.command('start', async (ctx) => {
      try {
        await handleStart(ctx, botId);
      } catch (err: any) {
        console.error(`[Bot ${botId}] /start 处理失败:`, err.message);
      }
    });

    // 翻页回调处理
    bot.on('callback_query:data', async (ctx) => {
      try {
        await handleCallback(ctx, botId);
      } catch (err: any) {
        console.error(`[Bot ${botId}] callback 处理失败:`, err.message);
        await ctx.answerCallbackQuery().catch(() => {});
      }
    });

    // 转发消息检测（统计群组）
    bot.on('message', async (ctx) => {
      try {
        await handleForward(ctx, botId);
      } catch (err: any) {
        console.error(`[Bot ${botId}] forward 处理失败:`, err.message);
      }
    });

    // 全局错误处理
    bot.catch((err) => {
      console.error(`[Bot ${botId}] 未捕获错误:`, err.message);
    });
  }

  /**
   * 每30秒轮询数据库检查 Bot 列表变更
   */
  private startPolling() {
    this.pollTimer = setInterval(async () => {
      if (this.isShuttingDown) return;
      try {
        await this.loadAllBots();
      } catch (err: any) {
        console.error('[BotManager] 轮询检查失败:', err.message);
      }
    }, POLL_INTERVAL);
  }

  /**
   * 监听 .bot-reload 信号文件
   */
  private startSignalWatcher() {
    this.signalTimer = setInterval(async () => {
      if (this.isShuttingDown) return;
      try {
        if (fs.existsSync(RELOAD_SIGNAL_FILE)) {
          console.log('[BotManager] 检测到 .bot-reload 信号，重新加载...');
          fs.unlinkSync(RELOAD_SIGNAL_FILE);
          await this.loadAllBots();
        }
      } catch (err: any) {
        console.error('[BotManager] 信号文件检查失败:', err.message);
      }
    }, 2000); // 每2秒检查一次信号文件
  }
}