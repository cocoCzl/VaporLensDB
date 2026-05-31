import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  Columns3,
  Database,
  Folder,
  FunctionSquare,
  KeyRound,
  ListTree,
  Table2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type DatabaseTreeNodeKind =
  | 'database'
  | 'schema'
  | 'folder'
  | 'table'
  | 'view'
  | 'column'
  | 'index'
  | 'foreignKey'
  | 'function'

export interface DatabaseTreeNodeData {
  id: string
  label: string
  kind: DatabaseTreeNodeKind
  depth: number
  expandable?: boolean
  expanded?: boolean
  loading?: boolean
  detail?: string
}

interface TreeNodeProps {
  node: DatabaseTreeNodeData
  onToggle: (id: string) => void
  onRefresh?: (id: string) => void
}

const NODE_ICONS: Record<DatabaseTreeNodeKind, LucideIcon> = {
  database: Database,
  schema: ListTree,
  folder: Folder,
  table: Table2,
  view: Table2,
  column: Columns3,
  index: KeyRound,
  foreignKey: KeyRound,
  function: FunctionSquare,
}

export function TreeNode({ node, onToggle, onRefresh }: TreeNodeProps) {
  const Icon = NODE_ICONS[node.kind]
  const hasToggle = node.expandable || node.loading
  const ToggleIcon = node.expanded ? ChevronDown : ChevronRight

  return (
    <div
      className="group flex h-7 items-center gap-1 rounded px-1 text-xs hover:bg-accent"
      style={{ paddingLeft: `${node.depth * 14 + 4}px` }}
      role={node.expandable ? 'button' : undefined}
      tabIndex={node.expandable ? 0 : undefined}
      onClick={() => node.expandable && onToggle(node.id)}
      onKeyDown={(event) => {
        if (!node.expandable) {
          return
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onToggle(node.id)
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        onRefresh?.(node.id)
      }}
    >
      <button
        type="button"
        className="grid size-5 place-items-center text-muted-foreground disabled:opacity-30"
        disabled={!hasToggle}
        onClick={(event) => {
          event.stopPropagation()
          if (node.expandable) {
            onToggle(node.id)
          }
        }}
      >
        {node.loading ? (
          <CircleDot className="size-3 animate-pulse" />
        ) : hasToggle ? (
          <ToggleIcon className="size-3.5" />
        ) : (
          <span className="size-3.5" />
        )}
      </button>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{node.label}</span>
      {node.detail && (
        <span className="shrink-0 truncate text-[11px] text-muted-foreground">
          {node.detail}
        </span>
      )}
      {onRefresh && node.expandable && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="hidden h-6 px-1 text-[11px] group-hover:inline-flex"
          onClick={(event) => {
            event.stopPropagation()
            onRefresh(node.id)
          }}
        >
          刷新
        </Button>
      )}
    </div>
  )
}
