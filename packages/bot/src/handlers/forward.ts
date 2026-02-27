import type { Context } from 'grammy';
import prisma from '../prisma';
import { getStatsGroupId } from '../services/content';

/**
 * 处理统计群组中的转发消息
 * 检测转发来源用户，查询 BotUser 记录并回复信息
 */
export async function handleForward(ctx: Context, botId: number) {
  // 获取统计群组 ID
  const statsGroupId = await getStatsGroupId();
  if (!statsGroupId) return;

  // 检查消息是否来自统计群组
  const chatId = ctx.chat?.id?.toString();
  if (chatId !== statsGroupId) return;

  // 检查是否是转发消息
  const forwardOrigin = (ctx.message as any)?.forward_origin;
  if (!forwardOrigin) return;

  // 提取转发来源用户
  if (forwardOrigin.type !== 'user') {
    await ctx.reply('该用户已隐藏转发来源', {
      reply_parameters: { message_id: ctx.message!.message_id },
    });
    return;
  }

  const forwardUser = forwardOrigin.sender_user;
  if (!forwardUser) {
    await ctx.reply('该用户已隐藏转发来源', {
      reply_parameters: { message_id: ctx.message!.message_id },
    });
    return;
  }

  const telegramId = BigInt(forwardUser.id);

  // 查询 BotUser 记录
  const botUser = await prisma.botUser.findUnique({
    where: { telegramId_botId: { telegramId, botId } },
    include: { inviteLink: true },
  });

  if (!botUser) {
    await ctx.reply('无该用户记录', {
      reply_parameters: { message_id: ctx.message!.message_id },
    });
    return;
  }

  // 构建用户信息回复
  const lines = [
    `用户信息：`,
    `ID: ${botUser.telegramId}`,
    `姓名: ${[botUser.firstName, botUser.lastName].filter(Boolean).join(' ') || '未知'}`,
    `用户名: ${botUser.username ? '@' + botUser.username : '无'}`,
    `来源链接: ${botUser.inviteLink.name} (${botUser.inviteLink.code})`,
    `首次使用: ${botUser.firstSeenAt.toLocaleString('zh-CN')}`,
    `最后使用: ${botUser.lastSeenAt.toLocaleString('zh-CN')}`,
  ];

  await ctx.reply(lines.join('\n'), {
    reply_parameters: { message_id: ctx.message!.message_id },
  });
}
