import { create } from 'zustand'

interface EditorTab {
  id: string
  title: string
  sql: string
  connectionId: string | null
}

interface EditorState {
  tabs: EditorTab[]
  activeTabId: string | null
  setActiveTab: (id: string) => void
  addTab: (tab: EditorTab) => void
  updateTabSql: (id: string, sql: string) => void
  closeTab: (id: string) => void
}

export const useEditorStore = create<EditorState>((set) => ({
  tabs: [],
  activeTabId: null,
  setActiveTab: (id) => set({ activeTabId: id }),
  addTab: (tab) => set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id })),
  updateTabSql: (id, sql) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, sql } : t)) })),
  closeTab: (id) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id)
      return { tabs, activeTabId: tabs.at(-1)?.id ?? null }
    }),
}))