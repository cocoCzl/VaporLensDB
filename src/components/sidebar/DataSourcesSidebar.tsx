import { ChevronsDownUp, Crosshair, Database, Eye, EyeOff, ListFilter, MoreHorizontal, Plus, RefreshCw, Search, Settings2, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { requestNewConnection } from '@/lib/workspaceNavigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DatabaseTree } from '@/components/explorer/DatabaseTree'
import { openBrowserWorkspace } from '@/components/workspace/openBrowserWorkspace'
import { ConnectionContextMenu } from '@/components/sidebar/ConnectionContextMenu'
import { ConnectionGroup } from '@/components/sidebar/ConnectionGroup'
import { ConnectionRow } from '@/components/sidebar/ConnectionRow'
import { RenameConnectionDialog } from '@/components/sidebar/RenameConnectionDialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { handleTreeNavigation, roveTreeFocus, syncTreeTabStop } from '@/components/sidebar/treeKeyboardNavigation'
import { openDriverManager } from '@/lib/openDriverManager'
import {
  filterConnections,
  highlightDataSourceMatch,
  orderGroupConnections,
} from '@/components/sidebar/connectionPresentation'
import { useDisconnectRequest } from '@/hooks/useDisconnectRequest'
import { runConnectionGroupOperation } from '@/lib/connectionGroupOperations'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import { useMetadataStore } from '@/stores/metadataStore'
import { useUiStore } from '@/stores/uiStore'
import type { ConnectionConfig, ConnectionRuntimeStatus } from '@/types/connection'

/**
 * Connection navigation only. It deliberately reads the existing stores instead
 * of owning a parallel connection model or object-tree loading lifecycle.
 */
export function DataSourcesSidebar() {
  const { t } = useTranslation()
  const {
    connections,
    dataSourceGroups,
    statuses,
    browsingConnectionId,
    busyConnectionIds,
    favoriteDataSourceIds,
    loadConnections,
    connectConnection,
    setActiveConnection,
    toggleFavoriteDataSource,
    moveConnectionToGroup,
    removeConnection,
    renameConnection,
    saveConnection,
  } = useConnectionStore(useShallow((state) => ({
    connections: state.connections,
    dataSourceGroups: state.dataSourceGroups,
    statuses: state.statuses,
    browsingConnectionId: state.browsingConnectionId,
    busyConnectionIds: state.busyConnectionIds,
    favoriteDataSourceIds: state.favoriteDataSourceIds,
    loadConnections: state.loadConnections,
    connectConnection: state.connectConnection,
    setActiveConnection: state.setActiveConnection,
    toggleFavoriteDataSource: state.toggleFavoriteDataSource,
    moveConnectionToGroup: state.moveConnectionToGroup,
    removeConnection: state.removeConnection,
    renameConnection: state.renameConnection,
    saveConnection: state.saveConnection,
  })))
  const notifyError = useUiStore((state) => state.notifyError)
  const showSystemObjects = useUiStore((state) => state.showSystemObjects)
  const setShowSystemObjects = useUiStore((state) => state.setShowSystemObjects)
  const activeTabId = useEditorStore((state) => state.activeTabId)
  const tabs = useEditorStore((state) => state.tabs)
  const addTab = useEditorStore((state) => state.addTab)
  const setActiveTab = useEditorStore((state) => state.setActiveTab)
  const { requestDisconnect, disconnectDialog } = useDisconnectRequest()
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [expandedDataSourceIds, setExpandedDataSourceIds] = useState<Record<string, boolean>>({})
  const [contextMenu, setContextMenu] = useState<{ connection: ConnectionConfig; x: number; y: number } | null>(null)
  const [renameConnectionTarget, setRenameConnectionTarget] = useState<ConnectionConfig | null>(null)
  const [query, setQuery] = useState('')
  const [searchObjects, setSearchObjects] = useState(false)
  const treeRef = useRef<HTMLDivElement>(null)
  const connectionQuery = searchObjects ? '' : query
  const pendingMoveConnectionIds = useRef(new Set<string>())

  useLayoutEffect(() => {
    if (treeRef.current) syncTreeTabStop(treeRef.current)
  })

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

  const filteredGroups = useMemo(() => {
    const normalizedQuery = connectionQuery.trim().toLocaleLowerCase()
    return groups
      .map((group) => {
        const groupMatches = normalizedQuery.length > 0 && group.name.toLocaleLowerCase().includes(normalizedQuery)
        return {
          ...group,
          connections: groupMatches || normalizedQuery.length === 0
            ? group.connections
            : filterConnections(group.connections, connectionQuery),
        }
      })
      .filter((group) => group.connections.length > 0 || (normalizedQuery.length === 0 && group.id !== '__ungrouped__'))
  }, [groups, connectionQuery])

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

    selectConnection(connection)

    try {
      if (statuses[connection.id]?.status !== 'connected') {
        await connectConnection(connection.id, { selectForBrowsing: false })
      }
      setActiveConnection(connection.id)
    } catch {
      setExpandedDataSourceIds((current) => ({ ...current, [connection.id]: false }))
    }
  }

  function selectConnection(connection: ConnectionConfig) {
    setActiveConnection(connection.id)
    openBrowserWorkspace(connection.id, connection.name)
  }

  function openManagement() {
    const existing = tabs.find((tab) => tab.kind === 'dataSources')
    if (existing) {
      setActiveTab(existing.id)
    } else {
      addTab({ id: crypto.randomUUID(), kind: 'dataSources', title: t('connection.dataSources'), sql: '', connectionId: null })
    }
  }

  async function moveToGroup(connection: ConnectionConfig) {
    const groupName = window.prompt(
      `${t('connection.moveToGroup')} (${t('connection.ungrouped')})`,
      dataSourceGroups.find((group) => group.id === connection.groupId)?.name ?? t('connection.ungrouped'),
    )
    if (groupName === null) return
    const destination = dataSourceGroups.find((group) => group.name === groupName.trim())
    const targetGroupId = groupName.trim() === '' || groupName.trim() === t('connection.ungrouped')
      ? null
      : destination?.id
    if (targetGroupId === undefined || pendingMoveConnectionIds.current.has(connection.id)) return

    pendingMoveConnectionIds.current.add(connection.id)
    try {
      await runConnectionGroupOperation(
        () => moveConnectionToGroup(connection.id, targetGroupId),
        t('notifications.moveConnectionFailed'),
        notifyError,
      )
    } finally {
      pendingMoveConnectionIds.current.delete(connection.id)
    }
  }

  function duplicateConnection(connection: ConnectionConfig) {
    const { id, createdAt, updatedAt, ...input } = connection
    void id
    void createdAt
    void updatedAt
    void saveConnection({ ...input, name: `${connection.name} Copy` })
  }

  const currentConnectionId = tabs.find((tab) => tab.id === activeTabId)?.connectionId ?? browsingConnectionId

  function locateCurrentConnection() {
    const connection = connections.find((item) => item.id === currentConnectionId)
    if (!connection) return
    setQuery('')
    setCollapsedGroups((current) => ({ ...current, [connection.groupId ?? '__ungrouped__']: false }))
    requestAnimationFrame(() => {
      const row = Array.from(treeRef.current?.querySelectorAll<HTMLElement>('[data-connection-id]') ?? [])
        .find((item) => item.dataset.connectionId === connection.id)
      row?.focus()
      row?.scrollIntoView({ block: 'nearest' })
    })
  }

  function refreshCurrentConnection() {
    // A user action refreshes only the current, already-open connection.
    // Reloading saved configuration never opens a database session.
    void loadConnections()
    if (browsingConnectionId && statuses[browsingConnectionId]?.status === 'connected') {
      useMetadataStore.getState().requestConnectionRefresh(browsingConnectionId)
    }
  }

  const menuConnectionStatus: ConnectionRuntimeStatus = contextMenu
    ? statuses[contextMenu.connection.id]?.status ?? 'disconnected'
    : 'disconnected'

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={t('connection.dataSources')}>
      <header className="flex h-[38px] shrink-0 items-center gap-0.5 border-b border-border/55 px-2">
        <h2 className="min-w-0 flex-1 truncate pl-1 text-xs font-semibold">{t('connection.dataSources')}</h2>
        <Button type="button" size="icon-xs" variant="ghost" title={t('connection.new')} aria-label={t('connection.new')} onClick={requestNewConnection}>
          <Plus className="size-4" />
        </Button>
        <Button type="button" size="icon-xs" variant="ghost" title={t('connection.refresh')} aria-label={t('connection.refresh')} onClick={refreshCurrentConnection}>
          <RefreshCw className="size-3.5" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="icon-xs" variant="ghost" title={t('common.moreActions')} aria-label={t('common.moreActions')}><MoreHorizontal className="size-4" /></Button>} />
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => { setExpandedDataSourceIds({}); setCollapsedGroups(Object.fromEntries(groups.map((group) => [group.id, true]))) }}>
              <ChevronsDownUp />{t('connection.collapseAll')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShowSystemObjects(!showSystemObjects)}>
              {showSystemObjects ? <EyeOff /> : <Eye />}{showSystemObjects ? t('explorer.hideSystemObjects') : t('explorer.showSystemObjects')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!browsingConnectionId || statuses[browsingConnectionId]?.status !== 'connected'} onClick={() => { if (browsingConnectionId) void useMetadataStore.getState().startIndexing(browsingConnectionId) }}>
              <ListFilter />{t('explorer.indexCurrentConnection')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={openManagement}><Database />{t('connection.manageDataSources')}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => openDriverManager()}><Settings2 />{t('drivers.title')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {connections.length > 0 && <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/45 px-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="data-source-tree-search-input"
            className="h-7 min-w-0 rounded-sm border-border/70 bg-surface/70 pl-7 pr-6 text-xs shadow-none"
            value={query}
            placeholder={t(searchObjects ? 'explorer.searchPlaceholder' : 'connection.searchDataSources')}
            aria-label={t(searchObjects ? 'explorer.searchPlaceholder' : 'connection.searchDataSources')}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && <button type="button" className="absolute right-1 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground hover:text-foreground" aria-label={t('common.clear')} onClick={() => setQuery('')}><X className="size-3" /></button>}
        </div>
        <Button type="button" size="icon-xs" variant="ghost" title={t('connection.locateCurrent')} aria-label={t('connection.locateCurrent')} disabled={!currentConnectionId} onClick={locateCurrentConnection}><Crosshair className="size-3.5" /></Button>
        <Button type="button" size="icon-xs" variant={searchObjects ? 'secondary' : 'ghost'} title={t('connection.filterObjects')} aria-label={t('connection.filterObjects')} aria-pressed={searchObjects} onClick={() => { setSearchObjects(!searchObjects); setQuery('') }}><ListFilter className="size-3.5" /></Button>
      </div>}

      <div ref={treeRef} className="data-source-tree min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto py-1" role="tree" aria-label={t('connection.dataSources')} onKeyDownCapture={handleTreeNavigation} onFocusCapture={roveTreeFocus}>
        {connections.length > 0 && filteredGroups.map((group) => {
          const collapsed = connectionQuery.trim() ? false : collapsedGroups[group.id] === true
          return (
            <ConnectionGroup
              key={group.id}
              id={group.id}
              name={highlightDataSourceMatch(group.name, connectionQuery)}
              count={group.connections.length}
              collapsed={collapsed}
              onToggle={() => setCollapsedGroups((current) => ({ ...current, [group.id]: !collapsed }))}
            >
              {group.connections.map((connection) => {
                const status = statuses[connection.id]?.status ?? 'disconnected'
                const busy = Boolean(busyConnectionIds[connection.id])
                const selected = browsingConnectionId === connection.id
                const expanded = expandedDataSourceIds[connection.id] === true
                return (
                  <div key={connection.id} role="none" className="min-w-0">
                    <ConnectionRow
                      connection={connection}
                      status={status}
                      busy={busy}
                      selected={selected}
                      expanded={expanded}
                      favorite={favoriteDataSourceIds.includes(connection.id)}
                      query={connectionQuery}
                      t={t}
                      onSelect={() => selectConnection(connection)}
                      onOpen={() => openBoundSql(connection)}
                      onToggle={() => void toggleDataSourceNode(connection)}
                      onOpenMenu={({ x, y }) => setContextMenu({ connection, x, y })}
                    />
                    {expanded && status === 'connected' && (
                      <div role="group">
                        <DatabaseTree connectionId={connection.id} compact filterQuery={searchObjects ? query : ''} />
                      </div>
                    )}
                    {expanded && status === 'failed' && (
                      <div className="ml-10 px-2 py-1.5 text-[11px] text-danger">
                        {statuses[connection.id]?.message ?? t('explorer.loadFailed')}
                      </div>
                    )}
                  </div>
                )
              })}
            </ConnectionGroup>
          )
        })}
        {connections.length === 0 ? (
          <div className="space-y-2 px-3 py-4 text-xs text-muted-foreground">
            <p>{t('connection.empty')}</p>
            <Button type="button" size="sm" variant="outline" onClick={requestNewConnection}><Plus />{t('connection.new')}</Button>
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground" role="status">{t('connection.noMatches')}</div>
        ) : null}
      </div>

      <ConnectionContextMenu
        context={contextMenu}
        status={menuConnectionStatus}
        busy={contextMenu ? Boolean(busyConnectionIds[contextMenu.connection.id]) : false}
        favorite={contextMenu ? favoriteDataSourceIds.includes(contextMenu.connection.id) : false}
        t={t}
        onClose={() => setContextMenu(null)}
        onConnect={(connection) => void connectConnection(connection.id)}
        onDisconnect={(connection) => void requestDisconnect(connection)}
        onNewQuery={openBoundSql}
        onRefresh={(connection) => useMetadataStore.getState().requestConnectionRefresh(connection.id)}
        onEdit={openManagement}
        onRename={setRenameConnectionTarget}
        onDuplicate={duplicateConnection}
        onMove={moveToGroup}
        onToggleFavorite={(connection) => toggleFavoriteDataSource(connection.id)}
        onDelete={(connection) => {
          if (window.confirm(`${t('common.delete')} ${connection.name}?`)) {
            void removeConnection(connection.id)
          }
        }}
      />

      <RenameConnectionDialog
        key={renameConnectionTarget?.id ?? 'closed'}
        connection={renameConnectionTarget}
        open={Boolean(renameConnectionTarget)}
        onOpenChange={(open) => { if (!open) setRenameConnectionTarget(null) }}
        onSave={async (connection, name) => { await renameConnection(connection.id, name) }}
      />

      {disconnectDialog}
    </section>
  )
}
