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

/** presigned URL 上传:client 提交文件元信息换 PUT URL */
export interface PresignUploadRequestItem {
  originalName: string;
  mimetype: string;
  size: number;
}
export interface PresignUploadResponseItem {
  key: string;          // S3 key,例 "media/1771...-123.mp4"
  url: string;          // PUT URL,10 分钟有效
  contentType: string;  // 浏览器 PUT 时必须带相同 Content-Type
}

/** 上传完成后 client 通知 server 登记 Resource */
export interface ResourceRegisterFile {
  key: string;
  originalName: string;
  mimetype: string;
  size: number;
}
export interface ResourceRegisterInput {
  type?: string;             // 'photo' | 'video' | 'media_group',不传则按 files 推断
  caption?: string;
  groupId?: number;
  files: ResourceRegisterFile[];
}
