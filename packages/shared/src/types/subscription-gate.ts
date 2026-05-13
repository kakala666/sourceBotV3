export interface SubscriptionGateInfo {
  id: number;
  botId: number;
  isEnabled: boolean;
  promptTemplate: string | null;
  channels: SubscriptionGateChannelInfo[];
}

export interface SubscriptionGateChannelInfo {
  id: number;
  username: string;
  chatId: string;        // BigInt 序列化为 string
  title: string;
  inviteUrl: string;
  sortOrder: number;
  status: 'ok' | 'bot_not_admin' | 'channel_gone';
  lastCheckAt: string;
}

export interface SubscriptionGateUpdateInput {
  isEnabled?: boolean;
  promptTemplate?: string | null;
}

export interface SubscriptionGateChannelCreateInput {
  inviteUrl: string;
}
