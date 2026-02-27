import type { Context } from 'grammy';
import prisma from '../prisma';
import { upsertBotUser, resetSession } from '../services/session';
import { loadContentBindings, loadAdBindings, getAdDisplaySeconds, getEndContent } from '../services/content';
import { sendResource, sendAd, sendEndContent, buildPageKeyboard } from '../services/sender';

/**
 * 处理 /start 命令
 * 用户通过 t.me/botname?start=abc123 进入
 */
export async function handleStart(ctx: Context, botId: number) {
  const payload = (ctx as any).match as string | undefined;

  // 无参数 → 不回复
  if (!payload) return;

  // 查询邀请链接
  const inviteLink = await prisma.inviteLink.findUnique({
    where: { botId_code: { botId, code: payload } },
  });

  // 无效链接 → 不回复
  if (!inviteLink) return;

  // 加载内容绑定
  const contentBindings = await loadContentBindings(inviteLink.id);

  // 链接未配置内容 → 不回复
  if (!contentBindings.length) return;

  const from = ctx.from;
  if (!from) return;

  const telegramId = BigInt(from.id);

  // 记录/更新 BotUser
  const botUser = await upsertBotUser(
    telegramId,
    botId,
    inviteLink.id,
    from.first_name,
    from.last_name ?? undefined,
    from.username ?? undefined,
  );

  // 创建新会话（重置旧会话）
  const session = await resetSession(botUser.id);

  // 发送第一条资源
  await sendFirstResource(ctx, botId, inviteLink.id, session.id, contentBindings);
}

/**
 * 发送第一条资源（index=0）
 */
async function sendFirstResource(
  ctx: Context,
  botId: number,
  inviteLinkId: number,
  sessionId: number,
  contentBindings: Awaited<ReturnType<typeof loadContentBindings>>,
) {
  const binding = contentBindings[0];
  if (!binding?.resource) return;

  const totalContent = contentBindings.length;

  // 如果只有一条资源，发完即结束
  if (totalContent <= 1) {
    try {
      await sendResource(ctx, botId, binding.resource);
    } catch (err: any) {
      console.error('[start] 发送资源失败:', err.message);
      await ctx.reply('⚠️ 资源加载失败，请稍后重试');
      return;
    }
    const endContent = await getEndContent();
    await sendEndContent(ctx, endContent);
    return;
  }

  // 多条资源，带翻页按钮
  const keyboard = buildPageKeyboard(sessionId, 1);
  try {
    await sendResource(ctx, botId, binding.resource, keyboard);
  } catch (err: any) {
    console.error('[start] 发送资源失败:', err.message);
    // 发送失败时仍然提供翻页键盘，让用户可以跳到下一页
    await ctx.reply('⚠️ 当前资源加载失败', { reply_markup: keyboard });
  }
}
