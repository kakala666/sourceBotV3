// 邀请链接类型
export interface InviteLinkInfo {
  id: number;
  botId: number;
  code: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface InviteLinkCreateInput {
  code: string;
  name: string;
}

export interface InviteLinkUpdateInput {
  code?: string;
  name?: string;
}
