import { type Context } from 'grammy';

/**
 * 「防失联机器人」强制关注检查
 *
 * 与频道订阅 gate 平行的一道全局检查:每次操作(翻页/展开/搜索/随便看看/收藏)
 * 都实时 GET 外部接口,仅当 started=true && blocked=false 才放行。
 *   - started=false → 提示关注防失联机器人
 *   - blocked=true  → 提示解除拉黑
 *
 * 接口异常/超时一律放行(fail-open),避免外部服务故障拖垮整个 bot。
 *
 * 提示展示与频道订阅 gate 合并到同一条消息(见 subscription-prompt.ts 的
 * sendGatePrompt),避免「缺频道又缺机器人」时频道列表被本检查挡住无法订阅。
 */

/** 总开关,设为 false 可整体下线本检查(代码保留) */
const ANTI_LOST_ENABLED = true;

const API_BASE = 'http://119.28.23.199:3001/api/public/user-status';
/** 外部系统固定 botId(与本项目 bot 无关) */
const API_BOT_ID = 'cmq3j1jop00018xuu8kto5eaq';
const REQUEST_TIMEOUT_MS = 4000;

/** 提示内联按钮:文字 + 跳转(必须带启动参数) */
export const ANTI_LOST_BUTTON = {
  text: '防失联机器人',
  url: 'https://t.me/fsl8bot?start=P1Sr7z54',
};

export type AntiLostReason = 'not_started' | 'blocked';

export type AntiLostResult =
  | { ok: true }
  | { ok: false; reason: AntiLostReason };

/**
 * 查询用户在防失联机器人处的状态。
 * 接口报错/超时/响应异常 → fail-open 返回 { ok: true }。
 */
export async function checkAntiLost(telegramId: bigint): Promise<AntiLostResult> {
  if (!ANTI_LOST_ENABLED) return { ok: true };

  const url = `${API_BASE}?botId=${API_BOT_ID}&tgid=${telegramId.toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) return { ok: true }; // fail-open
    const data: any = await resp.json();
    const started = data?.started === true;
    const blocked = data?.blocked === true;
    if (started && !blocked) return { ok: true };
    // 未启动优先提示关注;已启动但被拉黑则提示解除拉黑
    if (!started) return { ok: false, reason: 'not_started' };
    return { ok: false, reason: 'blocked' };
  } catch (err: any) {
    console.error(`[anti-lost] api_error tgid=${telegramId} err=${err?.message}`);
    return { ok: true }; // fail-open
  } finally {
    clearTimeout(timer);
  }
}

/** 合并提示里防失联那一段的说明文字 */
export function antiLostRequirementLine(reason: AntiLostReason): string {
  return reason === 'blocked'
    ? '检测到你拉黑了「防失联机器人」,请先解除拉黑并重新启动'
    : '请先关注「防失联机器人」(点击下方按钮并启动)';
}

/** 复核入口里防失联未通过时的 alert 文字 */
export function antiLostAlertText(reason: AntiLostReason): string {
  return reason === 'blocked' ? '请先解除拉黑防失联机器人后再试' : '请先关注防失联机器人后再试';
}

/**
 * 复核(check_* 处理器)里防失联未通过时,弹 alert 而非再发一条消息,避免刷屏。
 * 原合并提示消息仍在屏幕上,用户可继续点其中的按钮。
 */
export async function answerAntiLostAlert(ctx: Context, reason: AntiLostReason) {
  await ctx.answerCallbackQuery({ text: antiLostAlertText(reason), show_alert: true }).catch(() => {});
}
