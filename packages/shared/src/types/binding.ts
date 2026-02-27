// 内容绑定和广告绑定类型
export interface AdButton {
  text: string;
  url: string;
}

export interface ContentBindingInfo {
  id: number;
  inviteLinkId: number;
  resourceId: number;
  sortOrder: number;
  resource?: import('./resource').ResourceInfo;
}

export interface AdBindingInfo {
  id: number;
  inviteLinkId: number;
  resourceId: number;
  sortOrder: number;
  buttons: AdButton[] | null;
  resource?: import('./resource').ResourceInfo;
}

export interface ContentBindingBatchInput {
  items: { resourceId: number; sortOrder: number }[];
}

export interface AdBindingBatchInput {
  items: {
    resourceId: number;
    sortOrder: number;
    buttons?: AdButton[];
  }[];
}
