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
      <div className="grid gap-4 min-[760px]:grid-cols-3">
        {actions.map((action) => {
          const Icon = action.icon
          return (
            <button
              key={action.id}
              type="button"
              className="group flex min-h-[108px] items-center gap-4 rounded-[10px] border border-border/85 bg-surface px-5 py-4 text-left shadow-[0_1px_2px_hsl(var(--foreground)/0.025)] transition-[background-color,border-color,box-shadow,transform] hover:-translate-y-px hover:border-primary/25 hover:bg-surface-secondary hover:shadow-[0_8px_18px_-14px_hsl(var(--foreground)/0.22)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
              onClick={action.onClick}
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-[10px] border border-primary/15 bg-primary/[0.09] text-primary transition-colors group-hover:bg-primary/[0.14]">
                <Icon className="size-[22px] stroke-[1.65]" />
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-bold leading-5 tracking-[-0.015em] text-foreground">{action.title}</span>
                <span className="mt-1 block text-[12px] leading-[1.35] text-muted-foreground">{action.description}</span>
              </span>
              <ChevronRight className="ml-auto size-[18px] shrink-0 text-muted-foreground/60 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
            </button>
          )
        })}
      </div>
    </section>
  )
}
