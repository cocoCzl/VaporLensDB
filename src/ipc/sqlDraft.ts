import { invokeCommand } from '@/ipc/client'
import { COMMANDS } from '@/ipc/contracts'
import type { SqlDraft, UpsertSqlDraftInput } from '@/types/sqlDraft'

export function upsertSqlDraft(input: UpsertSqlDraftInput) {
  return invokeCommand<SqlDraft>(COMMANDS.upsertSqlDraft, { input })
}

export function listSqlDrafts(limit = 50) {
  return invokeCommand<SqlDraft[]>(COMMANDS.listSqlDrafts, { limit })
}

export function markSqlDraftClosed(id: string) {
  return invokeCommand<void>(COMMANDS.markSqlDraftClosed, { id })
}

export function deleteSqlDraft(id: string) {
  return invokeCommand<void>(COMMANDS.deleteSqlDraft, { id })
}

export function clearSqlDrafts() {
  return invokeCommand<void>(COMMANDS.clearSqlDrafts)
}
