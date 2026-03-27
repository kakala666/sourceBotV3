export interface AdminCreateInput {
  name: string;
  username: string;
  password: string;
  telegramId?: string;
  canManageAccounts?: boolean;
}

export interface AdminUpdateInput {
  name?: string;
  username?: string;
  password?: string;
  telegramId?: string | null;
  canManageAccounts?: boolean;
}
