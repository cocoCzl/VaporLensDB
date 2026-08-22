import {
  Activity,
  Ban,
  ChevronDown,
  ChevronRight,
  Database,
  FileCode2,
  FolderCog,
  Link,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Star,
  Square,
  TerminalSquare,
  Trash2,
  Unplug,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { DatabaseTree } from '@/components/explorer/DatabaseTree'
import { DatabaseVendorIcon } from '@/components/common/DatabaseVendorIcon'
import { ContextMenu, type ContextMenuAction } from '@/components/explorer/ContextMenu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AppSelect } from '@/components/ui/app-select'
import { ConnectionDialog } from '@/components/connection/ConnectionDialog'
import { useQuery } from '@/hooks/useQuery'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import { useQueryHistoryStore } from '@/stores/queryHistoryStore'
import { useUiStore } from '@/stores/uiStore'
import type { ConnectionConfig, DriverType } from '@/types/connection'
import type { QueryHistoryStatus } from '@/types/queryHistory'
import type { LucideIcon } from 'lucide-react'

const RAIL_ITEMS = [
  { view: 'explorer', icon: Database, labelKey: 'connection.explorerTitle' },
] as const

export function Sidebar() {
  const { t } = useTranslation()
  const sidebarView = useUiStore((state) => state.sidebarView)
  const setSidebarView = useUiStore((state) => state.setSidebarView)
  const sidebarWidth = useUiStore((state) => state.sidebarWidth)
  const setSidebarWidth = useUiStore((state) => state.setSidebarWidth)
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed)
  const setSidebarCollapsed = useUiStore((state) => state.setSidebarCollapsed)
  const [compactViewport, setCompactViewport] = useState(false)
  const tabs = useEditorStore((state) => state.tabs)
  const activeTabId = useEditorStore((state) => state.activeTabId)
  const addTab = useEditorStore((state) => state.addTab)
  const setActiveTab = useEditorStore((state) => state.setActiveTab)
  const settingsTab = tabs.find((tab) => tab.kind === 'settings')
  const settingsActive = settingsTab?.id === activeTabId

  useEffect(() => {
    const media = window.matchMedia('(max-width: 960px)')
    const update = () => setCompactViewport(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  function openSettings() {
    if (settingsTab) {
      setActiveTab(settingsTab.id)
    } else {
      addTab({
        id: crypto.randomUUID(),
        kind: 'settings',
        title: t('settings.title'),
        sql: '',
        connectionId: null,
      })
    }
    setSidebarView('explorer')
  }

  function toggleExplorer() {
    if (sidebarCollapsed) {
      setSidebarCollapsed(false)
      setSidebarView('explorer')
      return
    }

    if (sidebarView === 'explorer') {
      setSidebarCollapsed(true)
      return
    }

    setSidebarView('explorer')
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (sidebarCollapsed) return
    event.preventDefault()

    const startX = event.clientX
    const startWidth = sidebarWidth
    const previousCursor = document.body.style.cursor
    document.body.style.cursor = 'col-resize'

    const onMove = (moveEvent: PointerEvent) => {
      setSidebarWidth(startWidth + moveEvent.clientX - startX)
    }
    const stopResize = () => {
      document.body.style.cursor = previousCursor
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stopResize)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stopResize, { once: true })
  }

  return (
    <aside
      className="ide-chrome relative flex shrink-0 border-r"
      style={{ width: sidebarCollapsed ? 36 : compactViewport ? Math.min(sidebarWidth, 232) : sidebarWidth }}
    >
      <nav className="flex w-9 shrink-0 flex-col items-center gap-1 border-r bg-muted/25 py-1">
        {RAIL_ITEMS.map((item) => (
          <RailButton
            key={item.view}
            active={sidebarView === item.view && !sidebarCollapsed}
            icon={item.icon}
            label={t(item.labelKey)}
            onClick={toggleExplorer}
          />
        ))}
        <div className="flex-1" />
        <RailButton
          active={settingsActive}
          icon={Settings}
          label={t('nav.settings')}
          onClick={openSettings}
        />
      </nav>
      {!sidebarCollapsed && <SidebarPanel />}
      {!sidebarCollapsed && (
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label={t('connection.explorerTitle')}
          aria-valuemin={232}
          aria-valuemax={460}
          aria-valuenow={sidebarWidth}
          className="absolute inset-y-0 -right-px z-20 w-1 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-primary/35 focus-visible:bg-primary/50 focus-visible:outline-none"
          onPointerDown={startResize}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault()
              setSidebarWidth(sidebarWidth - 16)
            }
            if (event.key === 'ArrowRight') {
              event.preventDefault()
              setSidebarWidth(sidebarWidth + 16)
            }
          }}
        />
      )}
    </aside>
  )
}

function SidebarPanel() {
  const sidebarView = useUiStore((state) => state.sidebarView)

  if (sidebarView === 'dataSources') {
    return <DataSourcesSelectorPanel />
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <CompactDataSourceTree />
    </div>
  )
}

/**
 * The explorer deliberately treats selecting a Data Source as browsing only.
 * SQL tabs keep their own execution target, so moving around this tree never
 * mutates an open editor's connection binding.
 */
