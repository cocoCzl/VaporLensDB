import { create } from 'zustand'
import type { DataTabSortDirection } from '@/lib/dataTabSql'
import type { DbObjectKind } from '@/types/metadata'

export interface EditorTab {
  id: string
  kind?:
    | 'sql'
    | 'data'
    | 'structure'
    | 'definition'
    | 'diagram'
    | 'dataSources'
    | 'settings'
    | 'objectSummary'
  title: string
  sql: string
  connectionId: string | null
  dataContext?: DataTabContext | null
  structureContext?: StructureTabContext | null
  definitionContext?: DefinitionTabContext | null
  diagramContext?: DiagramTabContext | null
  objectSummaryContext?: ObjectSummaryContext | null
  tableContext?: TableEditContext | null
  lastQueryId?: string | null
  runningQueryId?: string | null
  running?: boolean
  error?: string | null
}

export interface DataTabContext {
  database?: string | null
  schema: string
  object: string
  objectKind: 'table' | 'view' | 'materializedView'
  driverType: TableEditContext['driverType']
  limit: number
  offset: number
  wherePredicate?: string | null
  sortColumn?: string | null
  sortDirection?: DataTabSortDirection | null
  primaryKeyColumns: string[]
}

export interface StructureTabContext {
  database?: string | null
  schema: string
  object: string
  objectKind: 'table' | 'view' | 'materializedView'
}

export interface DefinitionTabContext {
  database?: string | null
  schema: string
  object: string
  objectKind: DbObjectKind
  definitionKind: 'DDL' | 'Source'
  operation: 'tableDdl' | 'objectDdl'
}

export interface DiagramTabContext {
  database?: string | null
  schema: string
  tables?: string[] | null
}

export interface ObjectSummaryContext {
  database?: string | null
  schema: string
  object: string
  objectKind: 'table' | 'view' | 'materializedView'
  driverType: TableEditContext['driverType']
}

export interface TableEditContext {
  schema: string
  table: string
  driverType: 'postgres' | 'mysql' | 'oracle' | 'sqlite' | 'mssql' | 'mongo' | 'redis' | 'jdbc'
  primaryKeyColumns: string[]
}

interface EditorState {
  tabs: EditorTab[]
  activeTabId: string | null
  setActiveTab: (id: string) => void
  addTab: (tab: EditorTab) => void
  ensureTab: (connectionId: string | null) => string
  renameTab: (id: string, title: string) => void
  updateTabSql: (id: string, sql: string) => void
  updateDataTabLimit: (id: string, limit: number, sql: string) => void
  updateDataTabContext: (id: string, dataContext: DataTabContext, sql: string) => void
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
            kind: 'sql',
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
  renameTab: (id, title) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, title: title.trim() || t.title } : t)),
    })),
  updateTabSql: (id, sql) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, sql } : t)) })),
  updateDataTabLimit: (id, limit, sql) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id && t.dataContext
          ? { ...t, sql, dataContext: { ...t.dataContext, limit } }
          : t,
      ),
    })),
  updateDataTabContext: (id, dataContext, sql) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, sql, dataContext } : t)),
    })),
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
