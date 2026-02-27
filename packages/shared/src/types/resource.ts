// 资源相关类型
export type ResourceType = 'photo' | 'video' | 'media_group';
export type MediaFileType = 'photo' | 'video';

export interface ResourceInfo {
  id: number;
  groupId: number | null;
  type: ResourceType;
  caption: string | null;
  createdAt: string;
  updatedAt: string;
  mediaFiles: MediaFileInfo[];
  group?: ResourceGroupInfo | null;
}

export interface MediaFileInfo {
  id: number;
  resourceId: number;
  type: MediaFileType;
  filePath: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  sortOrder: number;
}

export interface ResourceGroupInfo {
  id: number;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceGroupCreateInput {
  name: string;
  sortOrder?: number;
}
