// 系统设置类型
export interface SystemSettings {
  endContent: {
    text: string;
    buttons?: { text: string; url: string }[];
  };
  adDisplaySeconds: number;
  statsGroupId: string;
}
