import type { Context } from 'grammy';

/**
 * 用户业务按钮点击节流:同一 (botId, telegramId) 在 3 秒窗口内只放过第一次。
 * 命中节流时,调用方应:
 *   1. 让本次"操作"立刻停下(callback 还要 answerCallbackQuery 清 loading)
 *   2. 调 sendThrottledNotice(ctx, botId, tgId) 发"3 秒内只能操作一次"提示并 2s 后自删
 *      —— 内部已去重,同一节流窗口内只发一次,防止用户连点 10 下被刷屏
 *
 * 单进程内存实现,bot-runner 是 fork 单实例,够用。
 * 定期清理过期 key 防止内存无限增长。
 */

const THROTTLE_MS = 3000;
const NOTICE_AUTO_DELETE_MS = 2000;
const NOTICE_TEXT = '⏳ 3 秒内只能操作一次';

const lastClickAt = new Map<string, number>();
/** 当前节流窗口内是否已经发过提示(去重) */
const noticedKeys = new Set<string>();

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
  // 放过:进入新窗口,重置 notice 状态,下次拦截可以重新提示一次
  lastClickAt.set(key, now);
  noticedKeys.delete(key);
  return false;
}

/**
 * 给节流命中的用户发一条提示,2 秒后自动删除。
 * 同一节流窗口内只发一次,后续被拦截的点击不再发(防刷屏)。
 * 失败时静默,不影响主流程。
 */
export function sendThrottledNotice(
  ctx: Context,
  botId: number,
  telegramId: number | bigint,
): void {
  const key = makeKey(botId, telegramId);
  if (noticedKeys.has(key)) return;
  noticedKeys.add(key);
  void (async () => {
    try {
      const msg = await ctx.reply(NOTICE_TEXT);
      setTimeout(() => {
        ctx.api.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
      }, NOTICE_AUTO_DELETE_MS);
    } catch {
      /* ignore */
    }
  })();
}

// 每分钟清理一次远超窗口的旧 key
setInterval(() => {
  const cutoff = Date.now() - THROTTLE_MS * 10;
  for (const [k, t] of lastClickAt) {
    if (t < cutoff) lastClickAt.delete(k);
  }
  for (const k of noticedKeys) {
    if (!lastClickAt.has(k)) noticedKeys.delete(k);
  }
}, 60_000).unref();
