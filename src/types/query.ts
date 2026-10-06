import type { AppError } from './error'
export interface ColumnMeta {
  name: string
  dataType: string
  nullable: boolean
}

export interface QueryResult {
  columns: ColumnMeta[]
  /** Native and JDBC drivers encode integers outside JS's safe range as decimal strings.
   * JDBC DECIMAL/NUMERIC values are exact text, including their scale.
   * PostgreSQL NUMERIC and JSON/JSONB are text to preserve decimal/nested-number precision.
   * SQL NULL remains null; a PostgreSQL decode failure is a query error, never a fake null.
   */
  rows: unknown[][]
  rowCount: number
  elapsedMs: number
  affectedRows: number
  queryId?: string | null
  truncated: boolean
  /** The grid discarded rows beyond its bounded in-memory visual window. */
  displayTruncated?: boolean
  maxRows?: number | null
  firstRowMs?: number | null
  receivedBytes?: number | null
  /** True only while a streamed query is awaiting its terminal completion event. */
  streaming?: boolean
  statementKind?: 'dml' | 'ddl' | 'commit' | 'rollback' | 'other'
}

export interface StatementExecutionReport {
  index: number
  preview: string
  status: 'succeeded' | 'failed' | 'cancelled' | 'notExecuted'
  elapsedMs?: number | null
  affectedRows?: number | null
  resultIndex?: number | null
  error?: AppError | null
}

export interface ExecutionReport {
  statements: StatementExecutionReport[]
  outcome: 'completed' | 'failed' | 'cancelled'
}

export interface ExecuteQueryResponse {
  queryId?: string | null
  results: QueryResult[]
  statements?: StatementExecutionReport[]
  outcome?: ExecutionReport['outcome']
  terminalError?: AppError | null
  connectionGeneration: number
}

export interface ExecutionSession {
  connectionGeneration: number
}

export interface QueryExecutionSnapshot {
  queryId: string
  sql: string
  connectionId: string
  connectionGeneration: number
  database: string | null
  schema: string | null
  consoleId: string | null
  transactionMode: TransactionMode
  executedAt: string
}

export type TransactionMode = 'auto' | 'manual'
export type TransactionPhase = 'idle' | 'active' | 'failed'
export interface ConsoleTransactionState {
  connectionId: string
  consoleId: string
  mode: TransactionMode
  phase: TransactionPhase
}

export interface QueryResultChunk {
  queryId: string
  columns: ColumnMeta[]
  rows: unknown[][]
  rowOffset: number
}

export interface QueryStreamDone {
  queryId: string
  rowCount: number
  affectedRows: number
  elapsedMs: number
  truncated: boolean
  maxRows?: number | null
  firstRowMs?: number | null
  receivedBytes: number
}

export interface QueryStreamError {
  queryId: string
  code: string
  message: string
  detail?: string | null
}

export interface ExplainResult {
  format: 'text' | 'json' | 'table'
  plan: unknown
  result?: QueryResult | null
  elapsedMs: number
}
