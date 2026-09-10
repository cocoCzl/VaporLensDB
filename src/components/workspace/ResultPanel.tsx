import type { ReactNode } from 'react'

interface ResultPanelProps {
  title: ReactNode
  summary?: ReactNode
  source?: ReactNode
  status?: ReactNode
  actions: ReactNode
  children?: ReactNode
  collapsed: boolean
  fillAvailableSpace?: boolean
  height: number
}

/** A compact, data-first shell around existing query result and grid content. */
export function ResultPanel({
  title,
  summary,
  source,
  status,
  actions,
  children,
  collapsed,
  fillAvailableSpace = false,
  height,
}: ResultPanelProps) {
  return (
    <section
      className={[
        'workspace-results-panel flex min-h-0 shrink-0 flex-col bg-surface',
        fillAvailableSpace ? 'flex-1' : '',
      ].join(' ')}
      style={fillAvailableSpace ? undefined : { height: collapsed ? 32 : height }}
    >
      <header className="result-panel-header">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="shrink-0 text-[13px] font-semibold tracking-[-0.012em]">{title}</span>
          {status}
          {summary ? <span className="result-panel-summary truncate">{summary}</span> : null}
          {source ? <span className="hidden truncate text-[11px] text-muted-foreground xl:inline">{source}</span> : null}
        </div>
        <div className="ml-auto flex h-full shrink-0 items-center gap-1">{actions}</div>
      </header>
      {!collapsed && <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>}
    </section>
  )
}
