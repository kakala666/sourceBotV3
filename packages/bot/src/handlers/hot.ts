import type { Context } from 'grammy';

/**
 * 热门搜索预设词。每排 4 个共 2 排。
 * 由于 Telegram start payload 只允许 [A-Za-z0-9_-],中文不能直传,
 * 链接里用 1-based 编号,start.ts 用 HOT_KEYWORDS 同表映射回关键词。
 */
export const HOT_KEYWORDS: readonly string[] = [
  '反差', '母狗', '白虎', '自慰',
  '少妇', '熟女', '探花', '极品',
];

/**
 * 🔥 热搜:发预设关键词列表,每个词是 [词](t.me/<bot>?start=search_N) 链接。
 * 用户点 → Telegram 直接发 /start search_N → start.ts 查表搜对应词。
 */
export async function handleHotBrowse(ctx: Context, botId: number) {
  const username = ctx.me?.username;
  if (!username) {
    await ctx.reply('⚠️ bot 用户名获取失败,请联系管理员');
    return;
  }
  void botId;

  const linkFor = (kw: string, idx: number) =>
    `<a href="https://t.me/${username}?start=search_${idx + 1}">${kw}</a>`;
  const row1 = HOT_KEYWORDS.slice(0, 4).map((kw, i) => linkFor(kw, i)).join('     ');
  const row2 = HOT_KEYWORDS.slice(4, 8).map((kw, i) => linkFor(kw, i + 4)).join('     ');

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
