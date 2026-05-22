import type { Context } from 'grammy';
import prisma from '../prisma';

/**
 * 📤 分享机器人给其他朋友:
 * 发一段邀请文案 + bot 自身 deep link (用该用户进来时的 invite code,
 * 朋友点链接 → 走相同 invite link)。用户长按本消息可一键转发给联系人。
 */
export async function handleShareBot(ctx: Context, botId: number) {
  const from = ctx.from;
  if (!from) return;

  const username = ctx.me?.username;
  if (!username) {
    await ctx.reply('⚠️ bot 用户名获取失败,请联系管理员');
    return;
  }

  // 找该用户进来时绑定的 invite link
  const botUser = await prisma.botUser.findFirst({
    where: { telegramId: BigInt(from.id), botId },
    include: { inviteLink: { select: { code: true } } },
  });
  if (!botUser) {
    await ctx.reply('请先通过邀请链接 /start 一次');
    return;
  }

  const url = `https://t.me/${username}?start=${botUser.inviteLink.code}`;

  const text =
    `✨ <b>把这个资源助手推荐给朋友</b>\n\n` +
    `📚 海量精选 · 极速线路 · 持续更新\n` +
    `🎯 一键浏览 · 完全免费\n\n` +
    `👇 长按本消息转发给好友\n` +
    `${url}\n\n` +
    `朋友通过这个链接进入即可解锁全部资源 🚀`;

  await ctx.reply(text, {
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  });
}
