import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Database, Link, Link2Off, Pencil, Plus, RefreshCw, Star, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconTooltipButton } from '@/components/common/IconTooltipButton'
import { ConnectionDialog } from '@/components/connection/ConnectionDialog'
import { useConnectionStore } from '@/stores/connectionStore'
import type { ConnectionConfig } from '@/types/connection'

export function ConnectionList({
  mode = 'sidebar',
  managerSelectedConnectionId,
  onManagerSelect,
}: {
  mode?: 'sidebar' | 'manager'
  managerSelectedConnectionId?: string | null
  onManagerSelect?: (connection: ConnectionConfig) => void
}) {
  const { t } = useTranslation()
  const {
    connections,
    statuses,
    busyConnectionIds,
    loading,
    error,
    loadConnections,
    connectConnection,
    disconnectConnection,
    removeConnection,
    activeConnectionId,
    setActiveConnection,
    favoriteDataSourceIds,
    toggleFavoriteDataSource,
    dataSourceGroups,
    renameGroup,
    reorderGroups,
    deleteGroup,
    moveConnectionToGroup,
  } = useConnectionStore()
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>([])
  const [managerSearch, setManagerSearch] = useState('')
  const [managerDriver, setManagerDriver] = useState('all')
  const [managerGroup, setManagerGroup] = useState('all')
  const managerMode = mode === 'manager'
  const ungroupedLabel = t('connection.ungrouped')
  const filteredConnections = useMemo(() => {
    const term = managerSearch.trim().toLocaleLowerCase()
    return connections.filter((connection) => {
      const searchable = [connection.name, connection.driverType, connection.host, connection.database, connection.group]
        .filter(Boolean).join(' ').toLocaleLowerCase()
      return (!term || searchable.includes(term))
        && (managerDriver === 'all' || connection.driverType === managerDriver)
        && (managerGroup === 'all' || (managerGroup === '__ungrouped__' ? !connection.groupId : connection.groupId === managerGroup))
    })
  }, [connections, managerDriver, managerGroup, managerSearch])
  const groupedConnections = useMemo(
    () => groupConnections(
      filteredConnections,
      ungroupedLabel,
      managerMode
        ? !managerSearch.trim() && managerDriver === 'all'
          ? dataSourceGroups.filter((group) => managerGroup === 'all' || managerGroup === group.id)
          : []
        : dataSourceGroups,
      favoriteDataSourceIds,
    ),
    [dataSourceGroups, favoriteDataSourceIds, filteredConnections, managerDriver, managerGroup, managerMode, managerSearch, ungroupedLabel],
  )

  useEffect(() => {
    loadConnections()
  }, [loadConnections])

  function toggleGroup(group: string) {
    setCollapsedGroups((state) => ({ ...state, [group]: !state[group] }))
  }

  function selectConnection(connection: ConnectionConfig) {
    if (managerMode && onManagerSelect) {
      onManagerSelect(connection)
      return
    }
    setActiveConnection(connection.id)
  }

  return (
    <div
      className={[
        'flex flex-col ide-surface',
        mode === 'manager' ? 'h-full min-h-0 rounded-none border-0' : 'max-h-[43%] min-h-44',
      ].join(' ')}
    >
      {!managerMode && (
        <div className="flex h-12 items-center justify-between border-b px-3">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold tracking-normal">{t('connection.explorerTitle')}</div>
            <div className="text-[11px] text-muted-foreground">{t('connection.dataSources')}</div>
          </div>
        </div>
      )}

      {managerMode && selectedConnectionIds.length > 0 && (
        <div className="flex h-10 shrink-0 items-center gap-2 border-b bg-muted/30 px-4 text-xs">
          <span className="min-w-0 flex-1 truncate font-medium">{t('connection.selectedCount', { count: selectedConnectionIds.length })}</span>
          <select
            className="ide-select h-7 max-w-52 text-xs"
            defaultValue=""
            aria-label={t('connection.moveToGroup')}
            onChange={(event) => {
              const value = event.target.value || null
              if (event.target.value === '') return
              void Promise.all(selectedConnectionIds.map((id) => moveConnectionToGroup(id, value === '__ungrouped__' ? null : value)))
                .then(() => setSelectedConnectionIds([]))
              event.currentTarget.value = ''
            }}
          >
            <option value="" disabled>{t('connection.moveToGroup')}</option>
            <option value="__ungrouped__">{t('connection.ungrouped')}</option>
            {dataSourceGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
          <IconTooltipButton
            size="icon-xs"
            label={selectedConnectionIds.every((id) => favoriteDataSourceIds.includes(id))
              ? t('connection.unfavorite')
              : t('connection.favorite')}
            variant="ghost"
            onClick={() => {
              const allFavorites = selectedConnectionIds.every((id) => favoriteDataSourceIds.includes(id))
              selectedConnectionIds.forEach((id) => {
                if (favoriteDataSourceIds.includes(id) === allFavorites) toggleFavoriteDataSource(id)
              })
              setSelectedConnectionIds([])
            }}
          >
            <Star />
          </IconTooltipButton>
          <IconTooltipButton
            size="icon-xs"
            label={t('common.delete')}
            variant="ghost"
            onClick={() => {
              const selected = connections.filter((connection) => selectedConnectionIds.includes(connection.id))
              const summary = selected.slice(0, 3).map((connection) => connection.name).join(', ')
              if (!window.confirm(`${t('common.delete')} ${selected.length}: ${summary}${selected.length > 3 ? '…' : ''}?`)) return
              void selected.reduce<Promise<void>>((chain, connection) => chain.then(() => removeConnection(connection.id)), Promise.resolve())
                .then(() => setSelectedConnectionIds([]))
            }}
          >
            <Trash2 />
          </IconTooltipButton>
        </div>
      )}

      {managerMode && (
        <div className="grid shrink-0 gap-2 border-b bg-muted/20 px-4 py-2 sm:grid-cols-[minmax(0,1fr)_8rem_10rem]">
          <input
            className="ide-input h-8 min-w-0 text-xs"
            value={managerSearch}
            placeholder={t('connection.searchDataSources')}
            aria-label={t('connection.searchDataSources')}
            onChange={(event) => setManagerSearch(event.target.value)}
          />
          <select className="ide-select h-8 text-xs" value={managerDriver} onChange={(event) => setManagerDriver(event.target.value)}>
            <option value="all">{t('connectionForm.driver')}</option>
            {[...new Set(connections.map((connection) => connection.driverType))].sort().map((driver) => <option key={driver} value={driver}>{driver}</option>)}
          </select>
          <select className="ide-select h-8 text-xs" value={managerGroup} onChange={(event) => setManagerGroup(event.target.value)}>
            <option value="all">{t('connectionForm.group')}</option>
            <option value="__ungrouped__">{t('connection.ungrouped')}</option>
            {dataSourceGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
        </div>
      )}

      {error && (
        <div className="border-b px-3 py-2 text-xs text-destructive" title={error}>
          <div className="truncate">{error}</div>
        </div>
      )}

      {!managerMode && (
        <div className="flex h-10 items-center gap-1 border-b px-2">
          <ConnectionDialog
            trigger={
              <IconTooltipButton label={t('connection.new')} variant="ghost">
                <Plus className="size-4" />
              </IconTooltipButton>
            }
          />
          <IconTooltipButton
            label={t('connection.refresh')}
            variant="ghost"
            disabled={loading}
            onClick={() => loadConnections()}
          >
            <RefreshCw className="size-4" />
          </IconTooltipButton>
        </div>
      )}

      <div className={managerMode ? 'flex-1 overflow-auto p-4' : 'flex-1 overflow-auto px-1 py-1'}>
        {filteredConnections.length === 0 ? (
          <div className="grid h-32 place-items-center text-center text-xs text-muted-foreground">
            <div>
              <Database className="mx-auto mb-2 size-7 opacity-60" />
              <div>{t('connection.empty')}</div>
            </div>
          </div>
        ) : (
          <div className={managerMode ? 'grid gap-5' : 'grid gap-0.5'}>
            {groupedConnections.map((group) => {
              const collapsed = collapsedGroups[group.id] ?? false
              const dataSourceGroup = dataSourceGroups.find((item) => item.id === group.id)
              return (
                <section key={group.id} className={managerMode ? 'grid gap-2' : 'grid gap-0.5'}>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className={managerMode
                        ? 'flex h-8 min-w-0 flex-1 items-center gap-1 rounded px-2 text-left text-xs font-semibold text-muted-foreground hover:bg-muted/70'
                        : 'flex h-6 min-w-0 flex-1 items-center gap-1 rounded px-1.5 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted/70'}
                      onClick={() => toggleGroup(group.id)}
                    >
                    {collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
                    <span className="min-w-0 flex-1 truncate">{group.name}</span>
                    <span>{group.connections.length}</span>
                    </button>
                    {managerMode && dataSourceGroup && (
                      <span className="flex shrink-0 items-center">
                        <IconTooltipButton
                          size="icon-xs"
                          label={t('common.moveUp')}
                          variant="ghost"
                          disabled={dataSourceGroups.findIndex((item) => item.id === dataSourceGroup.id) === 0}
                          onClick={() => {
                            const index = dataSourceGroups.findIndex((item) => item.id === dataSourceGroup.id)
                            if (index < 1) return
                            const ids = dataSourceGroups.map((item) => item.id)
                            ;[ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]
                            void reorderGroups(ids)
                          }}
                        ><ArrowUp /></IconTooltipButton>
                        <IconTooltipButton
                          size="icon-xs"
                          label={t('common.moveDown')}
                          variant="ghost"
                          disabled={dataSourceGroups.findIndex((item) => item.id === dataSourceGroup.id) === dataSourceGroups.length - 1}
                          onClick={() => {
                            const index = dataSourceGroups.findIndex((item) => item.id === dataSourceGroup.id)
                            if (index < 0 || index === dataSourceGroups.length - 1) return
                            const ids = dataSourceGroups.map((item) => item.id)
                            ;[ids[index], ids[index + 1]] = [ids[index + 1], ids[index]]
                            void reorderGroups(ids)
                          }}
                        ><ArrowDown /></IconTooltipButton>
                        <IconTooltipButton
                          size="icon-xs"
                          label={t('connection.edit')}
                          variant="ghost"
                          onClick={() => {
                            const name = window.prompt(t('connectionForm.newGroupPlaceholder'), dataSourceGroup.name)
                            if (name?.trim() && name.trim() !== dataSourceGroup.name) {
                              void renameGroup(dataSourceGroup.id, name.trim())
                            }
                          }}
                        >
                          <Pencil />
                        </IconTooltipButton>
                        <IconTooltipButton
                          size="icon-xs"
                          label={t('common.delete')}
                          variant="ghost"
                          onClick={() => {
                            const affected = connections.filter((connection) => connection.groupId === dataSourceGroup.id).length
                            if (window.confirm(`${t('common.delete')} ${dataSourceGroup.name}? ${affected > 0 ? `${affected} ${t('connection.dataSources')} → ${t('connection.ungrouped')}` : ''}`)) {
                              void deleteGroup(dataSourceGroup.id)
                            }
                          }}
                        >
                          <Trash2 />
                        </IconTooltipButton>
                      </span>
                    )}
                  </div>
                  {!collapsed && (
                    <div className="grid gap-0.5">
                    {group.connections.map((connection) => (
                      <ConnectionCard
                        key={connection.id}
                        connection={connection}
                        status={statuses[connection.id]?.status ?? 'disconnected'}
                        selected={managerMode && onManagerSelect
                          ? connection.id === managerSelectedConnectionId
                          : connection.id === activeConnectionId}
                        busy={Boolean(busyConnectionIds[connection.id])}
                        managerMode={managerMode}
                        selectedForBatch={selectedConnectionIds.includes(connection.id)}
                        onToggleBatch={() => setSelectedConnectionIds((current) => current.includes(connection.id)
                          ? current.filter((id) => id !== connection.id)
                          : [...current, connection.id])}
                        onSelect={() => selectConnection(connection)}
                        onConnect={() => {
                          if (!connectionReadinessIssue(connection)) {
                            void connectConnection(connection.id).then(() => {
                              if (managerMode && onManagerSelect) onManagerSelect(connection)
                              else setActiveConnection(connection.id)
                            })
                          }
                        }}
                        onDisconnect={() => disconnectConnection(connection.id)}
                        onDelete={() => removeConnection(connection.id)}
                        favorite={favoriteDataSourceIds.includes(connection.id)}
                        onToggleFavorite={() => toggleFavoriteDataSource(connection.id)}
                        onEdit={managerMode && onManagerSelect ? () => onManagerSelect(connection) : undefined}
                        t={t}
                      />
                    ))}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function ConnectionCard({
  connection,
  status,
  selected,
  busy,
  managerMode,
  selectedForBatch,
  onToggleBatch,
  onSelect,
  onConnect,
  onDisconnect,
  onDelete,
  favorite,
  onToggleFavorite,
  onEdit,
  t,
}: {
  connection: ConnectionConfig
  status: string
  selected: boolean
  busy: boolean
  managerMode: boolean
  selectedForBatch: boolean
  onToggleBatch: () => void
  onSelect: () => void
  onConnect: () => void
  onDisconnect: () => void
  onDelete: () => void
  favorite: boolean
  onToggleFavorite: () => void
  onEdit?: () => void
  t: ReturnType<typeof useTranslation>['t']
}) {
  const connected = status === 'connected'
  const readinessIssue = connectionReadinessIssue(connection)

  return (
    <div
      role="button"
      tabIndex={0}
      className={[
        managerMode
          ? 'content-visibility-auto group flex h-9 min-w-0 cursor-pointer items-center gap-2 rounded border border-transparent px-2 text-xs transition-colors hover:border-border'
          : 'content-visibility-auto group flex min-w-0 cursor-pointer items-center gap-1 rounded border-l-2 px-1.5 py-1 text-sm transition-colors',
        selected
          ? 'border-l-primary bg-primary/15 text-foreground ring-1 ring-primary/30'
          : 'border-l-transparent bg-transparent hover:bg-muted/70',
      ].join(' ')}
      aria-current={selected ? 'true' : undefined}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
    >
      {managerMode && (
        <button
          type="button"
          role="checkbox"
          aria-checked={selectedForBatch}
          aria-label={connection.name}
          className={[
            'grid size-3.5 shrink-0 place-items-center rounded-[3px] border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
            selectedForBatch
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-muted-foreground/55 bg-background text-transparent hover:border-primary/70',
          ].join(' ')}
          onClick={(event) => {
            event.stopPropagation()
            onToggleBatch()
          }}
        >
          <Check className="size-3 stroke-[3]" />
        </button>
      )}
      <Database
        className={[
          'size-4 shrink-0',
          selected ? 'text-primary' : connected ? 'text-emerald-500' : 'text-muted-foreground',
        ].join(' ')}
      />
      <div className="min-w-0 flex-1">
        <div className={managerMode ? 'flex min-w-0 items-center gap-2' : 'flex min-w-0 items-center gap-1.5'}>
          <span className="min-w-24 truncate font-medium leading-5">{connection.name}</span>
          <span
            className={[
              'size-1.5 shrink-0 rounded-full',
              connected
                ? 'bg-emerald-500'
                : readinessIssue
                  ? 'bg-amber-500'
                  : 'bg-muted-foreground/40',
            ].join(' ')}
            title={readinessIssue ?? status}
          />
          {managerMode ? (
            <>
              <span className="w-16 shrink-0 text-[11px] text-muted-foreground">{connection.driverType}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                {readinessIssue ? t('connection.notReady') : compactConnectionTarget(connection)}
              </span>
            </>
          ) : (
            <span className="hidden" />
          )}
        </div>
        {!managerMode && (
          <div className="truncate text-[11px] leading-4 text-muted-foreground">
            {connection.driverType} · {readinessIssue ? t('connection.notReady') : compactConnectionTarget(connection)}
          </div>
        )}
      </div>
      <div className={managerMode
        ? 'flex shrink-0 items-center gap-0.5 opacity-100'
        : 'flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100'}>
        <IconTooltipButton
          size="icon-xs"
          label={connected ? t('connection.disconnect') : t('connection.connect')}
          variant="ghost"
          disabled={busy || Boolean(readinessIssue)}
          onClick={(event) => {
            event.stopPropagation()
            if (connected) {
              onDisconnect()
            } else {
              onConnect()
            }
          }}
        >
          {busy ? <RefreshCw className="animate-spin" /> : connected ? <Link2Off /> : <Link />}
        </IconTooltipButton>
        {onEdit ? (
          <IconTooltipButton size="icon-xs" label={t('connection.edit')} variant="ghost" onClick={(event) => {
            event.stopPropagation()
            onEdit()
          }}>
            <Pencil />
          </IconTooltipButton>
        ) : (
          <ConnectionDialog
            connection={connection}
            trigger={
              <IconTooltipButton size="icon-xs" label={t('connection.edit')} variant="ghost">
                <Pencil />
              </IconTooltipButton>
            }
          />
        )}
        <IconTooltipButton
          size="icon-xs"
          label={favorite ? t('connection.unfavorite') : t('connection.favorite')}
          variant="ghost"
          aria-pressed={favorite}
          onClick={(event) => {
            event.stopPropagation()
            onToggleFavorite()
          }}
        >
          <Star className={favorite ? 'fill-current text-amber-500' : ''} />
        </IconTooltipButton>
        <IconTooltipButton
          size="icon-xs"
          label={t('connection.delete')}
          variant="ghost"
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 />
        </IconTooltipButton>
      </div>
    </div>
  )
}

function compactConnectionTarget(connection: ConnectionConfig) {
  const host = connection.host ?? connection.connectionUrl ?? '-'
  const port = connection.port ? `:${connection.port}` : ''
  const database = connection.database ? `/${connection.database}` : ''
  return `${connection.username ?? '-'}@${host}${port}${database}`
}

function connectionReadinessIssue(connection: ConnectionConfig) {
  if (connection.driverType !== 'oracle' && connection.driverType !== 'jdbc') {
    return null
  }
  if (!connection.driverClass?.trim()) {
    return 'Missing JDBC driver class'
  }
  if (!connection.driverPaths?.length) {
    return 'Missing local JDBC JAR'
  }
  return null
}

function groupConnections(
  connections: ConnectionConfig[],
  ungroupedLabel: string,
  persistedGroups: { id: string; name: string }[] = [],
  favoriteDataSourceIds: string[] = [],
) {
  const groups = new Map<string, { id: string; name: string; order: number; connections: ConnectionConfig[] }>()
  for (const [order, group] of persistedGroups.entries()) {
    groups.set(group.id, { ...group, order, connections: [] })
  }
  for (const connection of connections) {
    const id = connection.groupId ?? '__ungrouped__'
    const name = connection.group?.trim() || ungroupedLabel
    const group = groups.get(id) ?? {
      id,
      name,
      // Legacy imports can briefly contain a group name without an ID. Keep it
      // visible and deterministic until config migration assigns its stable ID.
      order: persistedGroups.length,
      connections: [],
    }
    group.connections.push(connection)
    groups.set(id, group)
  }

  return [...groups.values()]
    .sort((left, right) => groupSortKey(left) - groupSortKey(right) || left.name.localeCompare(right.name))
    .map((group) => ({
      ...group,
      connections: group.connections
        .slice()
        .sort((left, right) => Number(favoriteDataSourceIds.includes(right.id)) - Number(favoriteDataSourceIds.includes(left.id)) || left.name.localeCompare(right.name)),
    }))
}

function groupSortKey(group: { id: string; order: number }) {
  return group.id === '__ungrouped__' ? Number.MAX_SAFE_INTEGER : group.order
}
