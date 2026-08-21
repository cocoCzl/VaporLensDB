import { create } from 'zustand'
import { useQueryResultStore } from '@/stores/queryResultStore'
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
    | 'sqlScripts'
    | 'queryHistory'
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
  cancelling?: boolean
  error?: string | null
  draftId?: string | null
  dirty?: boolean
  pinned?: boolean
  /** Set when the saved Data Source was removed; SQL remains recoverable. */
  unavailableConnectionName?: string | null
  /** Optional initial data-source scope for the SQL records workspace. */
  recordsConnectionFilter?: string | null
}

const SQL_WORKSPACE_STORAGE_KEY = 'vaporlensdb.sqlWorkspace.v1'

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
  setTabDraft: (id: string, draftId: string | null) => void
  setRecordsConnectionFilter: (id: string, connectionId: string | null) => void
  toggleTabPinned: (id: string) => void
  setTabRunning: (id: string, running: boolean, queryId?: string | null) => void
  setTabCancelling: (id: string, cancelling: boolean) => void
  setTabQueryState: (id: string, queryId: string | null, error?: string | null) => void
  markConnectionUnavailable: (connectionId: string, name: string) => void
  closeTab: (id: string) => void
}

const restoredWorkspace = readStoredSqlWorkspace()

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: restoredWorkspace.tabs,
  activeTabId: restoredWorkspace.activeTabId,
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
      tabs: s.tabs.map((t) =>
        t.id === id
          ? { ...t, title: title.trim() || t.title, dirty: t.kind === 'sql' || !t.kind ? true : t.dirty }
          : t,
      ),
    })),
  updateTabSql: (id, sql) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, sql, dirty: t.kind === 'sql' || !t.kind ? true : t.dirty } : t,
      ),
    })),
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
      tabs: s.tabs.map((t) =>
        t.id === id
          ? { ...t, connectionId, unavailableConnectionName: null, dirty: t.kind === 'sql' || !t.kind ? true : t.dirty }
          : t,
      ),
    })),
  setTabDraft: (id, draftId) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, draftId, dirty: false } : t)),
    })),
  setRecordsConnectionFilter: (id, connectionId) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, recordsConnectionFilter: connectionId } : t)),
    })),
  toggleTabPinned: (id) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t)),
    })),
  setTabRunning: (id, running, queryId) => {
    if (running && queryId) {
      const previousQueryId = get().tabs.find((tab) => tab.id === id)?.lastQueryId
      if (previousQueryId && previousQueryId !== queryId) {
        useQueryResultStore.getState().clearResult(previousQueryId)
      }
    }
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id
          ? {
              ...t,
              running,
              cancelling: false,
              error: running ? null : t.error,
              lastQueryId: queryId ?? t.lastQueryId,
              runningQueryId: running ? queryId ?? null : null,
            }
          : t,
      ),
    }))
  },
  setTabCancelling: (id, cancelling) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, cancelling } : t)),
    })),
  setTabQueryState: (id, queryId, error = null) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id
          ? { ...t, lastQueryId: queryId, runningQueryId: null, error, running: false, cancelling: false }
          : t,
      ),
    })),
  markConnectionUnavailable: (connectionId, name) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => tab.connectionId === connectionId
        ? { ...tab, unavailableConnectionName: name, running: false, cancelling: false, runningQueryId: null }
        : tab),
    })),
  closeTab: (id) =>
    set((s) => {
      const closing = s.tabs.find((tab) => tab.id === id)
      if (closing?.lastQueryId) useQueryResultStore.getState().clearResult(closing.lastQueryId)
      const tabs = s.tabs.filter((t) => t.id !== id)
      return { tabs, activeTabId: tabs.at(-1)?.id ?? null }
    }),
}))

export function persistSqlWorkspace(tabs: EditorTab[], activeTabId: string | null) {
  if (typeof window === 'undefined') return
  const savedTabs = tabs
    .filter((tab) => tab.kind === 'sql' || !tab.kind)
    .map((tab) => ({
      id: tab.id,
      kind: 'sql' as const,
      title: tab.title,
      sql: tab.sql,
      connectionId: tab.connectionId,
      draftId: tab.draftId ?? null,
      dirty: tab.dirty ?? false,
      pinned: tab.pinned ?? false,
      unavailableConnectionName: tab.unavailableConnectionName ?? null,
    }))
  try {
    window.localStorage.setItem(SQL_WORKSPACE_STORAGE_KEY, JSON.stringify({
      tabs: savedTabs,
      activeTabId: savedTabs.some((tab) => tab.id === activeTabId) ? activeTabId : savedTabs.at(-1)?.id ?? null,
    }))
  } catch {
    // Workspace restoration is best-effort and must never block the editor.
  }
}

function readStoredSqlWorkspace(): Pick<EditorState, 'tabs' | 'activeTabId'> {
  if (typeof window === 'undefined') return { tabs: [], activeTabId: null }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SQL_WORKSPACE_STORAGE_KEY) ?? '{}')
    const rawTabs: unknown[] = Array.isArray(parsed.tabs) ? parsed.tabs as unknown[] : []
    const tabs = rawTabs
        .filter((tab): tab is Record<string, unknown> => Boolean(tab) && typeof tab === 'object')
        .filter((tab) => typeof tab.id === 'string' && typeof tab.title === 'string' && typeof tab.sql === 'string')
        .map((tab): EditorTab => ({
          id: tab.id as string,
          kind: 'sql',
          title: tab.title as string,
          sql: tab.sql as string,
          connectionId: typeof tab.connectionId === 'string' ? tab.connectionId : null,
          draftId: typeof tab.draftId === 'string' ? tab.draftId : null,
          dirty: tab.dirty === true,
          pinned: tab.pinned === true,
          unavailableConnectionName: typeof tab.unavailableConnectionName === 'string'
            ? tab.unavailableConnectionName
            : null,
          // Results and live execution state are intentionally never restored.
          lastQueryId: null,
          runningQueryId: null,
          running: false,
          cancelling: false,
          error: null,
        }))
    const activeTabId = typeof parsed.activeTabId === 'string' && tabs.some((tab) => tab.id === parsed.activeTabId)
      ? parsed.activeTabId
      : tabs.at(-1)?.id ?? null
    return { tabs, activeTabId }
  } catch {
    return { tabs: [], activeTabId: null }
  }
}
