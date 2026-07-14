import {
  Activity,
  Ban,
  ChevronDown,
  ChevronRight,
  Database,
  FileCode2,
  Link,
  Loader2,
  Pencil,
  Plus,
  Search,
  Settings,
  Square,
  TerminalSquare,
  Trash2,
  Unplug,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { DatabaseTree } from '@/components/explorer/DatabaseTree'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  const tabs = useEditorStore((state) => state.tabs)
  const activeTabId = useEditorStore((state) => state.activeTabId)
  const addTab = useEditorStore((state) => state.addTab)
  const setActiveTab = useEditorStore((state) => state.setActiveTab)
  const settingsTab = tabs.find((tab) => tab.kind === 'settings')
  const settingsActive = settingsTab?.id === activeTabId

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

  return (
    <aside className="flex w-[348px] shrink-0 border-r bg-card">
      <nav className="flex w-12 flex-col items-center gap-1 border-r bg-muted/45 py-2">
        {RAIL_ITEMS.map((item) => (
          <RailButton
            key={item.view}
            active={sidebarView === item.view}
            icon={item.icon}
            label={t(item.labelKey)}
            onClick={() => setSidebarView(item.view)}
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
      <SidebarPanel />
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
      <DataSourceHeader />
      <DatabaseTree />
    </div>
  )
}

function DataSourceHeader() {
  const { t } = useTranslation()
  const {
    connections,
    statuses,
    activeConnectionId,
    busyConnectionIds,
    loadConnections,
    connectConnection,
    disconnectConnection,
    setActiveConnection,
  } = useConnectionStore()
  const setSidebarView = useUiStore((state) => state.setSidebarView)

  useEffect(() => {
    void loadConnections()
  }, [loadConnections])

  const activeConnection =
    connections.find((connection) => connection.id === activeConnectionId) ?? null
  const activeStatus = activeConnection
    ? statuses[activeConnection.id]?.status ?? 'disconnected'
    : 'disconnected'
  const connected = activeStatus === 'connected'
  const activeBusy = activeConnection ? Boolean(busyConnectionIds[activeConnection.id]) : false

  async function toggleActiveConnection(event: MouseEvent) {
    event.stopPropagation()
    if (!activeConnection) {
      setSidebarView('dataSources')
      return
    }
    setActiveConnection(activeConnection.id)
    try {
      if (connected) {
        await disconnectConnection(activeConnection.id)
      } else {
        await connectConnection(activeConnection.id)
      }
    } catch {
      // Store notifications already carry the actionable error.
    }
  }

  return (
    <div className="shrink-0 border-b bg-card">
      <div className="px-2.5 py-2">
        <div
          className={[
            'group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-md border p-1.5 transition-colors',
            isProductionConnection(activeConnection)
              ? 'border-red-500/35 bg-red-500/5 hover:bg-red-500/10'
              : 'border-border bg-background/65 hover:bg-muted/70',
          ].join(' ')}
        >
          <button
            type="button"
            className="flex min-w-0 items-center gap-2 rounded px-1 py-1 text-left"
            onClick={() => setSidebarView('dataSources')}
          >
            <Database className="size-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-sm font-semibold">
                  {activeConnection?.name ?? t('connection.select')}
                </span>
                {activeConnection && <EnvironmentBadge connection={activeConnection} />}
              </div>
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className={runtimeStatusDotClass(activeStatus)} />
                <span className="truncate">
                  {activeConnection
                    ? `${activeConnection.driverType} · ${runtimeStatusLabel(activeStatus, t)}`
                    : t('connection.disconnected')}
                </span>
              </div>
            </div>
            <ChevronDown className="size-4 shrink-0 -rotate-90 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </button>
          <div className="flex shrink-0 items-center gap-0.5">
            {activeConnection && (
              <>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  title={connected ? t('connection.disconnect') : t('connection.connect')}
                  disabled={activeBusy}
                  onClick={toggleActiveConnection}
                >
                  {activeBusy ? <Loader2 className="animate-spin" /> : connected ? <Unplug /> : <Link />}
                </Button>
                <ConnectionDialog
                  connection={activeConnection}
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
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
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
    loadConnections,
    connectConnection,
    disconnectConnection,
    setActiveConnection,
  } = useConnectionStore()
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
  const visibleConnections =
    query.trim() || recentConnections.length === 0
      ? filteredConnections
      : filteredConnections.filter(
          (connection) =>
            !recentConnections.some((recentConnection) => recentConnection.id === connection.id),
        )
  const groupedVisibleConnections = groupConnectionsByEnvironment(
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
              isProductionConnection(activeConnection)
                ? 'border-red-500/35 bg-red-500/5'
                : 'bg-background/70',
            ].join(' ')}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className={runtimeStatusDotClass(activeStatus)} />
              <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                {activeConnection.name}
              </span>
              <EnvironmentBadge connection={activeConnection} />
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
  t,
}: {
  connection: ConnectionConfig
  status: string
  selected: boolean
  busy: boolean
  onSelect: () => void
  onConnect: () => void
  onDisconnect: () => void
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
          <EnvironmentBadge connection={connection} />
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
        'grid size-9 place-items-center rounded-md text-muted-foreground transition-colors',
        active
          ? 'bg-primary/15 text-primary ring-1 ring-primary/35'
          : 'hover:bg-accent hover:text-accent-foreground',
      ].join(' ')}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon className="size-5" />
    </button>
  )
}

export function SqlWorkspacePanel() {
  const { t } = useTranslation()
  const { tabs, activeTabId, setActiveTab, addTab } = useEditorStore()
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
              <select
                className="ide-select h-7 text-xs"
                value={historyStatusFilter}
                onChange={(event) =>
                  setHistoryStatusFilter(event.target.value as 'all' | QueryHistoryStatus)
                }
              >
                <option value="all">{t('sql.historyFilterAll')}</option>
                <option value="success">{t('sql.historyFilterSuccess')}</option>
                <option value="failed">{t('sql.historyFilterFailed')}</option>
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-[10px] font-medium uppercase text-muted-foreground">
                {t('sql.historyConnectionFilter')}
              </span>
              <select
                className="ide-select h-7 text-xs"
                value={historyConnectionFilter}
                onChange={(event) => setHistoryConnectionFilter(event.target.value)}
              >
                <option value="all">{t('sql.historyFilterAllConnections')}</option>
                {historyConnectionOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
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
  const { tabs, setActiveTab } = useEditorStore()
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
      connection.colorTag,
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

function groupConnectionsByEnvironment(connections: ConnectionConfig[], ungroupedLabel: string) {
  const groups = new Map<string, ConnectionConfig[]>()
  for (const connection of connections) {
    const group = environmentLabel(connection) ?? ungroupedLabel
    groups.set(group, [...(groups.get(group) ?? []), connection])
  }

  return Array.from(groups.entries())
    .sort(([left], [right]) =>
      environmentSortKey(left, ungroupedLabel).localeCompare(
        environmentSortKey(right, ungroupedLabel),
      ),
    )
    .map(([name, groupConnections]) => ({
      name,
      connections: groupConnections
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name)),
    }))
}

function environmentSortKey(label: string, ungroupedLabel: string) {
  const normalized = label.toLowerCase()
  if (/\b(local|dev|development|本地)\b/.test(normalized)) return '0' // i18n-hardcoded-ok: user-entered environment aliases.
  if (/\b(test|qa|测试)\b/.test(normalized)) return '1' // i18n-hardcoded-ok: user-entered environment aliases.
  if (/\b(stage|staging|预发)\b/.test(normalized)) return '2' // i18n-hardcoded-ok: user-entered environment aliases.
  if (/\b(prod|production|生产)\b/.test(normalized)) return '3' // i18n-hardcoded-ok: user-entered environment aliases.
  return label === ungroupedLabel ? 'z' : `4-${normalized}`
}

function EnvironmentBadge({ connection }: { connection: ConnectionConfig }) {
  const label = environmentLabel(connection)
  if (!label) {
    return null
  }

  return (
    <span
      className={[
        'shrink-0 rounded border px-1 py-0 text-[10px] font-medium leading-4',
        environmentBadgeClass(connection),
      ].join(' ')}
    >
      {label}
    </span>
  )
}

function environmentLabel(connection: ConnectionConfig) {
  return connection.colorTag?.trim() || connection.group?.trim() || null
}

function environmentBadgeClass(connection: ConnectionConfig) {
  if (isProductionConnection(connection)) {
    return 'border-red-500/45 bg-red-500/10 text-red-400'
  }
  if (connection.colorTag === 'stage') {
    return 'border-amber-500/45 bg-amber-500/10 text-amber-500'
  }
  if (connection.colorTag === 'test') {
    return 'border-sky-500/45 bg-sky-500/10 text-sky-500'
  }
  if (connection.colorTag === 'dev') {
    return 'border-emerald-500/45 bg-emerald-500/10 text-emerald-500'
  }
  return 'border-border bg-muted/40 text-muted-foreground'
}

function isProductionConnection(connection: ConnectionConfig | null) {
  if (!connection) {
    return false
  }
  return [connection.colorTag, connection.group, connection.name]
    .filter(Boolean)
    .some((value) => /\b(prod|production|生产)\b/i.test(String(value))) // i18n-hardcoded-ok: user-entered environment aliases.
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
