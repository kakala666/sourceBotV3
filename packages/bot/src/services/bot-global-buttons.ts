import prisma from '../prisma';

/**
 * Bot 全局按钮缓存。每条常规资源(链接派发/随便看看/收藏列表)在 buildContentKeyboard
 * 时会插入这些按钮 — 位置:资源自己的 URL 按钮之后,「🔽 展开更多」之前。
 *
 * 启动 + .bot-reload 信号 触发刷新。
 */

type Button = { text: string; url: string };
let cache = new Map<number, Button[]>();

export function _setForTests(c: Map<number, Button[]>) { cache = c; }

export function getGlobalButtons(botId: number): Button[] {
  return cache.get(botId) ?? [];
}

export async function reloadGlobalButtons(): Promise<void> {
  const bots = await prisma.bot.findMany({ select: { id: true, globalButtons: true } });
  const next = new Map<number, Button[]>();
  for (const b of bots) {
    const arr = (b.globalButtons ?? []) as any;
    if (!Array.isArray(arr)) continue;
    const sanitized: Button[] = arr
      .filter((x: any) => x && typeof x.text === 'string' && typeof x.url === 'string')
      .map((x: any) => ({ text: String(x.text).trim(), url: String(x.url).trim() }))
      .filter((x: Button) => x.text && x.url);
    if (sanitized.length > 0) next.set(b.id, sanitized);
  }
  cache = next;
}
