import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react'
import type { ReactNode } from 'react'

interface ConnectionGroupProps {
  id: string
  name: ReactNode
  count: number
  collapsed: boolean
  onToggle: () => void
  children: ReactNode
}

export function ConnectionGroup({ id, name, count, collapsed, onToggle, children }: ConnectionGroupProps) {
  return (
    <section role="none" className="min-w-0" aria-labelledby={`${id}-label`}>
      <button
        id={`${id}-label`}
        type="button"
        role="treeitem"
        data-tree-row={`group:${id}`}
        data-tree-toggle
        aria-level={1}
        tabIndex={0}
        className="navigation-tree-row flex h-8 min-w-0 w-full items-center gap-1.5 px-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        {collapsed ? <ChevronRight className="size-5 shrink-0 p-1" /> : <ChevronDown className="size-5 shrink-0 p-1" />}
        {collapsed ? <Folder className="size-4 shrink-0 text-muted-foreground/75" /> : <FolderOpen className="size-4 shrink-0 text-muted-foreground/75" />}
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground/65">{count}</span>
      </button>
      {!collapsed && <div role="group" className="min-w-0">{children}</div>}
    </section>
  )
}