function CompactDataSourceTree() {
  const { t } = useTranslation()
  const {
    connections,
    dataSourceGroups,
    statuses,
    browsingConnectionId,
    busyConnectionIds,
    loadConnections,
    connectConnection,
    disconnectConnection,
    setActiveConnection,
    favoriteDataSourceIds,
    toggleFavoriteDataSource,
    moveConnectionToGroup,
    removeConnection,
    saveConnection,
  } = useConnectionStore(useShallow((state) => ({
    connections: state.connections,
    dataSourceGroups: state.dataSourceGroups,
    statuses: state.statuses,
    browsingConnectionId: state.browsingConnectionId,
    busyConnectionIds: state.busyConnectionIds,
    loadConnections: state.loadConnections,
    connectConnection: state.connectConnection,
    disconnectConnection: state.disconnectConnection,
    setActiveConnection: state.setActiveConnection,
    favoriteDataSourceIds: state.favoriteDataSourceIds,
    toggleFavoriteDataSource: state.toggleFavoriteDataSource,
    moveConnectionToGroup: state.moveConnectionToGroup,
    removeConnection: state.removeConnection,
    saveConnection: state.saveConnection,
  })))
  const tabs = useEditorStore((state) => state.tabs)
  const addTab = useEditorStore((state) => state.addTab)
  const setSidebarView = useUiStore((state) => state.setSidebarView)
  const { cancelRunningQuery } = useQuery()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [contextMenu, setContextMenu] = useState<{ connection: ConnectionConfig; x: number; y: number } | null>(null)
  const [disconnectPrompt, setDisconnectPrompt] = useState<ConnectionConfig | null>(null)
  const [query, setQuery] = useState('')
  const [expandedDataSourceIds, setExpandedDataSourceIds] = useState<Record<string, boolean>>({})

  useEffect(() => {
    void loadConnections()
  }, [loadConnections])

  const groups = useMemo(() => {
    const grouped = new Map<string, ConnectionConfig[]>()
    for (const connection of connections) {
      const key = connection.groupId ?? '__ungrouped__'
      grouped.set(key, [...(grouped.get(key) ?? []), connection])
    }
    const ordered = dataSourceGroups.map((group) => ({
      id: group.id,
      name: group.name,
      connections: orderGroupConnections(grouped.get(group.id) ?? [], favoriteDataSourceIds),
    }))
    const ungrouped = orderGroupConnections(grouped.get('__ungrouped__') ?? [], favoriteDataSourceIds)
    if (ungrouped.length > 0 || ordered.length === 0) {
      ordered.push({ id: '__ungrouped__', name: t('connection.ungrouped'), connections: ungrouped })
    }
    return ordered
  }, [connections, dataSourceGroups, favoriteDataSourceIds, t])
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredGroups = useMemo(() => groups
    .map((group) => {
      const groupMatches = normalizedQuery.length > 0 && group.name.toLocaleLowerCase().includes(normalizedQuery)
      return {
        ...group,
        connections: groupMatches || normalizedQuery.length === 0
          ? group.connections
          : group.connections.filter((connection) => connection.name.toLocaleLowerCase().includes(normalizedQuery)),
      }
    })
    .filter((group) => group.connections.length > 0 || (normalizedQuery.length === 0 && group.id !== '__ungrouped__')),
  [groups, normalizedQuery])

  function openBoundSql(connection: ConnectionConfig) {
    addTab({
      id: crypto.randomUUID(),
      kind: 'sql',
      title: `SQL · ${connection.name}`,
      sql: '',
      connectionId: connection.id,
    })
  }

  async function toggleDataSourceNode(connection: ConnectionConfig) {
    const opening = !expandedDataSourceIds[connection.id]
    setExpandedDataSourceIds((current) => ({ ...current, [connection.id]: opening }))
    if (!opening) return

    try {
      if (statuses[connection.id]?.status !== 'connected') {
        // Keep this connection out of the SQL execution context while it is
        // being opened, then explicitly make it the browsing context below.
        await connectConnection(connection.id, { selectForBrowsing: false })
      }
      // The object tree and status bar must refer to the same browsing source.
      // SQL tabs still take precedence in StatusBar through their connectionId.
      setActiveConnection(connection.id)
    } catch {
      setExpandedDataSourceIds((current) => ({ ...current, [connection.id]: false }))
    }
  }

  function openManagement() {
    const existing = tabs.find((tab) => tab.kind === 'dataSources')
    if (existing) {
      useEditorStore.getState().setActiveTab(existing.id)
    } else {
      addTab({ id: crypto.randomUUID(), kind: 'dataSources', title: t('connection.dataSources'), sql: '', connectionId: null })
    }
    setSidebarView('explorer')
  }

  function contextActions(connection: ConnectionConfig): ContextMenuAction[] {
    const connected = statuses[connection.id]?.status === 'connected'
    const busy = Boolean(busyConnectionIds[connection.id])
    return [
      {
        id: connected ? 'disconnect' : 'connect',
        label: connected ? t('connection.disconnect') : t('connection.connect'),
        icon: connected ? 'disconnect' : 'connect',
        disabled: busy,
        onSelect: () => { if (connected) requestDisconnect(connection); else void connectConnection(connection.id) },
      },
      { id: 'edit', label: t('connection.edit'), icon: 'edit', onSelect: openManagement },
      {
        id: 'duplicate', label: t('common.copy'), icon: 'duplicate', onSelect: () => {
          const { id, createdAt, updatedAt, ...input } = connection
          void id
          void createdAt
          void updatedAt
          void saveConnection({ ...input, name: `${connection.name} Copy` })
        },
      },
      {
        id: 'move', label: t('connection.moveToGroup'), icon: 'move', onSelect: () => {
          const groupName = window.prompt(
            `${t('connection.moveToGroup')} (${t('connection.ungrouped')})`,
            dataSourceGroups.find((group) => group.id === connection.groupId)?.name ?? t('connection.ungrouped'),
          )
          if (groupName === null) return
          const destination = dataSourceGroups.find((group) => group.name === groupName.trim())
          if (groupName.trim() === '' || groupName.trim() === t('connection.ungrouped')) {
            void moveConnectionToGroup(connection.id, null)
          } else if (destination) {
            void moveConnectionToGroup(connection.id, destination.id)
          }
        },
      },
      {
        id: 'favorite',
        label: favoriteDataSourceIds.includes(connection.id) ? t('connection.unfavorite') : t('connection.favorite'),
        icon: 'favorite',
        onSelect: () => toggleFavoriteDataSource(connection.id),
      },
      {
        id: 'delete', label: t('common.delete'), icon: 'delete', onSelect: () => {
          if (window.confirm(`${t('common.delete')} ${connection.name}?`)) {
            void removeConnection(connection.id)
          }
        },
      },
    ]
  }

  function requestDisconnect(connection: ConnectionConfig) {
    if (tabs.some((tab) => tab.connectionId === connection.id && tab.runningQueryId)) {
      setDisconnectPrompt(connection)
      return
    }
    void disconnectConnection(connection.id)
  }

  return (
    <section className="ide-chrome shrink-0 border-b" aria-label={t('connection.dataSources')}>
      <div className="ide-panel-header gap-1">
        <Database className="size-3.5 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{t('connection.dataSources')}</span>
        <ConnectionDialog
          trigger={
            <Button type="button" size="icon-xs" variant="ghost" title={t('connection.new')} aria-label={t('connection.new')}>
              <Plus />
            </Button>
          }
        />
        <Button type="button" size="icon-xs" variant="ghost" title={t('connection.manageDataSources')} aria-label={t('connection.manageDataSources')} onClick={openManagement}>
          <FolderCog />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={t('connection.reloadSaved')}
          title={t('connection.reloadSaved')}
          onClick={() => void loadConnections()}
        >
          <RefreshCw />
        </Button>
      </div>
      <div className="flex h-9 items-center gap-1 border-b px-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="data-source-tree-search-input"
            className="h-7 rounded-md pl-7 text-xs"
            value={query}
            placeholder={t('connection.searchDataSources')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1" role="tree" aria-label={t('connection.dataSources')}>
        {filteredGroups.map((group) => {
          const isCollapsed = collapsed[group.id] === true
          return (
            <div key={group.id}>
              <button
                type="button"
                className="flex h-6 w-full items-center gap-1 px-2 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted/70"
                aria-expanded={!isCollapsed}
                onClick={() => setCollapsed((value) => ({ ...value, [group.id]: !value[group.id] }))}
              >
                {isCollapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
                <span className="min-w-0 flex-1 truncate">{highlightDataSourceMatch(group.name, query)}</span>
                <span className="font-mono text-[10px] opacity-70">{group.connections.length}</span>
              </button>
              {!isCollapsed && group.connections.map((connection) => {
                const status = statuses[connection.id]?.status ?? 'disconnected'
                const busy = Boolean(busyConnectionIds[connection.id])
                const connected = status === 'connected'
                const selected = browsingConnectionId === connection.id
                const expanded = expandedDataSourceIds[connection.id] === true
                return (
                  <div key={connection.id}>
                    <div
                      role="treeitem"
                      tabIndex={0}
                      aria-selected={selected}
                      aria-expanded={expanded}
                      className={[
                        'group flex h-6 cursor-pointer items-center gap-1.5 px-2 pl-4 text-xs outline-none hover:bg-accent/75',
                        selected ? 'bg-accent text-accent-foreground' : '',
                      ].join(' ')}
                      onClick={() => setActiveConnection(connection.id)}
                      onDoubleClick={() => openBoundSql(connection)}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        setContextMenu({ connection, x: event.clientX, y: event.clientY })
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setActiveConnection(connection.id)
                        }
                      }}
                      title={`${connection.name} · ${connection.driverType}`}
                    >
                      <button
                        type="button"
                        className="grid size-4 shrink-0 place-items-center rounded hover:bg-background/70"
                        aria-label={expanded ? t('explorer.collapse') : t('explorer.expand')}
                        aria-busy={busy}
                        onClick={(event) => { event.stopPropagation(); void toggleDataSourceNode(connection) }}
                      >
                        {busy ? <Loader2 className="size-3 animate-spin" /> : expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                      </button>
                      <DatabaseVendorIcon driverType={connection.driverType} className="size-3.5 shrink-0" />
                      <span className={runtimeStatusDotClass(status)} aria-label={status} />
                      <span className="min-w-0 flex-1 truncate">{highlightDataSourceMatch(connection.name, query)}</span>
                      {favoriteDataSourceIds.includes(connection.id) && <Star className="size-3 shrink-0 fill-current text-amber-500" />}
                      <button
                        type="button"
                        className="grid size-5 shrink-0 place-items-center rounded opacity-0 hover:bg-background/70 group-hover:opacity-100 focus:opacity-100"
                        aria-label={connected ? t('connection.disconnect') : t('connection.connect')}
                        disabled={busy}
                        onClick={(event) => {
                          event.stopPropagation()
                          if (connected) requestDisconnect(connection)
                          else void connectConnection(connection.id)
                        }}
                      >
                        {busy ? <Loader2 className="size-3 animate-spin" /> : connected ? <Unplug className="size-3" /> : <Link className="size-3" />}
                      </button>
                    </div>
                    {expanded && connected && <div className="border-l border-border/70 pl-2"><DatabaseTree connectionId={connection.id} compact /></div>}
                    {expanded && status === 'failed' && <div className="px-7 py-1.5 text-[11px] text-destructive">{statuses[connection.id]?.message ?? t('explorer.loadFailed')}</div>}
                  </div>
                )
              })}
            </div>
          )
        })}
        {filteredGroups.length === 0 && (
          <div className="px-3 py-3 text-center text-xs text-muted-foreground">{t('connection.noMatches')}</div>
        )}
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          actions={contextActions(contextMenu.connection)}
          onClose={() => setContextMenu(null)}
        />
      )}
      {disconnectPrompt && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4" role="dialog" aria-modal="true" aria-label={t('connection.disconnect')}>
          <div className="w-full max-w-sm rounded-lg border bg-card p-4 shadow-xl">
            <div className="text-sm font-semibold">{t('connection.disconnect')}</div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{t('sessions.runningQueriesBlockDisconnect', { name: disconnectPrompt.name })}</p>
            <div className="mt-3 grid gap-1">{tabs.filter((tab) => tab.connectionId === disconnectPrompt.id && tab.runningQueryId).map((tab) => <div key={tab.id} className="flex items-center gap-2 rounded border px-2 py-1.5 text-xs"><span className="min-w-0 flex-1 truncate">{tab.title}</span><Button type="button" size="xs" variant="secondary" onClick={() => tab.runningQueryId && void cancelRunningQuery(tab.id, disconnectPrompt.id, tab.runningQueryId)}>{t('editor.cancel')}</Button></div>)}</div>
            <div className="mt-4 flex justify-end"><Button type="button" size="sm" variant="outline" onClick={() => setDisconnectPrompt(null)}>{t('common.close')}</Button></div>
          </div>
        </div>
      )}
    </section>
  )
}

