import { getSystemSetting } from './content';
import { extractFileId } from './media-fileid';

/**
 * 频道即存储:用 forwardMessage 把来源频道里的某条 media 转发到中转群,
 * 从返回的 Message 抓"本 bot 视角"的 file_id,缓存后删除中转消息。
 * 转发是 Telegram 内部引用(不传文件本体),极快、零磁盘。
 */

// 中转群 id 缓存(字符串形态的 BigInt)。undefined=未读过,null=未配置。
let relayGroupIdCache: string | null | undefined = undefined;

export async function getRelayGroupId(): Promise<string | null> {
  if (relayGroupIdCache !== undefined) return relayGroupIdCache;
  const v = await getSystemSetting<string | null>('relayGroupId', null);
  relayGroupIdCache = v ? String(v) : null;
  return relayGroupIdCache;
}

/** 测试用:直接注入缓存,跳过 DB */
export function _setRelayGroupIdCacheForTests(v: string | null) {
  relayGroupIdCache = v;
}

/** 串行队列:所有 forward 排队执行,避免并发触发 429 */
let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(() => {}, () => {});
  return run as Promise<T>;
}

const MAX_RETRY = 3;
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface RelayApi {
  forwardMessage(chatId: string | number, fromChatId: string | number, messageId: number, ...args: any[]): Promise<any>;
  deleteMessage(chatId: string | number, messageId: number, ...args: any[]): Promise<any>;
}

/**
 * 转发抓 file_id。失败(非 429 / 重试耗尽 / 未配置中转群)返回 null,由调用方回退或标错。
 * media_group 每条 media 是独立 message,调用方逐条调用本函数。
 */
export async function fetchFileIdViaRelay(
  api: RelayApi,
  sourceChatId: bigint,
  sourceMessageId: number,
  type: string,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<string | null> {
  const relayGroupId = await getRelayGroupId();
  if (!relayGroupId) return null;

  return serialize(async () => {
    for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
      try {
        const fwd: any = await api.forwardMessage(
          relayGroupId,
          Number(sourceChatId),
          sourceMessageId,
        );
        const fileId = extractFileId(fwd, type);
        // 清理中转消息(失败忽略,不阻塞)
        if (fwd?.message_id != null) {
          Promise.resolve(api.deleteMessage(relayGroupId, fwd.message_id)).catch(() => {});
        }
        return fileId;
      } catch (err: any) {
        const retryAfter =
          err?.parameters?.retry_after ?? err?.error?.parameters?.retry_after;
        if (retryAfter && attempt < MAX_RETRY) {
          await sleep((Number(retryAfter) + 1) * 1000);
          continue;
        }
        console.error(
          `[relay] forward 抓 file_id 失败 chat=${sourceChatId} msg=${sourceMessageId}:`,
          err?.message || err,
        );
        return null;
      }
    }
    return null;
  });
}
