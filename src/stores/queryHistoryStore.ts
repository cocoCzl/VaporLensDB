import { create } from 'zustand'
import i18n from '@/i18n'
import { addQueryHistory, clearQueryHistory, listQueryHistory } from '@/ipc/queryHistory'
import { normalizeAppError } from '@/ipc/client'
import { useUiStore } from '@/stores/uiStore'
import type { CreateQueryHistoryInput, QueryHistoryEntry } from '@/types/queryHistory'

interface QueryHistoryState {
  entries: QueryHistoryEntry[]
  loading: boolean
  error: string | null
  loadHistory: (limit?: number) => Promise<void>
  addEntry: (entry: CreateQueryHistoryInput) => Promise<void>
  clear: () => Promise<boolean>
}

function notifyError(error: unknown, title: string) {
  useUiStore.getState().notifyError(normalizeAppError(error), title)
}

export const useQueryHistoryStore = create<QueryHistoryState>((set, get) => ({
  entries: [],
  loading: false,
  error: null,
  loadHistory: async (limit = 500) => {
    set({ loading: true, error: null })
    try {
      const entries = await listQueryHistory(limit)
      set({ entries, loading: false })
    } catch (error) {
      const appError = normalizeAppError(error)
      set({ error: appError.message, loading: false })
      notifyError(error, i18n.t('notifications.loadQueryHistoryFailed'))
    }
  },
  addEntry: async (entry) => {
    try {
      const saved = await addQueryHistory(entry)
      set((state) => ({ entries: [saved, ...state.entries].slice(0, 500) }))
    } catch (error) {
      notifyError(error, i18n.t('notifications.saveQueryHistoryFailed'))
      await get().loadHistory()
    }
  },
  clear: async () => {
    set({ loading: true, error: null })
    try {
      await clearQueryHistory()
      set({ entries: [], loading: false })
      return true
    } catch (error) {
      const appError = normalizeAppError(error)
      set({ error: appError.message, loading: false })
      notifyError(error, i18n.t('notifications.clearQueryHistoryFailed'))
      return false
    }
  },
}))
