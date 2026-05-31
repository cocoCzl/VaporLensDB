import { useEffect } from 'react'
import { Database, Link, Link2Off, Trash2 } from 'lucide-react'
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
    <div className="flex max-h-[45%] min-h-44 flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="text-sm font-medium">连接</div>
        <ConnectionDialog triggerLabel="新建" />
      </div>

      {error && <div className="border-b px-3 py-2 text-xs text-destructive">{error}</div>}

      <div className="flex-1 overflow-auto p-2">
        {connections.length === 0 ? (
          <div className="grid h-32 place-items-center text-center text-xs text-muted-foreground">
            暂无连接
          </div>
        ) : (
          <div className="grid gap-1">
            {connections.map((connection) => {
              const status = statuses[connection.id]?.status ?? 'disconnected'
              const connected = status === 'connected'

              return (
                <div
                  key={connection.id}
                  className="rounded-md border bg-background p-2 text-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 font-medium">
                        <Database className="size-4 text-muted-foreground" />
                        <span className="truncate">{connection.name}</span>
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {connection.driverType} · {connection.username ?? '-'}@
                        {connection.host ?? connection.connectionUrl ?? '-'}
                        {connection.port ? `:${connection.port}` : ''}
                        {connection.database ? `/${connection.database}` : ''}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        状态：{status}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={connected ? 'outline' : 'default'}
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
                      size="sm"
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
