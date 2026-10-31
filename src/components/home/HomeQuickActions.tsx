import { ChevronRight, Database, FileCode2, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface HomeQuickActionsProps {
  onNewQuery: () => void
  onNewConnection: () => void
  onOpenCommandPalette: () => void
}

export function HomeQuickActions({ onNewQuery, onNewConnection, onOpenCommandPalette }: HomeQuickActionsProps) {
  const { t } = useTranslation()
  const actions = [
    {
      id: 'new-query',
      icon: FileCode2,
      title: t('home.newQuery'),
      description: t('home.newQueryDescription'),
      onClick: onNewQuery,
    },
    {
      id: 'new-connection',
      icon: Database,
      title: t('home.newConnection'),
      description: t('home.newConnectionDescription'),
      onClick: onNewConnection,
    },
    {
      id: 'command-palette',
      icon: Search,
      title: t('home.commandPalette'),
      description: t('home.commandPaletteDescription'),
      onClick: onOpenCommandPalette,
    },
  ]

  return (
    <section aria-label={t('home.quickActions')}>
      <div className="home-quick-actions home-actions">
        {actions.map((action) => {
          const Icon = action.icon
          return (
            <button
              key={action.id}
              type="button"
              className="home-action group flex min-w-0 items-center gap-2.5 rounded-md border border-border/75 bg-surface px-3 py-2 text-left hover:border-primary/30 hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
              onClick={action.onClick}
            >
              <span className="home-action-icon grid size-8 shrink-0 place-items-center rounded bg-primary/[0.075] text-primary">
                <Icon className="size-[18px] stroke-[1.65]" />
              </span>
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                <span className="block text-xs font-semibold leading-4 text-foreground">{action.title}</span>
                <span className="home-action-description mt-1 block text-[11px] leading-4 text-muted-foreground">{action.description}</span>
              </span>
              <ChevronRight className="home-action-chevron ml-auto size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
            </button>
          )
        })}
      </div>
    </section>
  )
}
