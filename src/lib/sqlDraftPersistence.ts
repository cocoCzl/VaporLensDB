import type { ConnectionConfig } from '@/types/connection'
import type { EditorTab } from '@/stores/editorStore'
import type { SqlDraft } from '@/types/sqlDraft'

export interface SqlDraftSaveContext {
  connection?: ConnectionConfig | null
  database?: string | null
  schema?: string | null
}

/** A whitespace-only editor is an explicitly cleared SQL draft. */
export function isEmptySqlDraft(sql: string): boolean {
  return sql.trim().length === 0
}

export type SqlDraftPersistenceResult =
  | { kind: 'saved'; draft: SqlDraft }
  | { kind: 'cleared' }

interface PersistDirtySqlDraftsInput {
  tabs: EditorTab[]
  connections: ConnectionConfig[]
  saveTabDraft: (
    tab: EditorTab,
    context: SqlDraftSaveContext,
  ) => Promise<SqlDraftPersistenceResult | null>
  completeTabPersistence: (tabId: string, draftId: string | null) => void
}

/**
 * Persists only dirty SQL tabs after the caller's debounce. A cleared tab is
 * meaningful state: its prior native draft must be removed before dirty clears.
 */
export async function persistDirtySqlDrafts({
  tabs,
  connections,
  saveTabDraft,
  completeTabPersistence,
}: PersistDirtySqlDraftsInput): Promise<void> {
  for (const tab of tabs) {
    if ((tab.kind && tab.kind !== 'sql') || !tab.dirty) continue

    const connection = connections.find((item) => item.id === tab.connectionId) ?? null
    const result = await saveTabDraft(tab, {
      connection,
      database: tab.database ?? connection?.database ?? null,
      schema: tab.schema ?? null,
    })

    if (!result) continue
    completeTabPersistence(tab.id, result.kind === 'saved' ? result.draft.id : null)
  }
}
