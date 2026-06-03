export type TaskStatus =
  | 'pending'
  | 'running'
  | 'cancelling'
  | 'cancelled'
  | 'succeeded'
  | 'failed'

export interface TaskProgress {
  current: number
  total?: number | null
  message?: string | null
}

export interface TaskLogEntry {
  at: string
  message: string
}

export interface TaskInfo {
  id: string
  kind: string
  title: string
  status: TaskStatus
  progress: TaskProgress
  logs: TaskLogEntry[]
  error?: string | null
  createdAt: string
  updatedAt: string
  finishedAt?: string | null
}

export interface StartNoopTaskInput {
  title?: string
  steps?: number
  stepDelayMs?: number
}
