// 认证相关类型
export interface LoginInput {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  admin: {
    id: number;
    username: string;
  };
}

export interface AdminInfo {
  id: number;
  username: string;
}
