import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Database, Link, Link2Off, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConnectionDialog } from '@/components/connection/ConnectionDialog'
import { useConnectionStore } from '@/stores/connectionStore'
import type { ConnectionConfig } from '@/types/connection'

export function ConnectionList() {
  const {
    connections,
    statuses,
    loading,
    error,
    loadConnections,
    connectConnection,
    disconnectConnection,
    removeConnection,
  } = useConnectionStore()
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const groupedConnections = useMemo(() => groupConnections(connections), [connections])

  useEffect(() => {
    loadConnections()
  }, [loadConnections])

  function toggleGroup(group: string) {
    setCollapsedGroups((state) => ({ ...state, [group]: !state[group] }))
  }

  return (
    <div className="flex max-h-[43%] min-h-44 flex-col ide-surface">
      <div className="flex h-12 items-center justify-between border-b px-3">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold tracking-normal">数据库资源管理器</div>
          <div className="text-[11px] text-muted-foreground">Data Sources</div>
        </div>
      </div>

      {error && <div className="border-b px-3 py-2 text-xs text-destructive">{error}</div>}

      <div className="flex h-10 items-center gap-1 border-b px-2">
        <ConnectionDialog
          trigger={
            <Button type="button" size="icon-sm" variant="ghost" title="新建连接">
              <Plus className="size-4" />
            </Button>
          }
        />
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          title="刷新连接"
          disabled={loading}
          onClick={() => loadConnections()}
        >
          <RefreshCw className="size-4" />
        </Button>
        <div className="mx-1 h-5 w-px bg-border" />
        <span className="text-[11px] text-muted-foreground">连接</span>
      </div>

      <div className="flex-1 overflow-auto px-1 py-1">
        {connections.length === 0 ? (
          <div className="grid h-32 place-items-center text-center text-xs text-muted-foreground">
            <div>
              <Database className="mx-auto mb-2 size-7 opacity-60" />
              <div>暂无数据源</div>
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
                        loading={loading}
                        onConnect={() => connectConnection(connection.id)}
                        onDisconnect={() => disconnectConnection(connection.id)}
                        onDelete={() => removeConnection(connection.id)}
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
  loading,
  onConnect,
  onDisconnect,
  onDelete,
}: {
  connection: ConnectionConfig
  status: string
  loading: boolean
  onConnect: () => void
  onDisconnect: () => void
  onDelete: () => void
}) {
  const connected = status === 'connected'

  return (
    <div
      className={[
        'group flex min-w-0 items-center gap-1 rounded px-1.5 py-1 text-sm transition-colors',
        connected
          ? 'bg-primary/10 text-foreground ring-1 ring-primary/25'
          : 'bg-transparent hover:bg-muted/70',
      ].join(' ')}
    >
      <Database
        className={[
          'size-4 shrink-0',
          connected ? 'text-primary' : 'text-muted-foreground',
        ].join(' ')}
      />
      <span
        className={[
          'size-2 shrink-0 rounded-full border',
          environmentDotClass(connection.colorTag ?? ''),
        ].join(' ')}
        title={environmentLabel(connection.colorTag ?? '')}
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium leading-5">{connection.name}</span>
          <span
            className={[
              'size-1.5 shrink-0 rounded-full',
              connected ? 'bg-emerald-500' : 'bg-muted-foreground/40',
            ].join(' ')}
            title={status}
          />
        </div>
        <div className="truncate text-[11px] leading-4 text-muted-foreground">
          {connection.driverType} · {compactConnectionTarget(connection)}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          title={connected ? '断开连接' : '连接'}
          disabled={loading}
          onClick={connected ? onDisconnect : onConnect}
        >
          {connected ? <Link2Off /> : <Link />}
        </Button>
        <ConnectionDialog
          connection={connection}
          trigger={
            <Button type="button" size="icon-xs" variant="ghost" title="编辑连接">
              <Pencil />
            </Button>
          }
        />
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          title="删除连接"
          disabled={loading}
          onClick={onDelete}
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

function groupConnections(connections: ConnectionConfig[]) {
  const groups = new Map<string, ConnectionConfig[]>()
  for (const connection of connections) {
    const group = connection.group?.trim() || '未分组'
    groups.set(group, [...(groups.get(group) ?? []), connection])
  }

  return [...groups.entries()]
    .sort(([left], [right]) => groupSortKey(left).localeCompare(groupSortKey(right)))
    .map(([name, groupConnections]) => ({
      name,
      connections: groupConnections
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name)),
    }))
}

function groupSortKey(group: string) {
  return group === '未分组' ? '\uffff' : group
}

function environmentDotClass(tag: string) {
  if (tag === 'prod') return 'border-red-600 bg-red-500'
  if (tag === 'stage') return 'border-amber-600 bg-amber-500'
  if (tag === 'test') return 'border-sky-600 bg-sky-500'
  if (tag === 'dev') return 'border-emerald-600 bg-emerald-500'
  return 'border-muted-foreground/40 bg-transparent'
}

function environmentLabel(tag: string) {
  if (tag === 'prod') return 'prod'
  if (tag === 'stage') return 'stage'
  if (tag === 'test') return 'test'
  if (tag === 'dev') return 'dev'
  return '无环境标签'
}
