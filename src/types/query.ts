export interface ColumnMeta {
  name: string
  dataType: string
  nullable: boolean
}

export interface QueryResult {
  columns: ColumnMeta[]
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
}

export interface ExecuteQueryResponse {
  queryId?: string | null
  results: QueryResult[]
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
