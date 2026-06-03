import { invokeCommand } from '@/ipc/client'
import { COMMANDS } from '@/ipc/contracts'
import type { CreateQueryHistoryInput, QueryHistoryEntry } from '@/types/queryHistory'

export function addQueryHistory(input: CreateQueryHistoryInput) {
  return invokeCommand<QueryHistoryEntry>(COMMANDS.addQueryHistory, { input })
}

export function listQueryHistory(limit = 200) {
  return invokeCommand<QueryHistoryEntry[]>(COMMANDS.listQueryHistory, { limit })
}

export function clearQueryHistory() {
  return invokeCommand<void>(COMMANDS.clearQueryHistory)
}
