/**
 * 搜索 pending 状态:用户点了「🔍 搜索」之后,bot 等他下一条非命令文本作为搜索词。
 * in-memory,key = `${botId}:${telegramId}`,value = 过期时间戳。10 分钟自动失效。
 * bot 重启会清空(用户重新点搜索按钮即可)。
 */

const TTL_MS = 10 * 60 * 1000;

const pending = new Map<string, number>();

function makeKey(botId: number, telegramId: number): string {
  return `${botId}:${telegramId}`;
}

export function markPending(botId: number, telegramId: number): void {
  pending.set(makeKey(botId, telegramId), Date.now() + TTL_MS);
}

/**
 * 原子的 check-and-clear:若用户在 pending 且未过期,清掉并返回 true;否则返回 false。
 */
export function consumePending(botId: number, telegramId: number): boolean {
  const key = makeKey(botId, telegramId);
  const expireAt = pending.get(key);
  if (expireAt === undefined) return false;
  pending.delete(key);
  return expireAt > Date.now();
}

export function clearPending(botId: number, telegramId: number): void {
  pending.delete(makeKey(botId, telegramId));
}
