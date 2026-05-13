import { InlineKeyboard, type Context } from 'grammy';

export interface MissingChannel {
  username: string;
  title: string;
  inviteUrl: string;
}

const DEFAULT_TEMPLATE = '请先订阅以下频道,然后点击「我已完成」继续:\n{channels}';

export function renderPromptText(template: string | null | undefined, missing: MissingChannel[]): string {
  const tpl = template?.trim() || DEFAULT_TEMPLATE;
  const channelsText = missing.map((c) => `• ${c.title} (@${c.username})`).join('\n');
  return tpl.replace('{channels}', channelsText);
}

export function buildPromptKeyboard(
  missing: MissingChannel[],
  sessionId: number,
  nextIndex: number
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const c of missing) {
    kb.url(`📢 ${c.title}`, c.inviteUrl).row();
  }
  kb.text('✅ 我已完成', `check_sub:${sessionId}:${nextIndex}`);
  return kb;
}

export async function sendSubscriptionPrompt(
  ctx: Context,
  template: string | null | undefined,
  sessionId: number,
  nextIndex: number,
  missing: MissingChannel[]
) {
  const text = renderPromptText(template, missing);
  const reply_markup = buildPromptKeyboard(missing, sessionId, nextIndex);
  await ctx.reply(text, { reply_markup });
}
