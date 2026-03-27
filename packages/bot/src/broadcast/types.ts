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
}
