import type { Context } from 'grammy';
import { getAutoReplyAd } from '../services/content';

/**
 * 处理私聊中的用户消息，自动回复广告文本
 */
export async function handleAutoReply(ctx: Context, botId: number) {
  const text = await getAutoReplyAd();
  if (!text) return;
  await ctx.reply(text);
}
