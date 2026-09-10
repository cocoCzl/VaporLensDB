import { Database, FileCode2, History, Moon, PanelTop, SearchX, Settings, Sun, Table2, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { ConnectionDialog } from '@/components/connection/ConnectionDialog'
import { DatabaseVendorIcon } from '@/components/common/DatabaseVendorIcon'
import { databaseObjectSearchText, dedupePaletteQueryHistory, rankPaletteItems, type PaletteSearchItem } from '@/lib/commandPaletteRanking'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import { useMetadataStore } from '@/stores/metadataStore'
import { useQueryHistoryStore } from '@/stores/queryHistoryStore'
import { useUiStore } from '@/stores/uiStore'
import type { ConnectionConfig } from '@/types/connection'
import type { DbObjectKind } from '@/types/metadata'
import type { QueryHistoryEntry } from '@/types/queryHistory'

type PaletteGroup = 'workspace' | 'recentConnections' | 'dataSources' | 'databaseObjects' | 'recentQueries'

interface PaletteItem extends PaletteSearchItem {
  group: PaletteGroup
  label: string
  metadata?: string
  icon: LucideIcon
  driverType?: ConnectionConfig['driverType']
  onSelect: () => void
}

interface CachedObject {
  id: string
  connectionId: string
  name: string
  kind: DbObjectKind | 'database' | 'schema'
  database?: string | null
  schema?: string | null
}

const GROUP_ORDER: PaletteGroup[] = ['workspace', 'recentConnections', 'dataSources', 'databaseObjects', 'recentQueries']
const MAX_OBJECT_RESULTS = 28
const MAX_HISTORY_RESULTS = 16

/**
 * A keyboard-first index over existing frontend state only. It never starts a
 * metadata scan: objects are available here once another product surface has
 * already loaded them into MetadataStore.
 */
export function WorkspaceCommandPalette() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false)
  const lastFocusedElement = useRef<HTMLElement | null>(null)
  const historyRequested = useRef(false)
  const { connections, activeConnectionId, recentDataSourceIds, setActiveConnection } = useConnectionStore(useShallow((state) => ({
    connections: state.connections,
    activeConnectionId: state.activeConnectionId,
    recentDataSourceIds: state.recentDataSourceIds,
    setActiveConnection: state.setActiveConnection,
  })))
  const { tabs, activeTabId, addTab, setActiveTab } = useEditorStore(useShallow((state) => ({
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    addTab: state.addTab,
    setActiveTab: state.setActiveTab,
  })))
  const { entries: queryHistory, loadHistory } = useQueryHistoryStore(useShallow((state) => ({
    entries: state.entries,
    loadHistory: state.loadHistory,
  })))
  const { databases, schemas, tables, views, functions, schemaObjects } = useMetadataStore(useShallow((state) => ({
    databases: state.databases,
    schemas: state.schemas,
    tables: state.tables,
    views: state.views,
    functions: state.functions,
    schemaObjects: state.schemaObjects,
  })))
  const theme = useUiStore((state) => state.theme)
  const setTheme = useUiStore((state) => state.setTheme)
  const shortcut = isMacPlatform() ? '⌘ K' : 'Ctrl K'
  const cachedObjects = useMemo(
    () => collectCachedObjects({ databases, schemas, tables, views, functions, schemaObjects }),
    [databases, functions, schemaObjects, schemas, tables, views],
  )

  function requestOpen() {
    lastFocusedElement.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setQuery('')
    setOpen(true)
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) {
      window.requestAnimationFrame(() => lastFocusedElement.current?.focus())
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        requestOpen()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    window.addEventListener('vaporlensdb:open-command-palette', requestOpen)
    return () => window.removeEventListener('vaporlensdb:open-command-palette', requestOpen)
  }, [])

  useEffect(() => {
    if (!open || historyRequested.current) return
    historyRequested.current = true
    void loadHistory(100)
  }, [loadHistory, open])

  function closeAnd(action: () => void) {
    setOpen(false)
    window.setTimeout(action, 0)
  }

  const openTab = useCallback((kind: 'dataSources' | 'settings' | 'sqlScripts' | 'queryHistory') => {
    const existing = tabs.find((tab) => tab.kind === kind)
    if (existing) {
      setActiveTab(existing.id)
      return
    }
    addTab({
      id: crypto.randomUUID(),
      kind,
      title: kind === 'settings'
        ? t('settings.title')
        : kind === 'dataSources'
          ? t('connection.dataSources')
          : kind === 'queryHistory'
            ? t('sql.history')
            : t('sql.drafts'),
      sql: '',
      connectionId: null,
    })
  }, [addTab, setActiveTab, t, tabs])

  const openNewSql = useCallback(() => {
    const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null
    const connectionId = activeTab?.kind === 'sql' || !activeTab?.kind
      ? activeTab?.connectionId ?? activeConnectionId
      : activeConnectionId
    const connection = connections.find((item) => item.id === connectionId)
    addTab({
      id: crypto.randomUUID(),
      kind: 'sql',
      title: connection ? `SQL · ${connection.name}` : `SQL ${tabs.filter((tab) => tab.kind === 'sql' || !tab.kind).length + 1}`,
      sql: '',
      connectionId,
    })
  }, [activeConnectionId, activeTabId, addTab, connections, tabs])

  const openHistoryEntry = useCallback((entry: QueryHistoryEntry) => {
    const connection = connections.find((item) => item.id === entry.connectionId)
    addTab({
      id: crypto.randomUUID(),
      kind: 'sql',
      title: `SQL · ${entry.connectionNameSnapshot}`,
      sql: entry.sql,
      connectionId: connection ? entry.connectionId : null,
      unavailableConnectionName: connection ? null : entry.connectionNameSnapshot,
    })
  }, [addTab, connections])

  const workspaceItems = useMemo<PaletteItem[]>(() => [
    {
      id: 'new-sql',
      group: 'workspace',
      label: t('workbench.newSql'),
      searchText: `${t('workbench.newSql')} new sql query`,
      icon: FileCode2,
      onSelect: () => closeAnd(openNewSql),
    },
    {
      id: 'new-connection',
      group: 'workspace',
      label: t('connection.new'),
      searchText: `${t('connection.new')} new connection database`,
      icon: Database,
      onSelect: () => closeAnd(() => setConnectionDialogOpen(true)),
    },
    {
      id: 'data-sources',
      group: 'workspace',
      label: t('connection.dataSources'),
      searchText: `${t('connection.dataSources')} data sources connections`,
      icon: Database,
      onSelect: () => closeAnd(() => openTab('dataSources')),
    },
    {
      id: 'query-history',
      group: 'workspace',
      label: t('sql.history'),
      searchText: `${t('sql.history')} query history`,
      icon: History,
      onSelect: () => closeAnd(() => openTab('queryHistory')),
    },
    {
      id: 'sql-scripts',
      group: 'workspace',
      label: t('sql.drafts'),
      searchText: `${t('sql.drafts')} sql scripts drafts`,
      icon: FileCode2,
      onSelect: () => closeAnd(() => openTab('sqlScripts')),
    },
    {
      id: 'settings',
      group: 'workspace',
      label: t('settings.title'),
      searchText: `${t('settings.title')} settings preferences`,
      icon: Settings,
      onSelect: () => closeAnd(() => openTab('settings')),
    },
    {
      id: 'toggle-theme',
      group: 'workspace',
      label: t('commandPalette.toggleTheme'),
      searchText: `${t('commandPalette.toggleTheme')} theme appearance`,
      icon: theme === 'dark' ? Sun : Moon,
      onSelect: () => closeAnd(() => setTheme(theme === 'dark' ? 'light' : 'dark')),
    },
  ], [openNewSql, openTab, setTheme, t, theme])

  const connectionItems = useMemo<PaletteItem[]>(() => connections.map((connection) => ({
    id: `connection-${connection.id}`,
    group: 'dataSources',
    label: connection.name,
    metadata: driverLabel(connection.driverType),
    searchText: `${connection.name} ${connection.driverType} ${connection.host ?? ''} ${connection.port ?? ''} ${connection.database ?? ''}`,
    icon: Database,
    driverType: connection.driverType,
    currentConnection: connection.id === activeConnectionId,
    onSelect: () => closeAnd(() => setActiveConnection(connection.id)),
  })), [activeConnectionId, connections, setActiveConnection])

  const recentConnectionItems = useMemo(() => recentDataSourceIds
    .map((id) => connections.find((connection) => connection.id === id))
    .filter((connection): connection is ConnectionConfig => Boolean(connection))
    .map<PaletteItem>((connection) => ({
      id: `recent-connection-${connection.id}`,
      group: 'recentConnections',
      label: connection.name,
      metadata: driverLabel(connection.driverType),
      searchText: `${connection.name} ${connection.driverType} ${connection.host ?? ''} ${connection.port ?? ''} ${connection.database ?? ''}`,
      icon: Database,
      driverType: connection.driverType,
      currentConnection: connection.id === activeConnectionId,
      onSelect: () => closeAnd(() => setActiveConnection(connection.id)),
    })), [activeConnectionId, connections, recentDataSourceIds, setActiveConnection])

  const objectItems = useMemo<PaletteItem[]>(() => cachedObjects
    .map((object) => {
      return {
        id: `object-${object.id}`,
        group: 'databaseObjects',
        label: object.name,
        metadata: objectKindLabel(object.kind, t),
        searchText: databaseObjectSearchText({
          name: object.name,
          displayName: object.name,
          database: object.database,
          schema: object.schema,
        }),
        icon: object.kind === 'table' || object.kind === 'view' ? Table2 : PanelTop,
        currentConnection: object.connectionId === activeConnectionId,
        // Selecting a cached object deliberately reuses existing browsing state.
        // It does not load or scan metadata on behalf of the palette.
        onSelect: () => closeAnd(() => setActiveConnection(object.connectionId)),
      }
    }), [activeConnectionId, cachedObjects, setActiveConnection, t])

  const historyItems: PaletteItem[] = dedupePaletteQueryHistory(queryHistory).map((entry) => ({
    id: `history-${entry.id}`,
    group: 'recentQueries',
    label: sqlPreview(entry.sql),
    metadata: entry.connectionNameSnapshot,
    searchText: `${entry.sql} ${entry.connectionNameSnapshot} ${entry.database ?? ''} ${entry.schema ?? ''}`,
    icon: History,
    currentConnection: entry.connectionId === activeConnectionId,
    onSelect: () => closeAnd(() => openHistoryEntry(entry)),
  }))

  const displayedGroups = useMemo(() => {
    const allItems = [...workspaceItems, ...connectionItems, ...objectItems, ...historyItems]
    const byGroup = new Map<PaletteGroup, PaletteItem[]>()
    for (const group of GROUP_ORDER) byGroup.set(group, [])

    if (!query.trim()) {
      for (const item of workspaceItems) byGroup.get('workspace')?.push(item)
      const initialConnections = recentConnectionItems.length > 0 ? recentConnectionItems : connectionItems.slice(0, 6)
      for (const item of initialConnections) byGroup.get(item.group)?.push(item)
      return GROUP_ORDER.map((group) => ({ group, items: byGroup.get(group) ?? [] })).filter(({ items }) => items.length > 0)
    }

    for (const item of rankPaletteItems(allItems, query, activeConnectionId)) {
      const limit = item.group === 'databaseObjects' ? MAX_OBJECT_RESULTS : item.group === 'recentQueries' ? MAX_HISTORY_RESULTS : 24
      const groupItems = byGroup.get(item.group) ?? []
      if (groupItems.length < limit) groupItems.push(item)
    }
    return GROUP_ORDER.map((group) => ({ group, items: byGroup.get(group) ?? [] })).filter(({ items }) => items.length > 0)
  }, [activeConnectionId, connectionItems, historyItems, objectItems, query, recentConnectionItems, workspaceItems])

  const hasResults = displayedGroups.some(({ items }) => items.length > 0)

  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={handleOpenChange}
        title={t('commandPalette.title')}
        description={t('commandPalette.description')}
        className="w-[calc(100vw-2rem)] max-w-[41rem] gap-0 rounded-xl! border-border-strong/85 p-0 shadow-[0_24px_60px_-28px_hsl(var(--shadow-floating)/0.48)] sm:max-w-[41rem]"
      >
        <CommandInput
          autoFocus
          value={query}
          onValueChange={setQuery}
          onClear={() => setQuery('')}
          clearLabel={t('commandPalette.clearSearch')}
          placeholder={t('commandPalette.placeholder')}
          aria-label={t('commandPalette.placeholder')}
        />
        <CommandList>
          {!hasResults ? (
            <CommandEmpty>
              <SearchX className="mx-auto mb-2 size-4 text-muted-foreground/75" />
              <div>{t('commandPalette.noResults', { query })}</div>
              <div className="mt-1 text-[11px] text-muted-foreground/75">{t('commandPalette.emptyHint')}</div>
            </CommandEmpty>
          ) : displayedGroups.map(({ group, items }) => (
            <CommandGroup key={group} heading={groupLabel(group, t)}>
              {items.map((item) => <PaletteRow key={item.id} item={item} />)}
            </CommandGroup>
          ))}
        </CommandList>
        <footer className="flex h-10 shrink-0 items-center justify-between border-t border-border/65 px-3 text-[11px] text-muted-foreground">
          <span>{t('commandPalette.hint')}</span>
          <kbd className="rounded border border-border/75 bg-surface-secondary px-1.5 py-0.5 font-mono text-[10px]">{shortcut}</kbd>
        </footer>
      </CommandDialog>
      <ConnectionDialog open={connectionDialogOpen} onOpenChange={setConnectionDialogOpen} hideTrigger />
    </>
  )
}

