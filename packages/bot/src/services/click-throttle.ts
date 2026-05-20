import type { Context } from 'grammy';

/**
 * 用户业务按钮点击节流 + 滥用封禁。
 *
 * 两级保护:
 *   - 3 秒节流: (botId, telegramId) 在 3 秒内只放过第一次
 *   - 30 秒封禁: 同一用户在 10 秒内被节流拦下 > 3 次, 自动封 30 秒
 *
 * 命中时调用方应:
 *   1. 让本次"操作"立刻停下 (callback 还要 answerCallbackQuery 清 loading)
 *   2. 调 sendThrottledNotice(ctx, botId, tgId)
 *      内部自己判断当前是"节流"还是"封禁",决定发什么提示
 *      去重: 同一节流窗口只发一次提示; 封禁仅在刚被封时发一次
 *
 * 单进程内存实现, bot-runner 是 fork 单实例够用。定期清旧 key。
 */

const THROTTLE_MS = 3000;
const BAN_WINDOW_MS = 10_000;
const BAN_THRESHOLD = 3;          // 10s 内被节流 > 3 次 (即 >= 4 次) 触发封禁
const BAN_DURATION_MS = 30_000;
const THROTTLE_NOTICE_AUTO_DELETE_MS = 2000;

const THROTTLE_NOTICE_TEXT = '⏳ 3 秒内只能操作一次';
const BAN_NOTICE_TEXT = '你因访问频繁被封禁 30 秒,请稍后再试';

const lastClickAt = new Map<string, number>();
const throttleHits = new Map<string, number[]>();   // 节流命中时间序列
const bannedUntil = new Map<string, number>();      // 封禁结束时间(ms)
const noticedKeys = new Set<string>();              // 节流提示已发标记
const bannedNoticed = new Set<string>();            // 封禁提示已发标记

function makeKey(botId: number, telegramId: number | bigint): string {
  return `${botId}:${telegramId}`;
}

/**
 * 返回 true 表示这次点击应该被丢弃(节流命中 OR 封禁中);
 * 返回 false 表示放过 + 记下时间戳。
 *
 * 命中节流时, 顺手把这次拦截记入 throttleHits,
 * 10 秒内累计 > 3 次自动设置封禁。
 */
export function shouldThrottle(botId: number, telegramId: number | bigint): boolean {
  const key = makeKey(botId, telegramId);
  const now = Date.now();

  // 1) 封禁状态优先
  const until = bannedUntil.get(key);
  if (until !== undefined) {
    if (now < until) return true;       // 仍在封禁期
    // 封禁已过期, 清理状态进入正常流程
    bannedUntil.delete(key);
    bannedNoticed.delete(key);
  }

  // 2) 3 秒节流
  const last = lastClickAt.get(key) ?? 0;
  if (now - last < THROTTLE_MS) {
    // 记录节流命中, 滑动窗口检查是否触发封禁
    const cutoff = now - BAN_WINDOW_MS;
    const hits = (throttleHits.get(key) ?? []).filter((t) => t >= cutoff);
    hits.push(now);
    throttleHits.set(key, hits);
    if (hits.length > BAN_THRESHOLD) {
      bannedUntil.set(key, now + BAN_DURATION_MS);
      throttleHits.delete(key);
      noticedKeys.delete(key);   // 重置,以便 sendThrottledNotice 走"封禁"分支发新提示
    }
    return true;
  }

  // 3) 放过
  lastClickAt.set(key, now);
  noticedKeys.delete(key);
  return false;
}

/**
 * 给被节流 / 封禁的用户发提示, 完成后自动删除消息。
 *   - 封禁中: 发"被封禁 30 秒", 在封禁结束时刻删除。同一封禁周期只发一次。
 *   - 节流中(未封禁): 发"3 秒内只能操作一次", 2 秒后删除。同一节流窗口只发一次。
 * 失败时静默, 不影响主流程。
 */
export function sendThrottledNotice(
  ctx: Context,
  botId: number,
  telegramId: number | bigint,
): void {
  const key = makeKey(botId, telegramId);
  const now = Date.now();
  const until = bannedUntil.get(key);

  if (until !== undefined && now < until) {
    // 封禁中: 只在本封禁周期第一次拦截时发提示
    if (bannedNoticed.has(key)) return;
    bannedNoticed.add(key);
    void (async () => {
      try {
        const msg = await ctx.reply(BAN_NOTICE_TEXT);
        const remaining = Math.max(0, until - Date.now());
        setTimeout(() => {
          ctx.api.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
        }, remaining + 500); // 加 500ms 缓冲, 让用户看到"刚好解禁"
      } catch {
        /* ignore */
      }
    })();
    return;
  }

  // 节流(非封禁): 同窗口去重
  if (noticedKeys.has(key)) return;
  noticedKeys.add(key);
  void (async () => {
    try {
      const msg = await ctx.reply(THROTTLE_NOTICE_TEXT);
      setTimeout(() => {
        ctx.api.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
      }, THROTTLE_NOTICE_AUTO_DELETE_MS);
    } catch {
      /* ignore */
    }
  })();
}

// 每分钟清旧数据
setInterval(() => {
  const cutoff = Date.now() - Math.max(THROTTLE_MS * 10, BAN_DURATION_MS * 2);
  for (const [k, t] of lastClickAt) {
    if (t < cutoff) lastClickAt.delete(k);
  }
  for (const [k, until] of bannedUntil) {
    if (until < Date.now() - BAN_DURATION_MS) bannedUntil.delete(k);
  }
  for (const k of noticedKeys) {
    if (!lastClickAt.has(k)) noticedKeys.delete(k);
  }
  for (const k of bannedNoticed) {
    if (!bannedUntil.has(k)) bannedNoticed.delete(k);
  }
  for (const k of throttleHits.keys()) {
    if (!lastClickAt.has(k)) throttleHits.delete(k);
  }
}, 60_000).unref();
