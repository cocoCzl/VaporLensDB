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
import type { KeyboardEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

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
  onRetry?: (id: string) => void
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
const DATABASE_OBJECT_KINDS = new Set<DatabaseTreeNodeKind>([
  'database',
  'schema',
  'table',
  'view',
  'column',
  'index',
  'foreignKey',
  'function',
  'materializedView',
  'procedure',
  'package',
  'sequence',
  'trigger',
  'synonym',
  'event',
])

export function TreeNode({
  node,
  selected,
  onToggle,
  onSelect,
  onRetry,
  onDoubleClick,
  onNodeKeyDown,
  onNodeContextMenu,
  quickActions = [],
}: TreeNodeProps) {
  const { t } = useTranslation()
  const Icon = NODE_ICONS[node.kind]
  const hasToggle = node.expandable || node.loading
  const ToggleIcon = node.expanded ? ChevronDown : ChevronRight
  const warning = node.detail?.toUpperCase() === 'INVALID'

  return (
    <div
      className={[
        'group flex h-6 items-center gap-1 rounded px-1 text-xs text-foreground/90 hover:bg-accent/75',
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
      {isDatabaseObjectKind(node.kind) ? (
        <DatabaseObjectGlyph
          kind={node.kind}
          className={nodeIconTone(node.kind, node.muted)}
        />
      ) : (
        <Icon
          className={[
            'size-3.5 shrink-0',
            nodeIconTone(node.kind, node.muted),
          ].join(' ')}
        />
      )}
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
          {quickActions.slice(0, 1).map((action) => {
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
      {onRetry && (
        <button
          type="button"
          className="ml-auto grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          title={t('common.refresh')}
          aria-label={t('common.refresh')}
          onClick={(event) => {
            event.stopPropagation()
            onRetry(node.id)
          }}
        >
          <CircleDot className="size-3.5" />
        </button>
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

function isDatabaseObjectKind(
  kind: DatabaseTreeNodeKind,
): kind is Exclude<DatabaseTreeNodeKind, 'folder'> {
  return DATABASE_OBJECT_KINDS.has(kind)
}

function DatabaseObjectGlyph({
  kind,
  className,
}: {
  kind: Exclude<DatabaseTreeNodeKind, 'folder'>
  className: string
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`size-3.5 shrink-0 ${className}`}
      aria-hidden="true"
    >
      {databaseGlyphContent(kind)}
    </svg>
  )
}

function databaseGlyphContent(kind: Exclude<DatabaseTreeNodeKind, 'folder'>): ReactNode {
  switch (kind) {
    case 'database':
      return <>
        <ellipse cx="8" cy="3.1" rx="5.3" ry="1.8" />
        <path d="M2.7 3.1v8.1c0 1 2.4 1.8 5.3 1.8s5.3-.8 5.3-1.8V3.1" />
        <path d="M2.7 7.1c0 1 2.4 1.8 5.3 1.8s5.3-.8 5.3-1.8" />
      </>
    case 'schema':
      return <>
        <rect x="2.4" y="2.6" width="8.5" height="8.5" rx="1.2" />
        <path d="M5.1 5.2h6.5A1.4 1.4 0 0 1 13 6.6v6.5H6.5A1.4 1.4 0 0 1 5.1 11.7z" />
      </>
    case 'table':
      return <>
        <rect x="2.3" y="2.3" width="11.4" height="11.4" rx="1.3" />
        <path d="M2.7 5.5h10.6M5.5 2.7v10.6M5.5 8h7.8M8.6 5.5v7.8" />
      </>
    case 'view':
      return <>
        <path d="M1.8 8s2.2-3.4 6.2-3.4S14.2 8 14.2 8s-2.2 3.4-6.2 3.4S1.8 8 1.8 8z" />
        <circle cx="8" cy="8" r="1.7" />
      </>
    case 'materializedView':
      return <>
        <rect x="2.1" y="3.1" width="9.7" height="9.7" rx="1.1" />
        <path d="M4.3 5.5h5.2M4.3 8h5.2M4.3 10.5h3.1" />
        <path d="M11.1 2.2h2.7v2.7M13.8 2.2l-3.5 3.5" />
      </>
    case 'column':
      return <>
        <rect x="3" y="2.3" width="10" height="11.4" rx="1.2" />
        <path d="M5.3 5h5.4M5.3 8h5.4M5.3 11h3.2" />
      </>
    case 'index':
    case 'foreignKey':
      return <>
        <circle cx="5.4" cy="8.2" r="2.4" />
        <path d="m7.1 9.9 4.6 4.6M10.1 12.9l1.6-1.6M8.7 11.5l1.3-1.3" />
        {kind === 'foreignKey' && <path d="M10.9 3.2h2.4v2.4" />}
      </>
    case 'function':
      return <>
        <path d="M5.5 2.2 2.4 8l3.1 5.8M10.5 2.2 13.6 8l-3.1 5.8" />
        <path d="M6.4 8h3.2" />
      </>
    case 'procedure':
      return <>
        <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="1.4" />
        <path d="m6.2 5.2-2 2.8 2 2.8M9.8 5.2l2 2.8-2 2.8" />
      </>
    case 'package':
      return <>
        <path d="M2.3 5.2 5.1 2.4h6.3l2.3 2.3v8.9H2.3z" />
        <path d="M5.1 2.4v2.8h2.8M5.3 8h5.4M5.3 10.6h3.2" />
      </>
    case 'sequence':
      return <>
        <path d="M3 4.1h8.3l-1.7-1.7M11.3 4.1 9.6 5.8M13 11.9H4.7l1.7 1.7M4.7 11.9l1.7-1.7" />
      </>
    case 'trigger':
      return <>
        <path d="m8.9 1.9-5 6.5h3.5l-.4 5.7 5-6.5H8.5z" />
      </>
    case 'synonym':
      return <>
        <path d="M6.2 5.2 4.7 3.7a2.6 2.6 0 0 0-3.7 3.7l2 2M9.8 10.8l1.5 1.5a2.6 2.6 0 0 0 3.7-3.7l-2-2M5.5 10.5l5-5" />
      </>
    case 'event':
      return <>
        <rect x="2.3" y="3.2" width="11.4" height="10.5" rx="1.3" />
        <path d="M5 2v2.4M11 2v2.4M2.8 6.2h10.4M5.3 9h.1M8 9h.1M10.7 9h.1M5.3 11.5h.1M8 11.5h.1" />
      </>
  }
}
