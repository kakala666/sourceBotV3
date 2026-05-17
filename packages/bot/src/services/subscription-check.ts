import type { Api } from 'grammy';
import realPrisma from '../prisma';

export interface ChannelCfg {
  id: number;
  chatId: bigint;
  username: string;
  title: string;
  inviteUrl: string;
  status: string;
}

export interface GateConfig {
  isEnabled: boolean;
  promptTemplate: string | null;
  channels: ChannelCfg[];
}

export type CheckResult =
  | { ok: true }
  | { ok: false; missing: { username: string; title: string; inviteUrl: string }[] };

// key 为 inviteLinkId
let configCache = new Map<number, GateConfig>();
let prismaRef: any = realPrisma;

/** 仅供测试使用 */
export function _setCacheForTests(c: Map<number, GateConfig>) { configCache = c; }
/** 仅供测试使用 */
export function _setPrismaForTests(p: any) { prismaRef = p; }

export async function reloadAllGateConfigs(): Promise<void> {
  const gates = await prismaRef.subscriptionGate.findMany({
    include: { channels: { orderBy: { sortOrder: 'asc' } } },
  });
  const next = new Map<number, GateConfig>();
  for (const g of gates) {
    next.set(g.inviteLinkId, {
      isEnabled: g.isEnabled,
      promptTemplate: g.promptTemplate,
      channels: g.channels.map((c: any) => ({
        id: c.id,
        chatId: c.chatId,
        username: c.username,
        title: c.title,
        inviteUrl: c.inviteUrl,
        status: c.status,
      })),
    });
  }
  configCache = next;
}

export function getGateConfig(inviteLinkId: number): GateConfig | undefined {
  return configCache.get(inviteLinkId);
}

function isMember(status: string): boolean {
  return status === 'creator' || status === 'administrator' || status === 'member';
}

function classifyApiError(err: any): 'bot_not_admin' | 'channel_gone' | 'transient' {
  const msg: string = (err?.message || '').toLowerCase();
  if (msg.includes('not a member') || msg.includes('forbidden') || msg.includes('bot is not')) return 'bot_not_admin';
  if (msg.includes('chat not found') || msg.includes('chat_not_found')) return 'channel_gone';
  return 'transient';
}

/**
 * 每次翻页都调 Telegram API 检查订阅状态(不使用缓存)。
 * 用户当天退订也能立刻被拦截,代价是每次翻页 N 次 API 调用。
 */
export async function ensureSubscribed(inviteLinkId: number, telegramId: bigint, botApi: Api): Promise<CheckResult> {
  const config = configCache.get(inviteLinkId);
  if (!config?.isEnabled) return { ok: true };

  const missing: { username: string; title: string; inviteUrl: string }[] = [];

  for (const channel of config.channels) {
    if (channel.status !== 'ok') continue;

    try {
      const member = await botApi.getChatMember(channel.chatId.toString() as any, Number(telegramId));
      if (!isMember(member.status)) {
        missing.push({ username: channel.username, title: channel.title, inviteUrl: channel.inviteUrl });
      }
    } catch (err: any) {
      const kind = classifyApiError(err);
      if (kind === 'transient') {
        console.error(`[gate] api_error inviteLinkId=${inviteLinkId} channelId=${channel.id} err=${err.message}`);
      } else {
        channel.status = kind;
        await prismaRef.subscriptionGateChannel.update({
          where: { id: channel.id },
          data: { status: kind, lastCheckAt: new Date() },
        });
      }
    }
  }

  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
