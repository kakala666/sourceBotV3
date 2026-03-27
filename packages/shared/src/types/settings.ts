// 自动回复广告配置
export interface AutoReplyAdConfig {
  enabled: boolean;
  text: string;
}

// 系统设置类型
export interface SystemSettings {
  endContent: {
    text: string;
    buttons?: { text: string; url: string }[];
  };
  adDisplaySeconds: number;
  statsGroupId: string;
  autoReplyAd: AutoReplyAdConfig;
}
