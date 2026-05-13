import type { Api } from 'grammy';
import realPrisma from '../prisma';
import { formatShanghaiDate } from './local-date';

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
    next.set(g.botId, {
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

export function getGateConfig(botId: number): GateConfig | undefined {
  return configCache.get(botId);
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

export async function ensureSubscribed(botId: number, telegramId: bigint, botApi: Api): Promise<CheckResult> {
  const config = configCache.get(botId);
  if (!config?.isEnabled) return { ok: true };

  const today = formatShanghaiDate();

  const cached = await prismaRef.subscriptionCheckPass.findUnique({
    where: { botId_telegramId_passDate: { botId, telegramId, passDate: today } },
  });
  if (cached) return { ok: true };

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
        console.error(`[gate] api_error botId=${botId} channelId=${channel.id} err=${err.message}`);
      } else {
        channel.status = kind;
        await prismaRef.subscriptionGateChannel.update({
          where: { id: channel.id },
          data: { status: kind, lastCheckAt: new Date() },
        });
      }
    }
  }

  if (missing.length === 0) {
    await prismaRef.subscriptionCheckPass.upsert({
      where: { botId_telegramId_passDate: { botId, telegramId, passDate: today } },
      create: { botId, telegramId, passDate: today },
      update: {},
    });
    return { ok: true };
  }

  return { ok: false, missing };
}
