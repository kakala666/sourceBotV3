import { InputFile, InlineKeyboard } from 'grammy';
import fs from 'fs';
import path from 'path';
import os from 'os';
import prisma from '../prisma';
import type { BotManager } from '../manager/bot-manager';
import type { BroadcastRequest } from './types';
import { getTask, updateTask } from './store';

interface Recipient {
  telegramId: bigint;
  botId: number;
}

/**
 * 解码 base64 图片并写入临时文件，返回文件路径
 */
function decodeImage(base64Data: string): string {
  let raw = base64Data;
  // 去掉 data URI 前缀
  const match = raw.match(/^data:image\/\w+;base64,(.+)$/);
  if (match) raw = match[1];

  const buffer = Buffer.from(raw, 'base64');
  const tmpPath = path.join(os.tmpdir(), `broadcast_${Date.now()}.jpg`);
  fs.writeFileSync(tmpPath, buffer);
  return tmpPath;
}

/**
 * 构建 InlineKeyboard
 */
function buildKeyboard(buttons?: BroadcastRequest['buttons']): InlineKeyboard | undefined {
  if (!buttons || buttons.length === 0) return undefined;
  const kb = new InlineKeyboard();
  for (const row of buttons) {
    for (const btn of row) {
      kb.url(btn.text, btn.url);
    }
    kb.row();
  }
  return kb;
}

/**
 * 延时工具
 */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 向单个用户发送消息（图片或纯文本），支持 HTML 解析失败回退纯文本
 */
async function sendToUser(
  botApi: ReturnType<BotManager['getBotApi']>,
  chatId: bigint,
  caption: string,
  keyboard: InlineKeyboard | undefined,
  fileId: string | null,
  imagePath: string | null,
): Promise<{ success: boolean; newFileId?: string }> {
  if (!botApi) return { success: false };

  const replyMarkup = keyboard ? { reply_markup: keyboard } : {};
  const chatIdNum = Number(chatId);

  // 纯文本模式（无图片）
  if (!imagePath && !fileId) {
    try {
      await botApi.sendMessage(chatIdNum, caption, { parse_mode: 'HTML', ...replyMarkup });
      return { success: true };
    } catch {
      try {
        await botApi.sendMessage(chatIdNum, caption, replyMarkup);
        return { success: true };
      } catch {
        return { success: false };
      }
    }
  }

  // 图片模式
  const photo = fileId || new InputFile(imagePath!);
  try {
    const msg = await botApi.sendPhoto(chatIdNum, photo, {
      caption,
      parse_mode: 'HTML',
      ...replyMarkup,
    });
    const newFileId = msg.photo?.[msg.photo.length - 1]?.file_id;
    return { success: true, newFileId };
  } catch (err: any) {
    const errMsg = err.message || '';
    // file_id 失效，用本地文件重试
    if (fileId && imagePath && (errMsg.includes('wrong file') || errMsg.includes('file_id'))) {
      try {
        const msg = await botApi.sendPhoto(chatIdNum, new InputFile(imagePath), {
          caption,
          parse_mode: 'HTML',
          ...replyMarkup,
        });
        const nfid = msg.photo?.[msg.photo.length - 1]?.file_id;
        return { success: true, newFileId: nfid };
      } catch {
        return { success: false };
      }
    }
    // HTML 解析失败回退纯文本
    try {
      const msg = await botApi.sendPhoto(chatIdNum, photo, { caption, ...replyMarkup });
      const nfid = msg.photo?.[msg.photo.length - 1]?.file_id;
      return { success: true, newFileId: nfid };
    } catch {
      return { success: false };
    }
  }
}

/**
 * 收集所有接收者列表
 */
async function collectRecipients(
  botManager: BotManager,
  request: BroadcastRequest,
): Promise<Recipient[]> {
  const activeBotIds = botManager.getActiveBotIds();
  if (activeBotIds.length === 0) return [];

  const where: any = { botId: { in: activeBotIds } };
  if (request.user_ids && request.user_ids.length > 0) {
    where.telegramId = { in: request.user_ids.map((id) => BigInt(id)) };
  }

  const users = await prisma.botUser.findMany({
    where,
    select: { telegramId: true, botId: true },
    distinct: ['telegramId', 'botId'],
    orderBy: { lastSeenAt: 'desc' },
  });

  let recipients: Recipient[] = users;
  const max = request.config.max_recipients;
  if (max > 0 && recipients.length > max) {
    // Fisher-Yates 洗牌后取前 max 个
    for (let i = recipients.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [recipients[i], recipients[j]] = [recipients[j], recipients[i]];
    }
    recipients = recipients.slice(0, max);
  }

  return recipients;
}

/**
 * 执行广播任务
 */
export async function executeBroadcast(
  taskId: string,
  request: BroadcastRequest,
  botManager: BotManager,
): Promise<void> {
  const task = getTask(taskId);
  if (!task) return;

  let imagePath: string | null = null;
  try {
    // 解码图片
    if (request.image) {
      imagePath = decodeImage(request.image);
    }

    const keyboard = buildKeyboard(request.buttons);
    const { rate, interval } = request.config;

    // 按 botId 分组
    const recipients = await collectRecipients(botManager, request);
    updateTask(taskId, { total_recipients: recipients.length });

    if (recipients.length === 0) {
      updateTask(taskId, { status: 'completed', finished_at: new Date().toISOString() });
      return;
    }

    // 按 botId 分组接收者
    const grouped = new Map<number, bigint[]>();
    for (const r of recipients) {
      const list = grouped.get(r.botId) || [];
      list.push(r.telegramId);
      grouped.set(r.botId, list);
    }

    let sentCount = 0;
    let successCount = 0;
    let failCount = 0;
    let batchCount = 0;

    // 遍历每个 Bot 发送
    for (const [botId, userIds] of grouped) {
      const botApi = botManager.getBotApi(botId);
      if (!botApi) {
        failCount += userIds.length;
        sentCount += userIds.length;
        updateTask(taskId, { sent_count: sentCount, success_count: successCount, fail_count: failCount });
        continue;
      }

      let currentFileId: string | null = null;

      for (const telegramId of userIds) {
        // 检查是否被停止
        const current = getTask(taskId);
        if (!current || current.status === 'stopped') return;

        const result = await sendToUser(botApi, telegramId, request.caption, keyboard, currentFileId, imagePath);
        sentCount++;

        if (result.success) {
          successCount++;
          if (result.newFileId && !currentFileId) {
            currentFileId = result.newFileId;
          }
        } else {
          failCount++;
        }

        updateTask(taskId, { sent_count: sentCount, success_count: successCount, fail_count: failCount });

        // 频率控制
        batchCount++;
        if (batchCount >= rate) {
          batchCount = 0;
          if (interval > 0) await sleep(interval * 1000);
        }
      }
    }

    // 完成
    const finalTask = getTask(taskId);
    if (finalTask && finalTask.status === 'running') {
      updateTask(taskId, { status: 'completed', finished_at: new Date().toISOString() });
    }
  } catch (err: any) {
    console.error(`[Broadcast] 任务 ${taskId} 执行失败:`, err.message);
    updateTask(taskId, { status: 'failed', finished_at: new Date().toISOString() });
  } finally {
    // 清理临时文件
    if (imagePath) {
      try { fs.unlinkSync(imagePath); } catch {}
    }
  }
}
