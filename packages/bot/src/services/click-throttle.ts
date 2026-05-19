/**
 * 用户业务按钮点击节流:同一 (botId, telegramId) 在 3 秒窗口内只放过第一次,
 * 之后的点击调用方应静默丢弃(callback 仍 answerCallbackQuery 清 loading)。
 *
 * 单进程内存实现,bot-runner 是 fork 单实例,够用。
 * 定期清理过期 key 防止内存无限增长。
 */

const THROTTLE_MS = 3000;

const lastClickAt = new Map<string, number>();

function makeKey(botId: number, telegramId: number | bigint): string {
  return `${botId}:${telegramId}`;
}

/**
 * 返回 true 表示这次点击应该被丢弃(过于频繁);
 * 返回 false 表示放过 + 记下时间戳。
 */
export function shouldThrottle(botId: number, telegramId: number | bigint): boolean {
  const key = makeKey(botId, telegramId);
  const now = Date.now();
  const last = lastClickAt.get(key) ?? 0;
  if (now - last < THROTTLE_MS) return true;
  lastClickAt.set(key, now);
  return false;
}

// 每分钟清理一次远超窗口的旧 key
setInterval(() => {
  const cutoff = Date.now() - THROTTLE_MS * 10;
  for (const [k, t] of lastClickAt) {
    if (t < cutoff) lastClickAt.delete(k);
  }
}, 60_000).unref();
