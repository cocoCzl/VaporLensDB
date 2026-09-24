import { invokeCommand } from '@/ipc/client'
import { COMMANDS } from '@/ipc/contracts'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  ExecuteQueryResponse,
  ExecutionSession,
  ExplainResult,
  QueryResultChunk,
  QueryStreamDone,
  QueryStreamError,
  ConsoleTransactionState,
  TransactionMode,
} from '@/types/query'

export interface ExecuteQueryInput {
  connectionId: string
  sql: string
  queryId?: string
  maxRows?: number
  consoleId?: string
  tabId?: string
  connectionName?: string
  database?: string | null
  schema?: string | null
}

export interface ExecuteQueryStreamInput {
  connectionId: string
  sql: string
  queryId: string
  chunkSize?: number
  maxRows?: number
  consoleId?: string
  tabId?: string
  connectionName?: string
  database?: string | null
  schema?: string | null
}

export type SqlRiskReason =
  | 'dropStatement'
  | 'truncateStatement'
  | 'deleteWithoutWhere'
  | 'updateWithoutWhere'
  | 'mergeStatement'
  | 'proceduralStatement'
  | 'unclassifiedStatement'

export interface SqlRiskAnalysis {
  dangerous: boolean
  status: 'safe' | 'dangerous' | 'unknown'
  reasons: SqlRiskReason[]
}

export function executeQuery(input: ExecuteQueryInput) {
  return invokeCommand<ExecuteQueryResponse>(COMMANDS.executeQuery, { input })
}

export function executeQueryStream(input: ExecuteQueryStreamInput) {
  return invokeCommand<ExecutionSession>(COMMANDS.executeQueryStream, { input })
}

export interface ExplainQueryContext {
  queryId?: string
  consoleId?: string
  database?: string | null
  schema?: string | null
}

export function explainQuery(connectionId: string, sql: string, context: ExplainQueryContext = {}) {
  return invokeCommand<ExplainResult>(COMMANDS.explainQuery, { connectionId, sql, ...context })
}

export function cancelQuery(connectionId: string, queryId: string) {
  return invokeCommand<void>(COMMANDS.cancelQuery, { connectionId, queryId })
}

export function analyzeSqlRisk(sql: string) {
  return invokeCommand<SqlRiskAnalysis>(COMMANDS.analyzeSqlRisk, { sql })
}

export function getConsoleTransactionState(connectionId: string, consoleId: string) {
  return invokeCommand<ConsoleTransactionState>(COMMANDS.consoleTransactionState, { input: { connectionId, consoleId } })
}

export function setConsoleTransactionMode(connectionId: string, consoleId: string, mode: TransactionMode) {
  return invokeCommand<ConsoleTransactionState>(COMMANDS.setConsoleTransactionMode, { input: { connectionId, consoleId, mode } })
}

export function commitConsoleTransaction(connectionId: string, consoleId: string) {
  return invokeCommand<ConsoleTransactionState>(COMMANDS.commitConsoleTransaction, { input: { connectionId, consoleId } })
}

export function rollbackConsoleTransaction(connectionId: string, consoleId: string) {
  return invokeCommand<ConsoleTransactionState>(COMMANDS.rollbackConsoleTransaction, { input: { connectionId, consoleId } })
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

export function onConsoleTransactionUpdated(
  handler: (transaction: ConsoleTransactionState) => void,
): Promise<UnlistenFn> {
  return listen<ConsoleTransactionState>('console_transaction_updated', (event) => handler(event.payload))
}