function PaletteRow({ item }: { item: PaletteItem }) {
  const Icon = item.icon
  return (
    <CommandItem value={item.id} onSelect={item.onSelect}>
      {item.driverType
        ? <DatabaseVendorIcon driverType={item.driverType} className="size-4 text-muted-foreground" />
        : <Icon className="size-4 text-muted-foreground" />}
      <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
      {item.metadata ? <CommandShortcut>{item.metadata}</CommandShortcut> : null}
    </CommandItem>
  )
}

function collectCachedObjects({
  databases,
  schemas,
  tables,
  views,
  functions,
  schemaObjects,
}: Pick<ReturnType<typeof useMetadataStore.getState>, 'databases' | 'schemas' | 'tables' | 'views' | 'functions' | 'schemaObjects'>) {
  const seen = new Set<string>()
  const objects: CachedObject[] = []
  const add = (object: CachedObject) => {
    if (seen.has(object.id)) return
    seen.add(object.id)
    objects.push(object)
  }

  for (const [connectionId, entries] of Object.entries(databases)) {
    for (const entry of entries) add({ id: `${connectionId}:database:${entry.name}`, connectionId, name: entry.name, kind: 'database', database: entry.name })
  }
  for (const [key, entries] of Object.entries(schemas)) {
    const connectionId = key.split('::')[0]
    for (const entry of entries) add({ id: `${connectionId}:schema:${entry.database ?? ''}:${entry.name}`, connectionId, name: entry.name, kind: 'schema', database: entry.database, schema: entry.name })
  }
  for (const [key, entries] of Object.entries(tables)) {
    const { connectionId, schema } = cachedSchemaLocation(key)
    for (const entry of entries) add({ id: `${connectionId}:table:${entry.schema ?? schema ?? ''}:${entry.name}`, connectionId, name: entry.name, kind: 'table', schema: entry.schema ?? schema })
  }
  for (const [key, entries] of Object.entries(views)) {
    const { connectionId, schema } = cachedSchemaLocation(key)
    for (const entry of entries) add({ id: `${connectionId}:view:${entry.schema ?? schema ?? ''}:${entry.name}`, connectionId, name: entry.name, kind: 'view', schema: entry.schema ?? schema })
  }
  for (const [key, entries] of Object.entries(functions)) {
    const { connectionId, schema } = cachedSchemaLocation(key)
    for (const name of entries) add({ id: `${connectionId}:function:${schema ?? ''}:${name}`, connectionId, name, kind: 'function', schema })
  }
  for (const [key, entries] of Object.entries(schemaObjects)) {
    const { connectionId, schema } = cachedSchemaLocation(key)
    for (const entry of entries) add({ id: `${connectionId}:${entry.kind}:${entry.schema ?? schema ?? ''}:${entry.name}`, connectionId, name: entry.name, kind: entry.kind, schema: entry.schema ?? schema })
  }
  return objects
}

function cachedSchemaLocation(key: string) {
  const [connectionId = '', , schema] = key.split('::')
  return { connectionId, schema: schema || null }
}

function groupLabel(group: PaletteGroup, t: ReturnType<typeof useTranslation>['t']) {
  if (group === 'workspace') return t('commandPalette.workspace')
  if (group === 'recentConnections') return t('commandPalette.recentConnections')
  if (group === 'dataSources') return t('commandPalette.dataSources')
  if (group === 'databaseObjects') return t('commandPalette.databaseObjects')
  return t('commandPalette.recentQueries')
}

function objectKindLabel(kind: CachedObject['kind'], t: ReturnType<typeof useTranslation>['t']) {
  return t(`commandPalette.objectKinds.${kind}`)
}

function driverLabel(driver: ConnectionConfig['driverType']) {
  if (driver === 'postgres') return 'PostgreSQL'
  if (driver === 'mssql') return 'SQL Server'
  if (driver === 'jdbc') return 'JDBC'
  return driver.charAt(0).toUpperCase() + driver.slice(1)
}

function sqlPreview(sql: string) {
  return sql.trim().replace(/\s+/g, ' ').slice(0, 160) || sql
}

function isMacPlatform() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
}