function highlightDataSourceMatch(value: string, query: string): ReactNode {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return value
  const index = value.toLocaleLowerCase().indexOf(normalizedQuery.toLocaleLowerCase())
  if (index < 0) return value
  return <>{value.slice(0, index)}<mark className="rounded bg-primary/25 px-0.5 text-inherit">{value.slice(index, index + normalizedQuery.length)}</mark>{value.slice(index + normalizedQuery.length)}</>
}

function orderGroupConnections(connections: ConnectionConfig[], favoriteIds: string[]) {
  return [...connections].sort((left, right) => {
    const favoriteDelta = Number(favoriteIds.includes(right.id)) - Number(favoriteIds.includes(left.id))
    return favoriteDelta || left.name.localeCompare(right.name)
  })
}

function DataSourcesSelectorPanel() {
  const { t } = useTranslation()
  const {
    connections,
    statuses,
    busyConnectionIds,
    error,
    activeConnectionId,
    recentDataSourceIds,
    favoriteDataSourceIds,
    loadConnections,
    connectConnection,
    disconnectConnection,
    setActiveConnection,
    toggleFavoriteDataSource,
  } = useConnectionStore(useShallow((state) => ({
    connections: state.connections,
    statuses: state.statuses,
    busyConnectionIds: state.busyConnectionIds,
    error: state.error,
    activeConnectionId: state.activeConnectionId,
    recentDataSourceIds: state.recentDataSourceIds,
    favoriteDataSourceIds: state.favoriteDataSourceIds,
    loadConnections: state.loadConnections,
    connectConnection: state.connectConnection,
    disconnectConnection: state.disconnectConnection,
    setActiveConnection: state.setActiveConnection,
    toggleFavoriteDataSource: state.toggleFavoriteDataSource,
  })))
  const setSidebarView = useUiStore((state) => state.setSidebarView)
  const tabs = useEditorStore((state) => state.tabs)
  const addTab = useEditorStore((state) => state.addTab)
  const setActiveTab = useEditorStore((state) => state.setActiveTab)
  const [query, setQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    void loadConnections()
  }, [loadConnections])

  useEffect(() => {
    window.setTimeout(() => searchInputRef.current?.focus(), 0)
  }, [])

  const activeConnection =
    connections.find((connection) => connection.id === activeConnectionId) ?? null
  const activeStatus = activeConnection
    ? statuses[activeConnection.id]?.status ?? 'disconnected'
    : 'disconnected'
  const activeBusy = activeConnection ? Boolean(busyConnectionIds[activeConnection.id]) : false
  const filteredConnections = filterConnections(connections, query)
  const recentConnections = recentDataSourceIds
    .map((id) => connections.find((connection) => connection.id === id))
    .filter((connection): connection is ConnectionConfig => Boolean(connection))
  const favoriteConnections = favoriteDataSourceIds
    .map((id) => connections.find((connection) => connection.id === id))
    .filter((connection): connection is ConnectionConfig => Boolean(connection))
  const visibleConnections =
    query.trim() || (recentConnections.length === 0 && favoriteConnections.length === 0)
      ? filteredConnections
      : filteredConnections.filter(
          (connection) =>
            !recentConnections.some((recentConnection) => recentConnection.id === connection.id) &&
            !favoriteConnections.some((favoriteConnection) => favoriteConnection.id === connection.id),
        )
  const groupedVisibleConnections = groupConnections(
    visibleConnections,
    t('connection.ungrouped'),
  )

  async function handleConnect(connection: ConnectionConfig) {
    setActiveConnection(connection.id)
    try {
      await connectConnection(connection.id)
      setSidebarView('explorer')
    } catch {
      // Store notifications already carry the actionable error.
    }
  }

  async function handleDisconnect(connection: ConnectionConfig) {
    try {
      await disconnectConnection(connection.id)
    } catch {
      // Store notifications already carry the actionable error.
    }
  }

  function handleSelect(connection: ConnectionConfig) {
    setActiveConnection(connection.id)
    setSidebarView('explorer')
  }

  function openDataSourceManagement() {
    const existingTab = tabs.find((tab) => tab.kind === 'dataSources')
    if (existingTab) {
      setActiveTab(existingTab.id)
    } else {
      addTab({
        id: crypto.randomUUID(),
        kind: 'dataSources',
        title: t('connection.dataSources'),
        sql: '',
        connectionId: null,
      })
    }
    setSidebarView('explorer')
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-card">
      <div className="shrink-0 border-b p-3">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold">{t('connection.dataSources')}</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {activeConnection
                ? connectionTargetSummary(activeConnection)
                : t('connection.disconnected')}
            </div>
          </div>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            title={t('connection.explorerTitle')}
            onClick={() => setSidebarView('explorer')}
          >
            <X />
          </Button>
        </div>
        {activeConnection && (
          <div
            className={[
              'mb-3 rounded-md border px-2.5 py-2',
              'bg-background/70',
            ].join(' ')}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className={runtimeStatusDotClass(activeStatus)} />
              <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                {activeConnection.name}
              </span>
            </div>
            <div className="mt-1 truncate text-[11px] text-muted-foreground">
              {activeConnection.driverType} · {runtimeStatusLabel(activeStatus, t)}
            </div>
            <div className="mt-2 flex items-center gap-1">
              <Button
                type="button"
                size="icon-xs"
                variant="secondary"
                title={activeStatus === 'connected' ? t('connection.disconnect') : t('connection.connect')}
                disabled={activeBusy}
                onClick={() => {
                  if (activeStatus === 'connected') {
                    void handleDisconnect(activeConnection)
                  } else {
                    void handleConnect(activeConnection)
                  }
                }}
              >
                {activeBusy ? <Loader2 className="animate-spin" /> : activeStatus === 'connected' ? <Unplug /> : <Link />}
              </Button>
              <ConnectionDialog
                connection={activeConnection}
                trigger={
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="outline"
                    title={t('connection.edit')}
                  >
                    <Pencil />
                  </Button>
                }
              />
            </div>
          </div>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            className="h-8 pl-8 text-xs"
            value={query}
            placeholder={t('connection.searchDataSources')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      {error && (
        <div className="shrink-0 border-b px-3 py-2 text-xs text-destructive" title={error}>
          <div className="truncate">{error}</div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {filteredConnections.length === 0 ? (
          <div className="grid h-28 place-items-center rounded-md border border-dashed text-center text-xs text-muted-foreground">
            {connections.length === 0 ? t('connection.empty') : t('connection.noMatches')}
          </div>
        ) : (
          <div className="grid gap-3">
            {!query.trim() && recentConnections.length > 0 && (
              <ConnectionSwitcherSection title={t('connection.recent')}>
                {recentConnections.map((connection) => (
                  <ConnectionSwitcherRow
                    key={`recent-${connection.id}`}
                    connection={connection}
                    status={statuses[connection.id]?.status ?? 'disconnected'}
                    selected={connection.id === activeConnectionId}
                    busy={Boolean(busyConnectionIds[connection.id])}
                    onSelect={() => handleSelect(connection)}
                    onConnect={() => {
                      void handleConnect(connection)
                    }}
                    onDisconnect={() => {
                      void handleDisconnect(connection)
                    }}
                    favorite={favoriteDataSourceIds.includes(connection.id)}
                    onToggleFavorite={() => toggleFavoriteDataSource(connection.id)}
                    t={t}
                  />
                ))}
              </ConnectionSwitcherSection>
            )}
            {!query.trim() && favoriteConnections.length > 0 && (
              <ConnectionSwitcherSection title={t('connection.favorites')}>
                {favoriteConnections.map((connection) => (
                  <ConnectionSwitcherRow
                    key={`favorite-${connection.id}`}
                    connection={connection}
                    status={statuses[connection.id]?.status ?? 'disconnected'}
                    selected={connection.id === activeConnectionId}
                    busy={Boolean(busyConnectionIds[connection.id])}
                    onSelect={() => handleSelect(connection)}
                    onConnect={() => {
                      void handleConnect(connection)
                    }}
                    onDisconnect={() => {
                      void handleDisconnect(connection)
                    }}
                    favorite
                    onToggleFavorite={() => toggleFavoriteDataSource(connection.id)}
                    t={t}
                  />
                ))}
              </ConnectionSwitcherSection>
            )}
            {groupedVisibleConnections.map((group) => (
              <ConnectionSwitcherSection key={group.name} title={group.name}>
                {group.connections.map((connection) => (
                  <ConnectionSwitcherRow
                    key={connection.id}
                    connection={connection}
                    status={statuses[connection.id]?.status ?? 'disconnected'}
                    selected={connection.id === activeConnectionId}
                    busy={Boolean(busyConnectionIds[connection.id])}
                    onSelect={() => handleSelect(connection)}
                    onConnect={() => {
                      void handleConnect(connection)
                    }}
                    onDisconnect={() => {
                      void handleDisconnect(connection)
                    }}
                    favorite={favoriteDataSourceIds.includes(connection.id)}
                    onToggleFavorite={() => toggleFavoriteDataSource(connection.id)}
                    t={t}
                  />
                ))}
              </ConnectionSwitcherSection>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t p-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full justify-start"
          onClick={openDataSourceManagement}
        >
          <Settings className="size-3.5" />
          {t('connection.manageDataSources')}
        </Button>
      </div>
    </div>
  )
}

function ConnectionSwitcherSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="grid gap-1">
      <div className="px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="grid gap-1">{children}</div>
    </section>
  )
}

function ConnectionSwitcherRow({
  connection,
  status,
  selected,
  busy,
  onSelect,
  onConnect,
  onDisconnect,
  favorite,
  onToggleFavorite,
  t,
}: {
  connection: ConnectionConfig
  status: string
  selected: boolean
  busy: boolean
  onSelect: () => void
  onConnect: () => void
  onDisconnect: () => void
  favorite: boolean
  onToggleFavorite: () => void
  t: ReturnType<typeof useTranslation>['t']
}) {
  const connected = status === 'connected'
  const failed = status === 'failed'

  return (
    <div
      className={[
        'group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-2 py-2 text-xs transition-colors',
        selected
          ? 'border-primary/35 bg-primary/10'
          : 'border-transparent hover:border-border hover:bg-muted/70',
      ].join(' ')}
    >
      <button type="button" className="min-w-0 text-left" onClick={onSelect}>
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={runtimeStatusDotClass(status)} />
          <span className="min-w-0 flex-1 truncate font-medium">{connection.name}</span>
        </div>
        <div className="mt-1 truncate text-[11px] text-muted-foreground">
          {connection.driverType} · {connection.group?.trim() || t('connection.ungrouped')}
        </div>
        <div
          className={[
            'mt-0.5 truncate font-mono text-[10px]',
            failed ? 'text-destructive' : 'text-muted-foreground',
          ].join(' ')}
          title={connectionTargetSummary(connection)}
        >
          {connectionTargetSummary(connection)}
        </div>
      </button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        title={connected ? t('connection.disconnect') : t('connection.connect')}
        disabled={busy}
        onClick={connected ? onDisconnect : onConnect}
      >
        {busy ? <Loader2 className="animate-spin" /> : connected ? <Unplug /> : <Link />}
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        title={favorite ? t('connection.unfavorite') : t('connection.favorite')}
        aria-pressed={favorite}
        onClick={onToggleFavorite}
      >
        <Star className={favorite ? 'fill-current text-amber-500' : ''} />
      </Button>
      <ConnectionDialog
        connection={connection}
        trigger={
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            title={t('connection.edit')}
          >
            <Pencil />
          </Button>
        }
      />
    </div>
  )
}

function RailButton({
  active = false,
  icon: Icon,
  label,
  onClick,
}: {
  active?: boolean
  icon: LucideIcon
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={[
        'grid size-7 place-items-center rounded text-muted-foreground transition-colors',
        active
          ? 'bg-primary/10 text-primary shadow-[inset_2px_0_0_hsl(var(--primary))]'
          : 'hover:bg-accent hover:text-accent-foreground',
      ].join(' ')}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon className="size-4" />
    </button>
  )
}

export function SqlWorkspacePanel() {
  const { t } = useTranslation()
  const { tabs, activeTabId, setActiveTab, addTab } = useEditorStore(useShallow((state) => ({
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    setActiveTab: state.setActiveTab,
    addTab: state.addTab,
  })))
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId)
  const setActiveConnection = useConnectionStore((state) => state.setActiveConnection)
  const history = useQueryHistoryStore((state) => state.entries)
  const clearHistory = useQueryHistoryStore((state) => state.clear)
  const loadHistory = useQueryHistoryStore((state) => state.loadHistory)
  const historyLoading = useQueryHistoryStore((state) => state.loading)
  const connections = useConnectionStore((state) => state.connections)
  const notify = useUiStore((state) => state.notify)
  const [confirmClearHistory, setConfirmClearHistory] = useState(false)
  const [historyStatusFilter, setHistoryStatusFilter] = useState<'all' | QueryHistoryStatus>('all')
  const [historyConnectionFilter, setHistoryConnectionFilter] = useState('all')
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null)

  const historyConnectionOptions = uniqueHistoryConnections(history, connections)
  const filteredHistory = history.filter((entry) => {
    const statusMatches = historyStatusFilter === 'all' || entry.status === historyStatusFilter
    const connectionMatches =
      historyConnectionFilter === 'all' || entry.connectionId === historyConnectionFilter
    return statusMatches && connectionMatches
  })

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  function createTab() {
    addTab({
      id: crypto.randomUUID(),
      kind: 'sql',
      title: `SQL ${tabs.length + 1}`,
      sql: '',
      connectionId: activeConnectionId,
    })
  }

  async function handleClearHistory() {
    if (history.length === 0 || historyLoading) {
      return
    }

    if (!confirmClearHistory) {
      setConfirmClearHistory(true)
      window.setTimeout(() => setConfirmClearHistory(false), 3000)
      return
    }

    const cleared = await clearHistory()
    setConfirmClearHistory(false)
    if (cleared) {
      notify({ kind: 'success', title: t('sql.historyCleared') })
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PanelHeader
        title={t('sql.workspace')}
        subtitle={t('sql.editorPageCount', { count: tabs.length })}
        icon={TerminalSquare}
      />
      <div className="border-b p-2">
        <Button type="button" size="sm" variant="secondary" className="w-full" onClick={createTab}>
          <Plus className="size-3.5" />
          {t('sql.new')}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {tabs.length === 0 ? (
          <EmptyPanel icon={FileCode2} title={t('sql.emptyTitle')} text={t('sql.emptyText')} />
        ) : (
          <div className="space-y-1">
            {tabs.map((tab) => {
              const active = tab.id === activeTabId
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={[
                    'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors',
                    active
                      ? 'bg-primary/15 text-primary ring-1 ring-primary/25'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  ].join(' ')}
                  onClick={() => {
                    setActiveTab(tab.id)
                    setActiveConnection(tab.connectionId)
                  }}
                >
                  <FileCode2 className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{tab.title}</span>
                    <span className="block truncate opacity-75">
                      {tab.running ? t('sql.running') : sqlPreview(tab.sql, t)}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
        <div className="mt-4 border-t pt-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold">{t('sql.history')}</h3>
            <Button
              type="button"
              size="icon-xs"
              variant={confirmClearHistory ? 'destructive' : 'ghost'}
              title={confirmClearHistory ? t('sql.confirmClearHistory') : t('sql.clearHistory')}
              disabled={history.length === 0 || historyLoading}
              onClick={() => {
                void handleClearHistory()
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
          <div className="mb-2 grid grid-cols-2 gap-1">
            <label className="grid gap-1">
              <span className="text-[10px] font-medium uppercase text-muted-foreground">
                {t('sql.historyStatusFilter')}
              </span>
              <AppSelect
                className="h-7"
                value={historyStatusFilter}
                onValueChange={(value) => setHistoryStatusFilter(value as 'all' | QueryHistoryStatus)}
                options={[{ value: 'all', label: t('sql.historyFilterAll') }, { value: 'success', label: t('sql.historyFilterSuccess') }, { value: 'failed', label: t('sql.historyFilterFailed') }]}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[10px] font-medium uppercase text-muted-foreground">
                {t('sql.historyConnectionFilter')}
              </span>
              <AppSelect
                className="h-7"
                value={historyConnectionFilter}
                onValueChange={setHistoryConnectionFilter}
                options={[{ value: 'all', label: t('sql.historyFilterAllConnections') }, ...historyConnectionOptions.map((option) => ({ value: option.id, label: option.name }))]}
              />
            </label>
          </div>
          {history.length === 0 ? (
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              {t('sql.historyEmpty')}
            </div>
          ) : filteredHistory.length === 0 ? (
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              {t('sql.historyFilteredEmpty')}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredHistory.slice(0, 25).map((entry) => (
                <section
                  key={entry.id}
                  className="rounded-md border bg-background/60 text-xs hover:bg-muted/45"
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-1 px-2 py-1.5">
                    <button
                      type="button"
                      className="min-w-0 text-left"
                      onClick={() => {
                        setActiveConnection(entry.connectionId)
                        addTab({
                          id: crypto.randomUUID(),
                          kind: 'sql',
                          title: t('sql.historyTabTitle'),
                          sql: entry.sql,
                          connectionId: entry.connectionId,
                        })
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-[11px]">
                          {sqlPreview(entry.sql, t)}
                        </span>
                        <span
                          className={
                            entry.status === 'success'
                              ? 'shrink-0 text-emerald-500'
                              : 'shrink-0 text-destructive'
                          }
                        >
                          {entry.status === 'success' ? 'OK' : 'ERR'}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-[11px] text-muted-foreground">
                        {entry.connectionNameSnapshot} · {formatHistoryTime(entry.startedAt)}
                        {entry.elapsedMs ? ` · ${entry.elapsedMs} ms` : ''}
                        {entry.rowCount != null ? ` · ${t('sql.rows', { count: entry.rowCount })}` : ''}
                        {entry.affectedRows != null ? ` · ${t('sql.affectedRows', { count: entry.affectedRows })}` : ''}
                      </div>
                    </button>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      title={t('sql.historyPreview')}
                      aria-label={t('sql.historyPreview')}
                      onClick={() =>
                        setExpandedHistoryId(expandedHistoryId === entry.id ? null : entry.id)
                      }
                    >
                      {expandedHistoryId === entry.id ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronRight className="size-3.5" />
                      )}
                    </Button>
                  </div>
                  {expandedHistoryId === entry.id && (
                    <div className="grid gap-2 border-t px-2 py-2">
                      <div>
                        <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
                          {t('sql.historySqlPreview')}
                        </div>
                        <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded border bg-muted/35 p-2 font-mono text-[11px] leading-relaxed">
                          {entry.sql.trim() || t('sql.blankQuery')}
                        </pre>
                      </div>
                      {(entry.errorCode || entry.errorMessage) && (
                        <div>
                          <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
                            {t('sql.historyErrorPreview')}
                          </div>
                          <div className="max-h-24 overflow-auto whitespace-pre-wrap rounded border border-destructive/25 bg-destructive/10 p-2 text-[11px] text-destructive">
                            {entry.errorCode ? `${entry.errorCode}: ` : ''}
                            {entry.errorMessage}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function SessionManagementPanel() {
  const { t } = useTranslation()
  const connections = useConnectionStore((state) => state.connections)
  const statuses = useConnectionStore((state) => state.statuses)
  const disconnectConnection = useConnectionStore((state) => state.disconnectConnection)
  const setActiveConnection = useConnectionStore((state) => state.setActiveConnection)
  const { tabs, setActiveTab } = useEditorStore(useShallow((state) => ({
    tabs: state.tabs,
    setActiveTab: state.setActiveTab,
  })))
  const { cancelRunningQuery } = useQuery()
  const notify = useUiStore((state) => state.notify)
  const [busyConnectionId, setBusyConnectionId] = useState<string | null>(null)

  const runtimeSessions = connections
    .map((connection) => ({
      connection,
      status: statuses[connection.id]?.status ?? 'disconnected',
      message: statuses[connection.id]?.message ?? null,
      runningTabs: tabs.filter(
        (tab) => tab.connectionId === connection.id && Boolean(tab.runningQueryId),
      ),
    }))
    .filter(
      (session) =>
        session.status !== 'disconnected' ||
        session.runningTabs.length > 0,
    )

  const runningQueryCount = runtimeSessions.reduce(
    (count, session) => count + session.runningTabs.length,
    0,
  )

  async function handleDisconnect(connectionId: string) {
    setBusyConnectionId(connectionId)
    try {
      await disconnectConnection(connectionId)
      notify({ kind: 'info', title: t('sessions.disconnected') })
    } finally {
      setBusyConnectionId(null)
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PanelHeader
        title={t('sessions.title')}
        subtitle={t('sessions.subtitle', {
          sessions: runtimeSessions.length,
          queries: runningQueryCount,
        })}
        icon={Activity}
      />
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {runtimeSessions.length === 0 ? (
          <EmptyPanel icon={Activity} title={t('sessions.emptyTitle')} text={t('sessions.emptyText')} />
        ) : (
          <div className="space-y-2">
            {runtimeSessions.map(({ connection, status, message, runningTabs }) => {
              const canCancel = driverCanCancel(connection.driverType)
              const disconnecting = busyConnectionId === connection.id
              return (
                <section key={connection.id} className="rounded-md border bg-background/70">
                  <div className="flex items-start justify-between gap-2 border-b px-2 py-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setActiveConnection(connection.id)}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={sessionStatusClass(status)} />
                        <span className="min-w-0 truncate text-xs font-semibold">
                          {connection.name}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-[11px] text-muted-foreground">
                        {connection.driverType} · {status}
                        {message ? ` · ${message}` : ''}
                      </div>
                    </button>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      title={t('sessions.disconnect')}
                      disabled={disconnecting || status === 'disconnected'}
                      onClick={() => {
                        void handleDisconnect(connection.id)
                      }}
                    >
                      {disconnecting ? <Loader2 className="animate-spin" /> : <Unplug />}
                    </Button>
                  </div>
                  <div className="grid gap-1 p-2">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span>Running queries</span>
                      <span>
                        {runningTabs.length > 0
                          ? `${runningTabs.length} active`
                          : canCancel
                            ? 'none'
                            : 'unavailable'}
                      </span>
                    </div>
                    {runningTabs.length === 0 ? (
                      <div className="rounded border border-dashed px-2 py-2 text-[11px] text-muted-foreground">
                        {canCancel
                          ? t('sessions.noRunningQueries')
                          : t('sessions.runningQueriesUnavailable')}
                      </div>
                    ) : (
                      runningTabs.map((tab) => (
                        <div
                          key={tab.id}
                          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded border px-2 py-1.5"
                        >
                          <button
                            type="button"
                            className="min-w-0 text-left"
                            onClick={() => {
                              setActiveTab(tab.id)
                              setActiveConnection(connection.id)
                            }}
                          >
                            <span className="block truncate text-xs font-medium">{tab.title}</span>
                            <span className="block truncate font-mono text-[11px] text-muted-foreground">
                              {sqlPreview(tab.sql, t)}
                            </span>
                          </button>
                          <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost"
                            title={canCancel ? t('editor.cancel') : t('sessions.cancelUnsupported')}
                            disabled={!canCancel || !tab.runningQueryId}
                            onClick={() => {
                              if (tab.runningQueryId) {
                                void cancelRunningQuery(tab.id, connection.id, tab.runningQueryId)
                              }
                            }}
                          >
                            {canCancel ? <Square /> : <Ban />}
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function filterConnections(connections: ConnectionConfig[], query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  const sorted = connections
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))

  if (!normalizedQuery) {
    return sorted
  }

  return sorted.filter((connection) =>
    [
      connection.name,
      connection.driverType,
      connection.group,
      connection.host,
      connection.database,
      connection.connectionUrl,
      connection.username,
      connectionTargetSummary(connection),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery),
  )
}

function nullableText(value: string | null | undefined) {
  return value?.trim() ? value.trim() : null
}

function connectionTargetSummary(connection: ConnectionConfig) {
  const url = nullableText(connection.connectionUrl)
  if (url) {
    return compactConnectionUrl(url)
  }

  const host = nullableText(connection.host)
  const port = connection.port ? `:${connection.port}` : ''
  const database = nullableText(connection.database)
  const target = host ? `${host}${port}` : connection.driverType
  return database ? `${target}/${database}` : target
}

function compactConnectionUrl(url: string) {
  return url
    .replace(/^jdbc:/, '')
    .replace(/^oracle:thin:@/, 'oracle:')
    .replace(/^postgresql:\/\//, 'postgres:')
    .replace(/^mysql:\/\//, 'mysql:')
}

function groupConnections(connections: ConnectionConfig[], ungroupedLabel: string) {
  const groups = new Map<string, ConnectionConfig[]>()
  for (const connection of connections) {
    const group = connection.group?.trim() || ungroupedLabel
    groups.set(group, [...(groups.get(group) ?? []), connection])
  }

  return Array.from(groups.entries())
    .sort(([left], [right]) => groupSortKey(left, ungroupedLabel).localeCompare(groupSortKey(right, ungroupedLabel)))
    .map(([name, groupConnections]) => ({
      name,
      connections: groupConnections
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name)),
    }))
}

function groupSortKey(group: string, ungroupedLabel: string) {
  return group === ungroupedLabel ? '\uffff' : group.toLocaleLowerCase()
}

function runtimeStatusDotClass(status: string) {
  if (status === 'connected') return 'size-1.5 shrink-0 rounded-full bg-emerald-500'
  if (status === 'connecting') return 'size-1.5 shrink-0 rounded-full bg-amber-500'
  if (status === 'failed') return 'size-1.5 shrink-0 rounded-full bg-destructive'
  return 'size-1.5 shrink-0 rounded-full bg-muted-foreground/45'
}

function runtimeStatusLabel(status: string, t: ReturnType<typeof useTranslation>['t']) {
  if (status === 'connected') return t('connection.connected')
  if (status === 'connecting') return t('connection.connecting')
  if (status === 'failed') return t('connection.failed')
  return t('connection.disconnected')
}

function PanelHeader({
  title,
  subtitle,
  icon: Icon,
}: {
  title: string
  subtitle: string
  icon: LucideIcon
}) {
  return (
    <div className="flex h-[52px] shrink-0 items-center gap-2 border-b px-3">
      <Icon className="size-4 text-primary" />
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold">{title}</h2>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  )
}

function EmptyPanel({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <div className="grid h-40 place-items-center rounded-md border border-dashed text-center">
      <div className="px-6">
        <Icon className="mx-auto mb-2 size-6 text-muted-foreground" />
        <div className="text-sm font-medium">{title}</div>
        <p className="mt-1 text-xs text-muted-foreground">{text}</p>
      </div>
    </div>
  )
}

function sqlPreview(sql: string, t: ReturnType<typeof useTranslation>['t']) {
  const preview = sql.trim().replace(/\s+/g, ' ')
  return preview.length > 90 ? `${preview.slice(0, 90)}...` : preview || t('sql.blankQuery')
}

function uniqueHistoryConnections(
  history: { connectionId: string; connectionNameSnapshot: string }[],
  connections: ConnectionConfig[],
) {
  const names = new Map(connections.map((connection) => [connection.id, connection.name]))
  for (const entry of history) {
    if (!names.has(entry.connectionId)) {
      names.set(entry.connectionId, entry.connectionNameSnapshot)
    }
  }
  return Array.from(names, ([id, name]) => ({ id, name })).sort((left, right) =>
    left.name.localeCompare(right.name),
  )
}

function driverCanCancel(driverType: DriverType) {
  return driverType === 'postgres'
}

function sessionStatusClass(status: string) {
  if (status === 'connected') return 'size-2 shrink-0 rounded-full bg-emerald-500'
  if (status === 'connecting') return 'size-2 shrink-0 rounded-full bg-amber-500'
  if (status === 'failed') return 'size-2 shrink-0 rounded-full bg-destructive'
  return 'size-2 shrink-0 rounded-full bg-muted-foreground/50'
}

function formatHistoryTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
