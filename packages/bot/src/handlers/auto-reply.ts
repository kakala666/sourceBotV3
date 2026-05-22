import type { Context } from 'grammy';
import { getAutoReplyAd } from '../services/content';
import { buildHomeReplyKeyboard } from '../services/sender';

/**
 * 处理私聊中的用户消息,自动回复广告文本。
 * 顺手附带最新 reply_markup, 这样老用户跟 bot 发任意一句话, Telegram
 * 客户端会刷新成最新版本的常驻键盘(键盘改版后无需重新点 invite link)。
 */
export async function handleAutoReply(ctx: Context, botId: number) {
  void botId;
  const text = (await getAutoReplyAd()) || '👋';
  await ctx.reply(text, { reply_markup: buildHomeReplyKeyboard() }).catch(() => {});
}
