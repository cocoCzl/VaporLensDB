import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Database, Link, Link2Off, Pencil, Plus, RefreshCw, Star, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconTooltipButton } from '@/components/common/IconTooltipButton'
import { ConnectionDialog } from '@/components/connection/ConnectionDialog'
import { useConnectionStore } from '@/stores/connectionStore'
import type { ConnectionConfig } from '@/types/connection'

export function ConnectionList({ mode = 'sidebar' }: { mode?: 'sidebar' | 'manager' }) {
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
  } = useConnectionStore()
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const managerMode = mode === 'manager'
  const ungroupedLabel = t('connection.ungrouped')
  const groupedConnections = useMemo(
    () => groupConnections(connections, ungroupedLabel),
    [connections, ungroupedLabel],
  )

  useEffect(() => {
    loadConnections()
  }, [loadConnections])

  function toggleGroup(group: string) {
    setCollapsedGroups((state) => ({ ...state, [group]: !state[group] }))
  }

  function selectConnection(id: string) {
    setActiveConnection(id)
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
        {connections.length === 0 ? (
          <div className="grid h-32 place-items-center text-center text-xs text-muted-foreground">
            <div>
              <Database className="mx-auto mb-2 size-7 opacity-60" />
              <div>{t('connection.empty')}</div>
            </div>
          </div>
        ) : (
          <div className={managerMode ? 'grid gap-5' : 'grid gap-0.5'}>
            {groupedConnections.map((group) => {
              const collapsed = collapsedGroups[group.name] ?? false
              return (
                <section key={group.name} className={managerMode ? 'grid gap-2' : 'grid gap-0.5'}>
                  <button
                    type="button"
                    className={managerMode
                      ? 'flex h-8 items-center gap-1 rounded px-2 text-left text-xs font-semibold text-muted-foreground hover:bg-muted/70'
                      : 'flex h-6 items-center gap-1 rounded px-1.5 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted/70'}
                    onClick={() => toggleGroup(group.name)}
                  >
                    {collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
                    <span className="min-w-0 flex-1 truncate">{group.name}</span>
                    <span>{group.connections.length}</span>
                  </button>
                  {!collapsed && (
                    <div className={managerMode ? 'grid gap-3 sm:grid-cols-2 2xl:grid-cols-3' : 'grid gap-0.5'}>
                    {group.connections.map((connection) => (
                      <ConnectionCard
                        key={connection.id}
                        connection={connection}
                        status={statuses[connection.id]?.status ?? 'disconnected'}
                        selected={connection.id === activeConnectionId}
                        busy={Boolean(busyConnectionIds[connection.id])}
                        managerMode={managerMode}
                        onSelect={() => selectConnection(connection.id)}
                        onConnect={() => {
                          if (!connectionReadinessIssue(connection)) {
                            void connectConnection(connection.id).then(() => selectConnection(connection.id))
                          }
                        }}
                        onDisconnect={() => disconnectConnection(connection.id)}
                        onDelete={() => removeConnection(connection.id)}
                        favorite={favoriteDataSourceIds.includes(connection.id)}
                        onToggleFavorite={() => toggleFavoriteDataSource(connection.id)}
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
  onSelect,
  onConnect,
  onDisconnect,
  onDelete,
  favorite,
  onToggleFavorite,
  t,
}: {
  connection: ConnectionConfig
  status: string
  selected: boolean
  busy: boolean
  managerMode: boolean
  onSelect: () => void
  onConnect: () => void
  onDisconnect: () => void
  onDelete: () => void
  favorite: boolean
  onToggleFavorite: () => void
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
          ? 'group flex min-w-0 cursor-pointer items-center gap-2 rounded-md border px-3 py-3 text-sm shadow-sm transition-colors'
          : 'group flex min-w-0 cursor-pointer items-center gap-1 rounded border-l-2 px-1.5 py-1 text-sm transition-colors',
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
      <Database
        className={[
          'size-4 shrink-0',
          selected ? 'text-primary' : connected ? 'text-emerald-500' : 'text-muted-foreground',
        ].join(' ')}
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium leading-5">{connection.name}</span>
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
        </div>
        <div className="truncate text-[11px] leading-4 text-muted-foreground">
          {connection.driverType} · {readinessIssue ? t('connection.notReady') : compactConnectionTarget(connection)}
        </div>
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
        <ConnectionDialog
          connection={connection}
          trigger={
            <IconTooltipButton size="icon-xs" label={t('connection.edit')} variant="ghost">
              <Pencil />
            </IconTooltipButton>
          }
        />
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

function groupConnections(connections: ConnectionConfig[], ungroupedLabel: string) {
  const groups = new Map<string, ConnectionConfig[]>()
  for (const connection of connections) {
    const group = connection.group?.trim() || ungroupedLabel
    groups.set(group, [...(groups.get(group) ?? []), connection])
  }

  return [...groups.entries()]
    .sort(([left], [right]) =>
      groupSortKey(left, ungroupedLabel).localeCompare(groupSortKey(right, ungroupedLabel)),
    )
    .map(([name, groupConnections]) => ({
      name,
      connections: groupConnections
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name)),
    }))
}

function groupSortKey(group: string, ungroupedLabel: string) {
  return group === ungroupedLabel ? '\uffff' : group
}
