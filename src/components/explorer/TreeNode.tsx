import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  Columns3,
  Database,
  Eye,
  Folder,
  FunctionSquare,
  KeyRound,
  Layers3,
  ListTree,
  Package,
  SquareCode,
  Table2,
  TriangleAlert,
  Zap,
  CalendarClock,
  Code2,
  PanelRightOpen,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { KeyboardEvent } from 'react'
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
  | 'materializedView'
  | 'procedure'
  | 'package'
  | 'sequence'
  | 'trigger'
  | 'synonym'
  | 'event'

export interface DatabaseTreeNodeData {
  id: string
  label: string
  kind: DatabaseTreeNodeKind
  depth: number
  expandable?: boolean
  expanded?: boolean
  loading?: boolean
  muted?: boolean
  detail?: string
  tooltip?: string
  selected?: boolean
}

export interface TreeNodeQuickAction {
  id: string
  label: string
  icon: 'data' | 'structure' | 'ddl'
  onSelect: () => void
}

interface TreeNodeProps {
  node: DatabaseTreeNodeData
  selected?: boolean
  onToggle: (id: string) => void
  onSelect?: (id: string) => void
  onRefresh?: (id: string) => void
  onDoubleClick?: (id: string) => void
  onNodeKeyDown?: (node: DatabaseTreeNodeData, event: KeyboardEvent<HTMLDivElement>) => void
  onNodeContextMenu?: (node: DatabaseTreeNodeData, position: { x: number; y: number }) => void
  quickActions?: TreeNodeQuickAction[]
}

const NODE_ICONS: Record<DatabaseTreeNodeKind, LucideIcon> = {
  database: Database,
  schema: ListTree,
  folder: Folder,
  table: Table2,
  view: Eye,
  column: Columns3,
  index: KeyRound,
  foreignKey: KeyRound,
  function: FunctionSquare,
  materializedView: Layers3,
  procedure: SquareCode,
  package: Package,
  sequence: ListTree,
  trigger: Zap,
  synonym: SquareCode,
  event: CalendarClock,
}

const QUICK_ACTION_ICONS: Record<TreeNodeQuickAction['icon'], LucideIcon> = {
  data: Table2,
  structure: PanelRightOpen,
  ddl: Code2,
}

const CATEGORY_KINDS = new Set<DatabaseTreeNodeKind>(['folder'])
const KEY_KINDS = new Set<DatabaseTreeNodeKind>(['index', 'foreignKey'])
const CODE_KINDS = new Set<DatabaseTreeNodeKind>(['procedure', 'function', 'package', 'trigger'])

export function TreeNode({
  node,
  selected,
  onToggle,
  onSelect,
  onRefresh,
  onDoubleClick,
  onNodeKeyDown,
  onNodeContextMenu,
  quickActions = [],
}: TreeNodeProps) {
  const Icon = NODE_ICONS[node.kind]
  const hasToggle = node.expandable || node.loading
  const ToggleIcon = node.expanded ? ChevronDown : ChevronRight
  const warning = node.detail?.toUpperCase() === 'INVALID'

  return (
    <div
      className={[
        'group flex h-7 items-center gap-1 rounded-md px-1 text-xs text-foreground/90 hover:bg-accent/75',
        selected ? 'bg-accent text-accent-foreground' : '',
      ].join(' ')}
      data-muted={node.muted ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      title={node.tooltip ?? node.detail ?? node.label}
      style={{ paddingLeft: `${node.depth * 14 + 4}px` }}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={node.expandable ? node.expanded === true : undefined}
      tabIndex={0}
      onClick={() => onSelect?.(node.id)}
      onKeyDown={(event) => {
        onNodeKeyDown?.(node, event)
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        onSelect?.(node.id)
        onNodeContextMenu?.(node, { x: event.clientX, y: event.clientY })
      }}
      onDoubleClick={(event) => {
        event.preventDefault()
        onSelect?.(node.id)
        onDoubleClick?.(node.id)
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
      <Icon
        className={[
          'size-3.5 shrink-0',
          nodeIconTone(node.kind, node.muted),
        ].join(' ')}
      />
      <span className={['min-w-0 flex-1 truncate', node.muted ? 'text-muted-foreground' : ''].join(' ')}>
        {node.label}
      </span>
      {node.detail && quickActions.length === 0 && (
        <span
          className={[
            'inline-flex shrink-0 items-center gap-1 truncate text-[11px]',
            warning ? 'text-amber-600' : 'text-muted-foreground',
          ].join(' ')}
        >
          {warning && <TriangleAlert className="size-3" />}
          {node.detail}
        </span>
      )}
      {quickActions.length > 0 && (
        <div
          className={[
            'ml-auto flex shrink-0 items-center gap-0.5 rounded bg-background/80 px-0.5 opacity-0 shadow-sm ring-1 ring-border/60 transition-opacity',
            'group-hover:opacity-100 group-focus-within:opacity-100',
            selected ? 'opacity-100' : '',
          ].join(' ')}
          aria-label={`${node.label} quick actions`}
        >
          {quickActions.map((action) => {
            const ActionIcon = QUICK_ACTION_ICONS[action.icon]
            return (
              <button
                key={action.id}
                type="button"
                className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                title={action.label}
                aria-label={action.label}
                onClick={(event) => {
                  event.stopPropagation()
                  onSelect?.(node.id)
                  action.onSelect()
                }}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                <ActionIcon className="size-3.5" />
              </button>
            )
          })}
        </div>
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

function nodeIconTone(kind: DatabaseTreeNodeKind, muted?: boolean) {
  if (muted) return 'text-muted-foreground/50'
  if (kind === 'database') return 'text-sky-600'
  if (kind === 'schema') return 'text-emerald-600'
  if (CATEGORY_KINDS.has(kind)) return 'text-muted-foreground/75'
  if (kind === 'table') return 'text-blue-600'
  if (kind === 'view') return 'text-cyan-600'
  if (kind === 'materializedView') return 'text-indigo-600'
  if (KEY_KINDS.has(kind)) return 'text-amber-600'
  if (CODE_KINDS.has(kind)) return 'text-violet-600'
  return 'text-primary/80'
}
