export type TaskStatus = 'running' | 'completed' | 'stopped' | 'failed';

export interface InlineButton {
  text: string;
  url: string;
}

export interface SendConfig {
  rate: number;
  interval: number;
  max_recipients: number;
}

export interface BroadcastRequest {
  image?: string;
  caption: string;
  buttons?: InlineButton[][];
  config: SendConfig;
  user_ids?: number[];
  /** 指定广播目标 Bot 名称(Bot 表的 name 字段)。不传 = 对所有活跃 Bot 广播。 */
  bot_name?: string;
}

export interface BroadcastTask {
  task_id: string;
  status: TaskStatus;
  total_recipients: number;
  sent_count: number;
  success_count: number;
  fail_count: number;
  progress: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  /** 本任务覆盖的 Bot ID 列表,用于按 Bot 级粒度的并发锁 */
  bot_ids: number[];
}
