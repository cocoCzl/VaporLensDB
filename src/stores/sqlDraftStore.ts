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
import { useUiStore } from '@/stores/uiStore'
import type { EditorTab } from '@/stores/editorStore'
import type { ConnectionConfig } from '@/types/connection'
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
  ) => Promise<SqlDraft | null>
  markClosed: (id: string) => Promise<void>
  removeDraft: (id: string) => Promise<void>
  clear: () => Promise<void>
}

export interface SqlDraftSaveContext {
  connection?: ConnectionConfig | null
  database?: string | null
  schema?: string | null
}

function notifyError(error: unknown, title: string) {
  useUiStore.getState().notifyError(normalizeAppError(error), title)
}

export const useSqlDraftStore = create<SqlDraftState>((set, get) => ({
  drafts: [],
  loading: false,
  error: null,
  loadDrafts: async (limit = 50) => {
    set({ loading: true, error: null })
    try {
      const drafts = await listSqlDrafts(limit)
      set({ drafts, loading: false })
    } catch (error) {
      const appError = normalizeAppError(error)
      set({ error: appError.message, loading: false })
      notifyError(error, i18n.t('notifications.loadSqlDraftsFailed'))
    }
  },
  saveTabDraft: async (tab, context, closed = false) => {
    if (tab.kind && tab.kind !== 'sql') return null
    if (!tab.sql.trim()) {
      if (tab.draftId) {
        await get().removeDraft(tab.draftId)
      }
      return null
    }

    try {
      const saved = await upsertSqlDraft({
        id: tab.draftId ?? null,
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
      return saved
    } catch (error) {
      notifyError(error, i18n.t('notifications.saveSqlDraftFailed'))
      return null
    }
  },
  markClosed: async (id) => {
    try {
      await markSqlDraftClosed(id)
      await get().loadDrafts()
    } catch (error) {
      notifyError(error, i18n.t('notifications.saveSqlDraftFailed'))
    }
  },
  removeDraft: async (id) => {
    try {
      await deleteSqlDraft(id)
      set((state) => ({ drafts: state.drafts.filter((draft) => draft.id !== id) }))
    } catch (error) {
      notifyError(error, i18n.t('notifications.deleteSqlDraftFailed'))
    }
  },
  clear: async () => {
    set({ loading: true, error: null })
    try {
      await clearSqlDrafts()
      set({ drafts: [], loading: false })
    } catch (error) {
      set({ loading: false, error: normalizeAppError(error).message })
      notifyError(error, i18n.t('notifications.deleteSqlDraftFailed'))
      throw error
    }
  },
}))
