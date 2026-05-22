import type { Context } from 'grammy';

/** 热门搜索预设词(完全静态,每排 4 个共 2 排) */
const HOT_KEYWORDS = [
  '反差', '母狗', '白虎', '自慰',
  '少妇', '熟女', '探花', '极品',
];

/**
 * 🔥 热搜:不再动态拉资源列表,改成发一段预设 Markdown 文本。
 * 每个词是一个 [词](t.me/<bot>?start=search_<词>) deep link。
 * 用户在 bot chat 内点击 → Telegram 直接发送 /start search_<词> → start.ts
 * 检测到 search_ 前缀走 handleSearchQuery 执行该词搜索。
 */
export async function handleHotBrowse(ctx: Context, botId: number) {
  const username = ctx.me?.username;
  if (!username) {
    await ctx.reply('⚠️ bot 用户名获取失败,请联系管理员');
    return;
  }
  void botId; // 防 unused 警告(签名跟 hears 调用一致)

  const linkFor = (kw: string) =>
    `<a href="https://t.me/${username}?start=search_${encodeURIComponent(kw)}">${kw}</a>`;
  const row1 = HOT_KEYWORDS.slice(0, 4).map(linkFor).join('     ');
  const row2 = HOT_KEYWORDS.slice(4, 8).map(linkFor).join('     ');

  const text =
    `🔥 <b>热门搜索</b>\n` +
    `点击下方关键词直接搜索:\n\n` +
    `${row1}\n` +
    `${row2}`;

  await ctx.reply(text, {
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  });
}
