import { Plus, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { ConnectionDialog } from '@/components/connection/ConnectionDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DatabaseTree } from '@/components/explorer/DatabaseTree'
import { ConnectionContextMenu } from '@/components/sidebar/ConnectionContextMenu'
import { ConnectionGroup } from '@/components/sidebar/ConnectionGroup'
import { ConnectionRow } from '@/components/sidebar/ConnectionRow'
import { RecentSection } from '@/components/sidebar/RecentSection'
import {
  filterConnections,
  highlightDataSourceMatch,
  orderGroupConnections,
} from '@/components/sidebar/connectionPresentation'
import { useDisconnectRequest } from '@/hooks/useDisconnectRequest'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import { useMetadataStore } from '@/stores/metadataStore'
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
    recentDataSourceIds,
    favoriteDataSourceIds,
    loadConnections,
    connectConnection,
    setActiveConnection,
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
    recentDataSourceIds: state.recentDataSourceIds,
    favoriteDataSourceIds: state.favoriteDataSourceIds,
    loadConnections: state.loadConnections,
    connectConnection: state.connectConnection,
    setActiveConnection: state.setActiveConnection,
    toggleFavoriteDataSource: state.toggleFavoriteDataSource,
    moveConnectionToGroup: state.moveConnectionToGroup,
    removeConnection: state.removeConnection,
    saveConnection: state.saveConnection,
  })))
  const tabs = useEditorStore((state) => state.tabs)
  const addTab = useEditorStore((state) => state.addTab)
  const setActiveTab = useEditorStore((state) => state.setActiveTab)
  const { requestDisconnect, disconnectDialog } = useDisconnectRequest()
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [expandedDataSourceIds, setExpandedDataSourceIds] = useState<Record<string, boolean>>({})
  const [contextMenu, setContextMenu] = useState<{ connection: ConnectionConfig; x: number; y: number } | null>(null)
  const [query, setQuery] = useState('')

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
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return groups
      .map((group) => {
        const groupMatches = normalizedQuery.length > 0 && group.name.toLocaleLowerCase().includes(normalizedQuery)
        return {
          ...group,
          connections: groupMatches || normalizedQuery.length === 0
            ? group.connections
            : filterConnections(group.connections, query),
        }
      })
      .filter((group) => group.connections.length > 0 || (normalizedQuery.length === 0 && group.id !== '__ungrouped__'))
  }, [groups, query])

  const recentConnections = useMemo(() => recentDataSourceIds
    .map((id) => connections.find((connection) => connection.id === id))
    .filter((connection): connection is ConnectionConfig => Boolean(connection)), [connections, recentDataSourceIds])

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
        await connectConnection(connection.id, { selectForBrowsing: false })
      }
      setActiveConnection(connection.id)
    } catch {
      setExpandedDataSourceIds((current) => ({ ...current, [connection.id]: false }))
    }
  }

  function openManagement() {
    const existing = tabs.find((tab) => tab.kind === 'dataSources')
    if (existing) {
      setActiveTab(existing.id)
    } else {
      addTab({ id: crypto.randomUUID(), kind: 'dataSources', title: t('connection.dataSources'), sql: '', connectionId: null })
    }
  }

  function moveToGroup(connection: ConnectionConfig) {
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
  }

  function duplicateConnection(connection: ConnectionConfig) {
    const { id, createdAt, updatedAt, ...input } = connection
    void id
    void createdAt
    void updatedAt
    void saveConnection({ ...input, name: `${connection.name} Copy` })
  }

  const menuConnectionStatus: ConnectionRuntimeStatus = contextMenu
    ? statuses[contextMenu.connection.id]?.status ?? 'disconnected'
    : 'disconnected'

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={t('connection.dataSources')}>
      <header className="flex h-11 shrink-0 items-center border-b border-border/55 px-3.5">
        <h2 className="min-w-0 flex-1 truncate text-[14px] font-[650] tracking-[-0.02em]">{t('connection.dataSources')}</h2>
        <ConnectionDialog
          trigger={
            <Button type="button" size="icon-xs" variant="ghost" className="rounded-md hover:bg-primary/[0.07] hover:text-primary" title={t('connection.new')} aria-label={t('connection.new')}>
              <Plus />
            </Button>
          }
        />
      </header>

      <div className="shrink-0 border-b border-border/45 px-3.5 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="data-source-tree-search-input"
            className="h-9 rounded-lg border-border/80 bg-surface-secondary/75 pl-8 text-xs shadow-none hover:bg-surface focus-visible:bg-surface"
            value={query}
            placeholder={t('connection.searchDataSources')}
            aria-label={t('connection.searchDataSources')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-2" role="tree" aria-label={t('connection.dataSources')}>
        {filteredGroups.map((group) => {
          const collapsed = query.trim() ? false : collapsedGroups[group.id] === true
          return (
            <ConnectionGroup
              key={group.id}
              id={group.id}
              name={highlightDataSourceMatch(group.name, query)}
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
                  <div key={connection.id}>
                    <ConnectionRow
                      connection={connection}
                      status={status}
                      busy={busy}
                      selected={selected}
                      expanded={expanded}
                      favorite={favoriteDataSourceIds.includes(connection.id)}
                      query={query}
                      t={t}
                      onSelect={() => setActiveConnection(connection.id)}
                      onOpen={() => openBoundSql(connection)}
                      onToggle={() => void toggleDataSourceNode(connection)}
                      onOpenMenu={({ x, y }) => setContextMenu({ connection, x, y })}
                    />
                    {expanded && status === 'connected' && (
                      <div className="ml-5 border-l border-border-subtle/75 pl-1">
                        <DatabaseTree connectionId={connection.id} compact />
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
        {filteredGroups.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">{t('connection.noMatches')}</div>
        )}
        {!query.trim() && (
          <RecentSection
            connections={recentConnections}
            activeConnectionId={browsingConnectionId}
            onSelect={(connection) => setActiveConnection(connection.id)}
            t={t}
          />
        )}
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
        onRefresh={(connection) => useMetadataStore.getState().clearConnection(connection.id)}
        onEdit={openManagement}
        onDuplicate={duplicateConnection}
        onMove={moveToGroup}
        onToggleFavorite={(connection) => toggleFavoriteDataSource(connection.id)}
        onDelete={(connection) => {
          if (window.confirm(`${t('common.delete')} ${connection.name}?`)) {
            void removeConnection(connection.id)
          }
        }}
      />

      {disconnectDialog}
    </section>
  )
}
