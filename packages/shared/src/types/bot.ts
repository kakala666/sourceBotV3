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
