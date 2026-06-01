import { Activity, Database, Play, Square, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ConnectionConfig } from '@/types/connection'
import type { DatabaseInfo, SchemaInfo } from '@/types/metadata'

interface EditorToolbarProps {
  connections: ConnectionConfig[]
  connectionId: string | null
  database?: string | null
  schema?: string | null
  databases?: DatabaseInfo[]
  schemas?: SchemaInfo[]
  running?: boolean
  canCancel?: boolean
  disabled?: boolean
  onConnectionChange: (connectionId: string | null) => void
  onDatabaseChange?: (database: string | null) => void
  onSchemaChange?: (schema: string | null) => void
  onRun: () => void
  onCancel: () => void
  onExplain: () => void
  onFormat: () => void
}

export function EditorToolbar({
  connections,
  connectionId,
  database,
  schema,
  databases = [],
  schemas = [],
  running = false,
  canCancel = false,
  disabled = false,
  onConnectionChange,
  onDatabaseChange,
  onSchemaChange,
  onRun,
  onCancel,
  onExplain,
  onFormat,
}: EditorToolbarProps) {
  return (
    <div className="flex h-11 items-center gap-2 border-b ide-toolbar px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Database className="size-4 text-muted-foreground" />
        <select
          className="ide-select min-w-44"
          value={connectionId ?? ''}
          onChange={(event) => onConnectionChange(event.target.value || null)}
        >
          {!connectionId && <option value="">选择连接</option>}
          {connections.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.name}
            </option>
          ))}
        </select>
        <select
          className="ide-select min-w-36"
          value={database ?? ''}
          disabled={!connectionId || databases.length === 0}
          title="PostgreSQL 查询仍运行在连接配置的数据库中；切换数据库需要重新连接。"
          onChange={(event) => onDatabaseChange?.(event.target.value || null)}
        >
          {!database && <option value="">数据库</option>}
          {databases.map((item) => (
            <option key={item.name} value={item.name}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          className="ide-select min-w-32"
          value={schema ?? ''}
          disabled={!connectionId || schemas.length === 0}
          onChange={(event) => onSchemaChange?.(event.target.value || null)}
        >
          {!schema && <option value="">Schema</option>}
          {schemas.map((item) => (
            <option key={item.name} value={item.name}>
              {item.name}
            </option>
          ))}
        </select>
      </div>

      {running && canCancel ? (
        <Button type="button" size="sm" variant="destructive" onClick={onCancel}>
          <Square />
          取消
        </Button>
      ) : running ? (
        <Button type="button" size="sm" disabled>
          <Play />
          执行中
        </Button>
      ) : (
        <Button type="button" size="sm" disabled={disabled} onClick={onRun}>
          <Play />
          执行
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled || running}
        onClick={onExplain}
      >
        <Activity />
        Explain
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onFormat}>
        <Wand2 />
      </Button>
    </div>
  )
}
