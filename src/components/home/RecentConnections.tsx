import { Database } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DatabaseVendorIcon } from '@/components/common/DatabaseVendorIcon'
import { EmptyState } from '@/components/ui/empty-state'
import { connectionEndpoint } from '@/components/sidebar/connectionPresentation'
import type { ConnectionConfig } from '@/types/connection'

interface RecentConnectionsProps {
  connections: ConnectionConfig[]
  loading: boolean
  activeConnectionId: string | null
  onSelect: (connection: ConnectionConfig) => void
}

export function RecentConnections({ connections, loading, activeConnectionId, onSelect }: RecentConnectionsProps) {
  const { t } = useTranslation()

  return (
    <section className="overflow-hidden rounded-[10px] border border-border/90 bg-surface shadow-[0_1px_2px_hsl(var(--foreground)/0.025)]" aria-labelledby="home-recent-connections">
      <div className="flex h-11 items-center gap-2.5 border-b border-border/70 bg-surface-secondary/55 px-4">
        <span className="grid size-6 place-items-center rounded-md bg-primary/[0.075] text-primary"><Database className="size-[15px]" aria-hidden="true" /></span>
        <h2 id="home-recent-connections" className="text-[13px] font-[650] tracking-[-0.012em] text-foreground">{t('home.recentConnections')}</h2>
      </div>
      <div>
        {loading ? <HomeListSkeleton /> : connections.length === 0 ? (
          <EmptyState
            className="min-h-40"
            icon={<Database className="size-4" />}
            title={t('home.noRecentConnections')}
            description={t('home.noRecentConnectionsDescription')}
          />
        ) : (
          connections.map((connection) => {
            const selected = connection.id === activeConnectionId
            return (
              <button
                key={connection.id}
                type="button"
                className={[
                  'group flex min-h-[44px] w-full items-center gap-3 border-b border-border/55 px-4 py-1.5 text-left transition-colors last:border-b-0 hover:bg-primary/[0.045] focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/35',
                  selected ? 'bg-primary/[0.065] text-foreground' : '',
                ].join(' ')}
                aria-current={selected ? 'true' : undefined}
                onClick={() => onSelect(connection)}
              >
                <DatabaseVendorIcon driverType={connection.driverType} className="size-[19px] shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-[550] leading-4 text-foreground">{connection.name}</span>
                  <span className="mt-0.5 block truncate text-[11px] leading-3.5 text-muted-foreground/90">{connectionEndpoint(connection)}</span>
                </span>
              </button>
            )
          })
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
