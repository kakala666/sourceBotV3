import { InlineKeyboard, type Context } from 'grammy';
import { ANTI_LOST_BUTTON, antiLostRequirementLine, type AntiLostReason } from './anti-lost-check';

export interface MissingChannel {
  /** 公开频道:@username;私有频道:null(没有 username) */
  username: string | null;
  title: string;
  inviteUrl: string;
}

const DEFAULT_TEMPLATE = '请依次订阅以下频道,然后点击「我已完成」继续:\n{channels}';

export function renderPromptText(template: string | null | undefined, missing: MissingChannel[]): string {
  const tpl = template?.trim() || DEFAULT_TEMPLATE;
  const channelsText = missing
    .map((c) => (c.username ? `• ${c.title} (@${c.username})` : `• ${c.title}`))
    .join('\n');
  return tpl.replace('{channels}', channelsText);
}

export function buildPromptKeyboard(
  missing: MissingChannel[],
  sessionId: number,
  nextIndex: number,
  callbackPrefix: string = 'check_sub',
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const c of missing) {
    kb.url(`📢 ${c.title}`, c.inviteUrl).row();
  }
  kb.text('✅ 我已完成', `${callbackPrefix}:${sessionId}:${nextIndex}`);
  return kb;
}

export async function sendSubscriptionPrompt(
  ctx: Context,
  template: string | null | undefined,
  sessionId: number,
  nextIndex: number,
  missing: MissingChannel[],
  callbackPrefix: string = 'check_sub',
) {
  const text = renderPromptText(template, missing);
  const reply_markup = buildPromptKeyboard(missing, sessionId, nextIndex, callbackPrefix);
  await ctx.reply(text, { reply_markup });
}

/**
 * 合并 gate 提示:把「防失联机器人」与「未订阅频道」放进同一条消息,
 * 用一个「✅ 我已完成」统一复核。任一未通过都用它,避免两道检查互相遮挡
 * (例如缺机器人时频道列表发不出来,用户无从订阅)。
 *
 * antiLostReason 为 null 表示防失联已通过(只展示频道);missing 为空表示
 * 频道已通过(只展示机器人)。两者至少有一个非空时才应调用本函数。
 */
export function renderGateText(
  template: string | null | undefined,
  missing: MissingChannel[],
  antiLostReason: AntiLostReason | null,
): string {
  const parts: string[] = [];
  if (antiLostReason) parts.push(antiLostRequirementLine(antiLostReason));
  if (missing.length > 0) parts.push(renderPromptText(template, missing));
  return parts.join('\n\n');
}

export function buildGateKeyboard(
  missing: MissingChannel[],
  antiLostReason: AntiLostReason | null,
  sessionId: number,
  nextIndex: number,
  callbackPrefix: string,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (antiLostReason) kb.url(ANTI_LOST_BUTTON.text, ANTI_LOST_BUTTON.url).row();
  for (const c of missing) {
    kb.url(`📢 ${c.title}`, c.inviteUrl).row();
  }
  kb.text('✅ 我已完成', `${callbackPrefix}:${sessionId}:${nextIndex}`);
  return kb;
}

export async function sendGatePrompt(
  ctx: Context,
  template: string | null | undefined,
  sessionId: number,
  nextIndex: number,
  missing: MissingChannel[],
  antiLostReason: AntiLostReason | null,
  callbackPrefix: string = 'check_sub',
) {
  const text = renderGateText(template, missing, antiLostReason);
  const reply_markup = buildGateKeyboard(missing, antiLostReason, sessionId, nextIndex, callbackPrefix);
  await ctx.reply(text, { reply_markup });
}
