import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import prisma from '../prisma';

/**
 * 📤 分享机器人给其他朋友:
 * 发一条带 inline keyboard 的消息, button 指向 t.me/share/url Telegram
 * 通用分享端点。用户点击 → Telegram 弹聊天选择器 → 选好后以"用户"身份
 * 把 邀请文案 + bot deep link 发到目标聊天。
 *
 * 因 bot 出站消息全局 protect_content=true 不可转发, 不能让用户长按 Forward,
 * 故必须走 share/url + url button 这条路。t.me/share/url 不需要 bot 开
 * inline mode, 任意 bot 都能用。
 *
 * 分享链接里的 invite code 用该用户进来时绑定的, 朋友点击后走相同入口。
 */
export async function handleShareBot(ctx: Context, botId: number) {
  const from = ctx.from;
  if (!from) return;

  const username = ctx.me?.username;
  if (!username) {
    await ctx.reply('⚠️ bot 用户名获取失败,请联系管理员');
    return;
  }

  const botUser = await prisma.botUser.findFirst({
    where: { telegramId: BigInt(from.id), botId },
    include: { inviteLink: { select: { code: true } } },
  });
  if (!botUser) {
    await ctx.reply('请先通过邀请链接 /start 一次');
    return;
  }

  const inviteUrl = `https://t.me/${username}?start=${botUser.inviteLink.code}`;
  // 分享到对方聊天时显示的文案 (Telegram 会把 url 作为可点击链接附加在 text 之后)
  const shareText =
    `✨ 推荐一个超好用的资源助手\n` +
    `📚 海量精选 · 极速线路 · 持续更新\n` +
    `🎯 一键浏览 · 完全免费`;

  const shareApiUrl =
    `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}` +
    `&text=${encodeURIComponent(shareText)}`;

  const kb = new InlineKeyboard().url('📤 立即分享给好友', shareApiUrl);

  await ctx.reply(
    `🎁 <b>把这个机器人推荐给朋友</b>\n` +
    `点击下方按钮选择好友一键分享 👇`,
    {
      parse_mode: 'HTML',
      reply_markup: kb,
      link_preview_options: { is_disabled: true },
    },
  );
}
