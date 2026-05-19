// Bot 相关类型
export interface BotInfo {
  id: number;
  token: string;
  name: string;
  username: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BotCreateInput {
  token: string;
  name: string;
}

export interface BotUpdateInput {
  token?: string;
  name?: string;
  isActive?: boolean;
}

/** 每天 0 点定时同步:从 targetBot 同名链接拉 ContentBinding 覆盖本 bot 同名链接 */
export interface BotAutoSyncConfigInfo {
  botId: number;
  enabled: boolean;
  targetBotId: number | null;
  targetBotName?: string | null;
  lastSyncAt: string | null;
  lastSyncStatus: 'success' | 'failed' | 'partial' | null;
  lastSyncMessage: string | null;
}

export interface BotAutoSyncConfigUpdateInput {
  enabled: boolean;
  targetBotId: number | null;
}
