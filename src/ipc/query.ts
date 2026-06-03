import { invokeCommand } from '@/ipc/client'
import { COMMANDS } from '@/ipc/contracts'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  ExecuteQueryResponse,
  ExplainResult,
  QueryResultChunk,
  QueryStreamDone,
  QueryStreamError,
} from '@/types/query'

export interface ExecuteQueryInput {
  connectionId: string
  sql: string
  queryId?: string
}

export interface ExecuteQueryStreamInput {
  connectionId: string
  sql: string
  queryId: string
  chunkSize?: number
  maxRows?: number
}

export type SqlRiskReason =
  | 'dropStatement'
  | 'truncateStatement'
  | 'deleteWithoutWhere'
  | 'updateWithoutWhere'

export interface SqlRiskAnalysis {
  dangerous: boolean
  reasons: SqlRiskReason[]
}

export function executeQuery(input: ExecuteQueryInput) {
  return invokeCommand<ExecuteQueryResponse>(COMMANDS.executeQuery, { input })
}

export function executeQueryStream(input: ExecuteQueryStreamInput) {
  return invokeCommand<void>(COMMANDS.executeQueryStream, { input })
}

export function explainQuery(connectionId: string, sql: string) {
  return invokeCommand<ExplainResult>(COMMANDS.explainQuery, { connectionId, sql })
}

export function cancelQuery(connectionId: string, queryId: string) {
  return invokeCommand<void>(COMMANDS.cancelQuery, { connectionId, queryId })
}

export function analyzeSqlRisk(sql: string) {
  return invokeCommand<SqlRiskAnalysis>(COMMANDS.analyzeSqlRisk, { sql })
}

export function onQueryResultChunk(handler: (chunk: QueryResultChunk) => void): Promise<UnlistenFn> {
  return listen<QueryResultChunk>('query_result_chunk', (event) => handler(event.payload))
}

export function onQueryResultDone(handler: (done: QueryStreamDone) => void): Promise<UnlistenFn> {
  return listen<QueryStreamDone>('query_result_done', (event) => handler(event.payload))
}

export function onQueryResultError(handler: (error: QueryStreamError) => void): Promise<UnlistenFn> {
  return listen<QueryStreamError>('query_result_error', (event) => handler(event.payload))
}
