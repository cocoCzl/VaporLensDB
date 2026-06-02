import type { DriverType } from '@/types/connection'

export type QueryHistoryStatus = 'success' | 'failed'

export interface QueryHistoryEntry {
  id: string
  connectionId: string
  connectionNameSnapshot: string
  driverType: DriverType
  database?: string | null
  schema?: string | null
  sql: string
  status: QueryHistoryStatus
  startedAt: string
  elapsedMs?: number | null
  rowCount?: number | null
  affectedRows?: number | null
  errorCode?: string | null
  errorMessage?: string | null
}

export interface CreateQueryHistoryInput {
  connectionId: string
  schema?: string | null
  sql: string
  status: QueryHistoryStatus
  startedAt?: string | null
  elapsedMs?: number | null
  rowCount?: number | null
  affectedRows?: number | null
  errorCode?: string | null
  errorMessage?: string | null
}
