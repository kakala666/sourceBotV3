// 认证相关类型
export interface LoginInput {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  admin: AdminInfo;
}

export interface AdminInfo {
  id: number;
  name: string;
  username: string;
  telegramId: string | null;
  canManageAccounts: boolean;
}
