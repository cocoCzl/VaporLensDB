import { invokeCommand } from '@/ipc/client'
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

export function executeQuery(input: ExecuteQueryInput) {
  return invokeCommand<ExecuteQueryResponse>('execute_query', { input })
}

export function executeQueryStream(input: ExecuteQueryStreamInput) {
  return invokeCommand<void>('execute_query_stream', { input })
}

export function explainQuery(connectionId: string, sql: string) {
  return invokeCommand<ExplainResult>('explain_query', { connectionId, sql })
}

export function cancelQuery(connectionId: string, queryId: string) {
  return invokeCommand<void>('cancel_query', { connectionId, queryId })
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
