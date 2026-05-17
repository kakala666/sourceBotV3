/**
 * 向 bot 进程的内部 HTTP API 发起"主动推送资源"请求。
 * 失败仅记录日志,不影响本次后台请求成功。
 */

export interface NotifyRecipient {
  botId: number;
  telegramId: string;
}

export async function notifyResource(
  resourceId: number,
  recipients: NotifyRecipient[],
  prefixText?: string,
): Promise<void> {
  if (recipients.length === 0) return;

  const port = process.env.BROADCAST_PORT || '8080';
  const apiKey = process.env.BROADCAST_API_KEY;
  if (!apiKey) {
    console.error('[notify-resource client] BROADCAST_API_KEY 未配置,跳过推送');
    return;
  }

  try {
    const res = await fetch(`http://localhost:${port}/api/notify-resource`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({ resourceId, recipients, prefixText }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[notify-resource client] http ${res.status}:`, text);
    }
  } catch (err: any) {
    console.error('[notify-resource client] fetch error:', err.message);
  }
}
