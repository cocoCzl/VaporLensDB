export type TaskStatus =
  | 'pending'
  | 'running'
  | 'cancelling'
  | 'cancelled'
  | 'succeeded'
  | 'failed'

export type MetadataIndexStage = 'starting' | 'databases' | 'schemas' | 'tables' | 'tableColumns' | 'views' | 'viewColumns' | 'functions' | 'finalizing'

export interface MetadataIndexProgress {
  current: number
  total: number | null
  stage: MetadataIndexStage
  connectionName: string
  schemaName: string | null
  objectName: string | null
  objectCurrent: number | null
  objectTotal: number | null
}

export interface TaskProgress {
  current: number
  total?: number | null
  message?: string | null
  metadata?: MetadataIndexProgress | null
  metadataCapacityReached?: boolean | null
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
  outputPath?: string | null
  createdAt: string
  updatedAt: string
  finishedAt?: string | null
}
