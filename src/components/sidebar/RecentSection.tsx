import { Clock3 } from 'lucide-react'
import type { TFunction } from 'i18next'
import { DatabaseVendorIcon } from '@/components/common/DatabaseVendorIcon'
import { connectionEndpoint } from '@/components/sidebar/connectionPresentation'
import type { ConnectionConfig } from '@/types/connection'

interface RecentSectionProps {
  connections: ConnectionConfig[]
  activeConnectionId: string | null
  onSelect: (connection: ConnectionConfig) => void
  t: TFunction
}

export function RecentSection({ connections, activeConnectionId, onSelect, t }: RecentSectionProps) {
  if (connections.length === 0) return null

  return (
    <section className="mt-4 border-t border-border/65 bg-surface/[0.22] pt-3" aria-labelledby="recent-data-sources">
      <div id="recent-data-sources" className="flex h-7 items-center gap-2 px-3.5 text-[11px] font-semibold tracking-[-0.01em] text-muted-foreground">
        <span className="grid size-5 place-items-center rounded-md bg-primary/[0.065] text-primary"><Clock3 className="size-3.5" /></span>
        {t('connection.recent')}
      </div>
      <div className="grid gap-px px-1">
        {connections.map((connection) => {
          const selected = connection.id === activeConnectionId
          return (
            <button
              key={connection.id}
              type="button"
              className={[
                'flex min-h-11 w-full items-center gap-2.5 rounded-md px-2.5 text-left transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35',
                selected ? 'bg-accent-selected text-accent-foreground' : '',
              ].join(' ')}
              aria-current={selected ? 'true' : undefined}
              onClick={() => onSelect(connection)}
            >
              <DatabaseVendorIcon driverType={connection.driverType} className="size-4 shrink-0 opacity-75" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-[550] leading-4">{connection.name}</span>
                <span className="mt-0.5 block truncate text-[11px] leading-3.5 text-muted-foreground/85">{connectionEndpoint(connection)}</span>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
