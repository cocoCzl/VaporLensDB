import { ChevronDown, ChevronRight } from 'lucide-react'
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
    <section aria-labelledby={`${id}-label`}>
      <button
        id={`${id}-label`}
        type="button"
        className="flex h-8 w-full items-center gap-1.5 px-3.5 text-left text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-accent-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        {collapsed ? <ChevronRight className="size-3 shrink-0" /> : <ChevronDown className="size-3 shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground/65">{count}</span>
      </button>
      {!collapsed && <div className="pb-1.5">{children}</div>}
    </section>
  )
}
