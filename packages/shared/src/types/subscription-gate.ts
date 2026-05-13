export interface SubscriptionGateInfo {
  id: number;
  botId: number;
  isEnabled: boolean;
  promptTemplate: string | null;
  channels: SubscriptionGateChannelInfo[];
}

export interface SubscriptionGateChannelInfo {
  id: number;
  isPrivate: boolean;
  username: string | null;  // 私有频道无 username
  chatId: string;           // BigInt 序列化为 string
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
  /** 私有频道必填(用户手工提供 chat_id),公开频道不传 */
  chatId?: string;
}
