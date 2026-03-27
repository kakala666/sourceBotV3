// 认证相关类型
export interface LoginInput {
  username: string;
  password: string;
}

// 登录第一步（密码验证）的响应
export interface LoginStepResult {
  // 直接登录成功（无需额外验证）
  token?: string;
  admin?: AdminInfo;
  // 需要额外验证步骤
  needCentralAuth?: boolean;
  needVerifyCode?: boolean;
  // 中央身份验证已通过时，返回验证码信息
  verifyCode?: string;
  // 用于后续验证步骤的临时凭证
  pendingToken?: string;
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
