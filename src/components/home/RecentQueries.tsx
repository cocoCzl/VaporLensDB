import { TerminalSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/ui/empty-state'
import type { QueryHistoryEntry } from '@/types/queryHistory'

interface RecentQueriesProps {
  entries: QueryHistoryEntry[]
  loading: boolean
  onOpen: (entry: QueryHistoryEntry) => void
}

export function RecentQueries({ entries, loading, onOpen }: RecentQueriesProps) {
  const { t } = useTranslation()

  return (
    <section className="overflow-hidden rounded-[10px] border border-border/90 bg-surface shadow-[0_1px_2px_hsl(var(--foreground)/0.025)]" aria-labelledby="home-recent-queries">
      <div className="flex h-11 items-center gap-2.5 border-b border-border/70 bg-surface-secondary/55 px-4">
        <span className="grid size-6 place-items-center rounded-md bg-primary/[0.075] text-primary"><TerminalSquare className="size-[15px]" aria-hidden="true" /></span>
        <h2 id="home-recent-queries" className="text-[13px] font-[650] tracking-[-0.012em] text-foreground">{t('home.recentQueries')}</h2>
      </div>
      <div>
        {loading ? <HomeListSkeleton /> : entries.length === 0 ? (
          <EmptyState
            className="min-h-40"
            icon={<TerminalSquare className="size-4" />}
            title={t('home.noRecentQueries')}
            description={t('home.noRecentQueriesDescription')}
          />
        ) : (
          entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="group flex min-h-[44px] w-full items-center gap-3 border-b border-border/55 px-4 py-1.5 text-left transition-colors last:border-b-0 hover:bg-primary/[0.045] focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/35"
              onClick={() => onOpen(entry)}
              title={sqlPreview(entry.sql)}
            >
              <TerminalSquare className="size-[17px] shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[12px] font-medium leading-4 text-foreground">{sqlPreview(entry.sql)}</span>
                <span className="mt-0.5 block truncate text-[11px] leading-3.5 text-muted-foreground/90">
                  {entry.connectionNameSnapshot} · {formatHistoryTime(entry.startedAt)}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  )
}

function HomeListSkeleton() {
  return (
    <div className="grid gap-px p-3" aria-label="Loading">
      {[0, 1, 2].map((index) => <div key={index} className="h-10 animate-pulse rounded-sm bg-muted/65" />)}
    </div>
  )
}

function sqlPreview(sql: string) {
  const preview = sql.trim().replace(/\s+/g, ' ')
  return preview.length > 90 ? `${preview.slice(0, 90)}...` : preview
}

function formatHistoryTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
