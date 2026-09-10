import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}

/** A restrained, reusable empty-state frame for workspace panels and lists. */
export function EmptyState({ icon, title, description, actions, className }: EmptyStateProps) {
  return (
    <div className={cn('ui-empty-state', className)}>
      <div className="ui-empty-state__content">
        {icon ? <div className="ui-empty-state__icon" aria-hidden="true">{icon}</div> : null}
        <div className="ui-empty-state__title">{title}</div>
        {description ? <div className="ui-empty-state__description">{description}</div> : null}
        {actions ? <div className="mt-1 flex items-center justify-center gap-2">{actions}</div> : null}
      </div>
    </div>
  )
}
