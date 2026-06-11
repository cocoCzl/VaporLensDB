import { KeyRound } from 'lucide-react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { ColumnInfo } from '@/types/metadata'

export interface TableNodeData extends Record<string, unknown> {
  schema: string
  table: string
  columns: ColumnInfo[]
  incomingCount: number
  outgoingCount: number
}

export function TableNode({ data }: NodeProps) {
  const table = data as TableNodeData
  const visibleColumns = table.columns.slice(0, 18)
  const hiddenColumns = Math.max(0, table.columns.length - visibleColumns.length)

  return (
    <div className="w-[280px] overflow-hidden rounded-md border bg-card text-xs shadow-sm">
      <Handle type="target" position={Position.Left} className="!size-2 !border-primary !bg-background" />
      <Handle type="source" position={Position.Right} className="!size-2 !border-primary !bg-background" />
      <div className="border-b bg-muted/70 px-3 py-2">
        <div className="truncate text-[11px] text-muted-foreground">{table.schema}</div>
        <div className="truncate font-semibold text-foreground">{table.table}</div>
        <div className="mt-1 flex gap-2 text-[10px] text-muted-foreground">
          <span>{table.columns.length} columns</span>
          <span>{table.outgoingCount} FK out</span>
          <span>{table.incomingCount} FK in</span>
        </div>
      </div>
      <div className="max-h-[420px] overflow-hidden">
        {visibleColumns.map((column) => (
          <div
            key={column.name}
            className="flex h-7 min-w-0 items-center gap-2 border-b px-3 last:border-b-0"
            title={`${column.name} · ${column.dataType}`}
          >
            {column.isPrimaryKey ? (
              <KeyRound className="size-3 shrink-0 text-amber-600" />
            ) : (
              <span className="size-3 shrink-0 rounded-sm border border-muted-foreground/35" />
            )}
            <span className="min-w-0 flex-1 truncate font-mono">{column.name}</span>
            <span className="max-w-24 shrink-0 truncate text-[10px] text-muted-foreground">
              {column.dataType}
            </span>
          </div>
        ))}
        {hiddenColumns > 0 && (
          <div className="px-3 py-2 text-[11px] text-muted-foreground">
            +{hiddenColumns} more columns
          </div>
        )}
      </div>
    </div>
  )
}
