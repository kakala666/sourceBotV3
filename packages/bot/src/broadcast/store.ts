import crypto from 'crypto';
import type { BroadcastTask } from './types';

const tasks = new Map<string, BroadcastTask>();

export function generateTaskId(): string {
  const ts = Math.floor(Date.now() / 1000);
  const rand = crypto.randomBytes(2).toString('hex');
  return `bc_${ts}_${rand}`;
}

export function createTask(
  taskId: string,
  totalRecipients: number,
  botIds: number[],
): BroadcastTask {
  const task: BroadcastTask = {
    task_id: taskId,
    status: 'running',
    total_recipients: totalRecipients,
    sent_count: 0,
    success_count: 0,
    fail_count: 0,
    progress: 0,
    created_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    finished_at: null,
    bot_ids: botIds,
  };
  tasks.set(taskId, task);
  return task;
}

export function getTask(taskId: string): BroadcastTask | undefined {
  return tasks.get(taskId);
}

/**
 * 查找与给定 botIds 有交集的运行中任务。
 * 返回冲突的任务(便于错误消息携带 task_id),无冲突则返回 undefined。
 * 这允许不同 Bot 的广播并行执行。
 */
export function findConflictingTask(botIds: number[]): BroadcastTask | undefined {
  const target = new Set(botIds);
  for (const task of tasks.values()) {
    if (task.status !== 'running') continue;
    if (task.bot_ids.some((id) => target.has(id))) {
      return task;
    }
  }
  return undefined;
}

export function updateTask(taskId: string, update: Partial<BroadcastTask>) {
  const task = tasks.get(taskId);
  if (!task) return;
  Object.assign(task, update);
  if (task.total_recipients > 0) {
    task.progress = Math.round((task.sent_count / task.total_recipients) * 1000) / 10;
  }
}
