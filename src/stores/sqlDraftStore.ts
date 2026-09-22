import { create } from 'zustand'
import i18n from '@/i18n'
import {
  deleteSqlDraft,
  clearSqlDrafts,
  listSqlDrafts,
  markSqlDraftClosed,
  upsertSqlDraft,
} from '@/ipc/sqlDraft'
import { normalizeAppError } from '@/ipc/client'
import {
  isEmptySqlDraft,
  type SqlDraftPersistenceResult,
  type SqlDraftSaveContext,
} from '@/lib/sqlDraftPersistence'
import { useUiStore } from '@/stores/uiStore'
import { useEditorStore, type EditorTab } from '@/stores/editorStore'
import type { SqlDraft } from '@/types/sqlDraft'

interface SqlDraftState {
  drafts: SqlDraft[]
  loading: boolean
  error: string | null
  loadDrafts: (limit?: number) => Promise<void>
  saveTabDraft: (
    tab: EditorTab,
    context: SqlDraftSaveContext,
    closed?: boolean,
  ) => Promise<SqlDraftPersistenceResult | null>
  markClosed: (id: string) => Promise<void>
  removeDraft: (id: string) => Promise<boolean>
  clear: () => Promise<void>
}

export type { SqlDraftSaveContext } from '@/lib/sqlDraftPersistence'

function notifyError(error: unknown, title: string) {
  useUiStore.getState().notifyError(normalizeAppError(error), title)
}

// Serialize this small local-storage workload, including destructive operations
// and reads. Rejections must not poison the queue for subsequent saves.
let persistenceTail: Promise<unknown> = Promise.resolve()
let pendingOperations = 0
const pendingDraftIds = new Map<string, string | null>()
function serializePersistence<T>(operation: () => Promise<T>): Promise<T> {
  pendingOperations += 1
  const result = persistenceTail.then(operation)
  persistenceTail = result.catch(() => undefined)
  return result.finally(() => {
    pendingOperations -= 1
    if (pendingOperations === 0) pendingDraftIds.clear()
  })
}

export const useSqlDraftStore = create<SqlDraftState>((set) => ({
  drafts: [],
  loading: false,
  error: null,
  loadDrafts: (limit = 50) => serializePersistence(async () => {
    set({ loading: true, error: null })
    try {
      const drafts = await listSqlDrafts(limit)
      set({ drafts, loading: false })
    } catch (error) {
      const appError = normalizeAppError(error)
      set({ error: appError.message, loading: false })
      notifyError(error, i18n.t('notifications.loadSqlDraftsFailed'))
    }
  }),
  saveTabDraft: (tab, context, closed = false) => serializePersistence(async () => {
    if (tab.kind && tab.kind !== 'sql') return null
    const current = useEditorStore.getState().tabs.find((item) => item.id === tab.id)
    // Late autosaves must not recreate a closed draft or undo its closed marker.
    if (!current || (current.closing && !closed)) return null
    // A delayed autosave snapshot must never overwrite a newer edit.
    if (current && (current.draftRevision ?? 0) !== (tab.draftRevision ?? 0)) return null
    const draftId = pendingDraftIds.has(tab.id)
      ? pendingDraftIds.get(tab.id)
      : current?.draftId ?? tab.draftId
    if (isEmptySqlDraft(tab.sql)) {
      try {
        if (draftId) {
          await deleteSqlDraft(draftId)
          set((state) => ({ drafts: state.drafts.filter((draft) => draft.id !== draftId) }))
        }
      } catch (error) {
        notifyError(error, i18n.t('notifications.deleteSqlDraftFailed'))
        return null
      }
      pendingDraftIds.set(tab.id, null)
      useEditorStore.getState().setTabDraft(tab.id, null, tab.draftRevision ?? 0)
      return { kind: 'cleared' }
    }

    try {
      const saved = await upsertSqlDraft({
        id: draftId ?? null,
        connectionId: tab.connectionId,
        connectionNameSnapshot: context.connection?.name ?? null,
        database: context.database ?? null,
        schema: context.schema ?? null,
        title: tab.title,
        sql: tab.sql,
        closed,
      })
      set((state) => ({
        drafts: [saved, ...state.drafts.filter((draft) => draft.id !== saved.id)].slice(0, 50),
      }))
      pendingDraftIds.set(tab.id, saved.id)
      useEditorStore.getState().setTabDraft(tab.id, saved.id, tab.draftRevision ?? 0)
      return { kind: 'saved', draft: saved }
    } catch (error) {
      notifyError(error, i18n.t('notifications.saveSqlDraftFailed'))
      return null
    }
  }),
  markClosed: (id) => serializePersistence(async () => {
    try {
      await markSqlDraftClosed(id)
      const drafts = await listSqlDrafts(50)
      set({ drafts })
    } catch (error) {
      notifyError(error, i18n.t('notifications.saveSqlDraftFailed'))
    }
  }),
  removeDraft: (id) => serializePersistence(async () => {
    try {
      await deleteSqlDraft(id)
      set((state) => ({ drafts: state.drafts.filter((draft) => draft.id !== id) }))
      return true
    } catch (error) {
      notifyError(error, i18n.t('notifications.deleteSqlDraftFailed'))
      return false
    }
  }),
  clear: () => serializePersistence(async () => {
    set({ loading: true, error: null })
    try {
      await clearSqlDrafts()
      set({ drafts: [], loading: false })
    } catch (error) {
      set({ loading: false, error: normalizeAppError(error).message })
      notifyError(error, i18n.t('notifications.deleteSqlDraftFailed'))
      throw error
    }
  }),
}))
