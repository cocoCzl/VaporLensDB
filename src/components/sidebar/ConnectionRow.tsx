import { ChevronDown, ChevronRight, Loader2, MoreHorizontal, Star } from 'lucide-react'
import type { KeyboardEvent, MouseEvent } from 'react'
import type { TFunction } from 'i18next'
import { DatabaseVendorIcon } from '@/components/common/DatabaseVendorIcon'
import { Button } from '@/components/ui/button'
import {
  connectionEndpoint,
  connectionStatusDotClass,
  connectionStatusLabel,
  highlightDataSourceMatch,
} from '@/components/sidebar/connectionPresentation'
import type { ConnectionConfig, ConnectionRuntimeStatus } from '@/types/connection'

interface ConnectionRowProps {
  connection: ConnectionConfig
  status: ConnectionRuntimeStatus
  busy: boolean
  selected: boolean
  expanded: boolean
  favorite: boolean
  query: string
  t: TFunction
  onSelect: () => void
  onOpen: () => void
  onToggle: () => void
  onOpenMenu: (position: { x: number; y: number }) => void
}

export function ConnectionRow({
  connection,
  status,
  busy,
  selected,
  expanded,
  favorite,
  query,
  t,
  onSelect,
  onOpen,
  onToggle,
  onOpenMenu,
}: ConnectionRowProps) {
  const statusLabel = connectionStatusLabel(status, t)

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect()
    }
  }

  function openMenu(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    onOpenMenu({ x: rect.right - 176, y: rect.bottom + 4 })
  }

  return (
    <div
      role="treeitem"
      tabIndex={0}
      aria-selected={selected}
      aria-expanded={expanded}
      className={[
        'group relative mx-2 flex min-h-11 cursor-pointer items-center rounded-md px-2 outline-none transition-colors',
        selected
          ? 'bg-accent-selected text-accent-foreground'
          : 'text-foreground hover:bg-accent-hover',
      ].join(' ')}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={(event) => {
        event.preventDefault()
        onOpenMenu({ x: event.clientX, y: event.clientY })
      }}
      onKeyDown={onKeyDown}
      title={`${connection.name} · ${connectionEndpoint(connection)} · ${statusLabel}${status === 'failed' ? ` · ${t('connection.failed')}` : ''}`}
    >
      <button
        type="button"
        className="grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-surface/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        aria-label={expanded ? t('explorer.collapse') : t('explorer.expand')}
        aria-busy={busy}
        onClick={(event) => {
          event.stopPropagation()
          onToggle()
        }}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
      </button>
      <span className={`ml-0.5 ${connectionStatusDotClass(status)}`} role="img" aria-label={statusLabel} title={statusLabel} />
      <DatabaseVendorIcon driverType={connection.driverType} className="ml-2 size-[18px] shrink-0" />
      <div className="min-w-0 flex-1 pl-2.5">
        <div className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 flex-1 truncate text-[13px] font-[550] leading-4">{highlightDataSourceMatch(connection.name, query)}</span>
          {favorite && <Star className="size-3 shrink-0 fill-current text-warning" aria-label={t('connection.favorite')} />}
        </div>
        <div className="mt-0.5 truncate text-[11px] leading-3.5 text-muted-foreground/85" title={connectionEndpoint(connection)}>
          {connectionEndpoint(connection)}
        </div>
      </div>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className={[
          'ml-1 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
          selected ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
        aria-label={t('common.moreActions')}
        onClick={openMenu}
      >
        <MoreHorizontal />
      </Button>
    </div>
  )
}
