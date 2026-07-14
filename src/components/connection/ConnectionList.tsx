import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Database, Link, Link2Off, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
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
  } = useConnectionStore()
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
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
      <div className="flex h-12 items-center justify-between border-b px-3">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold tracking-normal">{t('connection.explorerTitle')}</div>
          <div className="text-[11px] text-muted-foreground">{t('connection.dataSources')}</div>
        </div>
      </div>

      {error && (
        <div className="border-b px-3 py-2 text-xs text-destructive" title={error}>
          <div className="truncate">{error}</div>
        </div>
      )}

      <div className="flex h-10 items-center gap-1 border-b px-2">
        <ConnectionDialog
          trigger={
            <Button type="button" size="icon-sm" variant="ghost" title={t('connection.new')}>
              <Plus className="size-4" />
            </Button>
          }
        />
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          title={t('connection.refresh')}
          disabled={loading}
          onClick={() => loadConnections()}
        >
          <RefreshCw className="size-4" />
        </Button>
        <div className="mx-1 h-5 w-px bg-border" />
        <span className="text-[11px] text-muted-foreground">{t('connection.connections')}</span>
      </div>

      <div className="flex-1 overflow-auto px-1 py-1">
        {connections.length === 0 ? (
          <div className="grid h-32 place-items-center text-center text-xs text-muted-foreground">
            <div>
              <Database className="mx-auto mb-2 size-7 opacity-60" />
              <div>{t('connection.empty')}</div>
            </div>
          </div>
        ) : (
          <div className="grid gap-0.5">
            {groupedConnections.map((group) => {
              const collapsed = collapsedGroups[group.name] ?? false
              return (
                <section key={group.name} className="grid gap-0.5">
                  <button
                    type="button"
                    className="flex h-6 items-center gap-1 rounded px-1.5 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted/70"
                    onClick={() => toggleGroup(group.name)}
                  >
                    {collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
                    <span className="min-w-0 flex-1 truncate">{group.name}</span>
                    <span>{group.connections.length}</span>
                  </button>
                  {!collapsed &&
                    group.connections.map((connection) => (
                      <ConnectionCard
                        key={connection.id}
                        connection={connection}
                        status={statuses[connection.id]?.status ?? 'disconnected'}
                        selected={connection.id === activeConnectionId}
                        busy={Boolean(busyConnectionIds[connection.id])}
                        onSelect={() => selectConnection(connection.id)}
                        onConnect={() => {
                          if (!connectionReadinessIssue(connection)) {
                            void connectConnection(connection.id).then(() => selectConnection(connection.id))
                          }
                        }}
                        onDisconnect={() => disconnectConnection(connection.id)}
                        onDelete={() => removeConnection(connection.id)}
                        t={t}
                      />
                    ))}
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
  onSelect,
  onConnect,
  onDisconnect,
  onDelete,
  t,
}: {
  connection: ConnectionConfig
  status: string
  selected: boolean
  busy: boolean
  onSelect: () => void
  onConnect: () => void
  onDisconnect: () => void
  onDelete: () => void
  t: ReturnType<typeof useTranslation>['t']
}) {
  const connected = status === 'connected'
  const readinessIssue = connectionReadinessIssue(connection)

  return (
    <div
      role="button"
      tabIndex={0}
      className={[
        'group flex min-w-0 cursor-pointer items-center gap-1 rounded border-l-2 px-1.5 py-1 text-sm transition-colors',
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
          {connection.colorTag && (
            <span
              className={[
                'shrink-0 rounded border px-1 py-0 text-[10px] leading-4',
                environmentBadgeClass(connection.colorTag),
              ].join(' ')}
              title={t('connection.environmentTitle', { label: environmentLabel(connection.colorTag, t) })}
            >
              {environmentLabel(connection.colorTag, t)}
            </span>
          )}
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
      <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          title={connected ? t('connection.disconnect') : t('connection.connect')}
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
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          title={t('connection.delete')}
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 />
        </Button>
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

function environmentBadgeClass(tag: string) {
  if (tag === 'prod') return 'border-red-500/45 bg-red-500/10 text-red-400'
  if (tag === 'stage') return 'border-amber-500/45 bg-amber-500/10 text-amber-400'
  if (tag === 'test') return 'border-sky-500/45 bg-sky-500/10 text-sky-400'
  if (tag === 'dev') return 'border-emerald-500/45 bg-emerald-500/10 text-emerald-400'
  return 'border-muted-foreground/30 bg-muted/40 text-muted-foreground'
}

function environmentLabel(tag: string, t: ReturnType<typeof useTranslation>['t']) {
  if (tag === 'prod') return 'prod'
  if (tag === 'stage') return 'stage'
  if (tag === 'test') return 'test'
  if (tag === 'dev') return 'dev'
  return t('connection.noEnvironment')
}
