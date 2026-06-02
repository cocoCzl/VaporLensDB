import { invokeCommand } from '@/ipc/client'
import type { CreateQueryHistoryInput, QueryHistoryEntry } from '@/types/queryHistory'

export function addQueryHistory(input: CreateQueryHistoryInput) {
  return invokeCommand<QueryHistoryEntry>('add_query_history', { input })
}

export function listQueryHistory(limit = 200) {
  return invokeCommand<QueryHistoryEntry[]>('list_query_history', { limit })
}

export function clearQueryHistory() {
  return invokeCommand<void>('clear_query_history')
}
