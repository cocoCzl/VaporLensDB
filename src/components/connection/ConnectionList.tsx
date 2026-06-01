import { useEffect } from 'react'
import { Database, Link, Link2Off, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConnectionDialog } from '@/components/connection/ConnectionDialog'
import { useConnectionStore } from '@/stores/connectionStore'

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

  useEffect(() => {
    loadConnections()
  }, [loadConnections])

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

      <div className="flex-1 overflow-auto p-2">
        {connections.length === 0 ? (
          <div className="grid h-32 place-items-center text-center text-xs text-muted-foreground">
            <div>
              <Database className="mx-auto mb-2 size-7 opacity-60" />
              <div>暂无数据源</div>
            </div>
          </div>
        ) : (
          <div className="grid gap-1">
            {connections.map((connection) => {
              const status = statuses[connection.id]?.status ?? 'disconnected'
              const connected = status === 'connected'

              return (
                <div
                  key={connection.id}
                  className={[
                    'rounded-md border px-2 py-1.5 text-sm transition-colors',
                    connected
                      ? 'border-primary/30 bg-primary/10 shadow-sm'
                      : 'border-transparent bg-transparent hover:bg-muted/70',
                  ].join(' ')}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 font-medium leading-5">
                        <Database
                          className={[
                            'size-4',
                            connected ? 'text-primary' : 'text-muted-foreground',
                          ].join(' ')}
                        />
                        <span className="truncate">{connection.name}</span>
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {connection.driverType} · {connection.username ?? '-'}@
                        {connection.host ?? connection.connectionUrl ?? '-'}
                        {connection.port ? `:${connection.port}` : ''}
                        {connection.database ? `/${connection.database}` : ''}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span
                          className={[
                            'size-1.5 rounded-full',
                            connected ? 'bg-emerald-500' : 'bg-muted-foreground/45',
                          ].join(' ')}
                        />
                        {status}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1">
                    <Button
                      type="button"
                      size="xs"
                      variant={connected ? 'outline' : 'secondary'}
                      disabled={loading}
                      onClick={() =>
                        connected
                          ? disconnectConnection(connection.id)
                          : connectConnection(connection.id)
                      }
                    >
                      {connected ? <Link2Off /> : <Link />}
                      {connected ? '断开' : '连接'}
                    </Button>
                    <ConnectionDialog connection={connection} />
                    <Button
                      type="button"
                      size="xs"
                      variant="destructive"
                      disabled={loading}
                      onClick={() => removeConnection(connection.id)}
                    >
                      <Trash2 />
                      删除
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
