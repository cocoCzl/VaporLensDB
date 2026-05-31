import { create } from 'zustand'

export interface EditorTab {
  id: string
  title: string
  sql: string
  connectionId: string | null
  lastQueryId?: string | null
  runningQueryId?: string | null
  running?: boolean
  error?: string | null
}

interface EditorState {
  tabs: EditorTab[]
  activeTabId: string | null
  setActiveTab: (id: string) => void
  addTab: (tab: EditorTab) => void
  ensureTab: (connectionId: string | null) => string
  updateTabSql: (id: string, sql: string) => void
  updateTabConnection: (id: string, connectionId: string | null) => void
  setTabRunning: (id: string, running: boolean, queryId?: string | null) => void
  setTabQueryState: (id: string, queryId: string | null, error?: string | null) => void
  closeTab: (id: string) => void
}

export const useEditorStore = create<EditorState>((set) => ({
  tabs: [],
  activeTabId: null,
  setActiveTab: (id) => set({ activeTabId: id }),
  addTab: (tab) => set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id })),
  ensureTab: (connectionId) => {
    const id = crypto.randomUUID()
    set((state) => {
      if (state.tabs.length > 0) {
        return state
      }
      return {
        tabs: [
          {
            id,
            title: 'SQL 1',
            sql: 'SELECT 1 AS value;',
            connectionId,
          },
        ],
        activeTabId: id,
      }
    })
    return id
  },
  updateTabSql: (id, sql) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, sql } : t)) })),
  updateTabConnection: (id, connectionId) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, connectionId } : t)),
    })),
  setTabRunning: (id, running, queryId) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id
          ? {
              ...t,
              running,
              lastQueryId: queryId ?? t.lastQueryId,
              runningQueryId: running ? queryId ?? null : null,
            }
          : t,
      ),
    })),
  setTabQueryState: (id, queryId, error = null) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id
          ? { ...t, lastQueryId: queryId, runningQueryId: null, error, running: false }
          : t,
      ),
    })),
  closeTab: (id) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id)
      return { tabs, activeTabId: tabs.at(-1)?.id ?? null }
    }),
}))
