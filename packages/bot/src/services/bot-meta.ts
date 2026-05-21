import prisma from '../prisma';

/**
 * bot 元数据 in-memory cache(目前只缓存 username,供分享按钮构造 deep link 用)。
 * .bot-reload 信号触发时由 bot-manager 调 reloadBotMeta()。
 */

let cache = new Map<number, { username: string | null }>();

export function getBotUsername(botId: number): string | null {
  return cache.get(botId)?.username ?? null;
}

export async function reloadBotMeta(): Promise<void> {
  const bots = await prisma.bot.findMany({
    select: { id: true, username: true },
  });
  const next = new Map<number, { username: string | null }>();
  for (const b of bots) next.set(b.id, { username: b.username });
  cache = next;
}
