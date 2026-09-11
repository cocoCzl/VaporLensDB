import { Database, Settings } from 'lucide-react'
import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { DataSourcesSidebar } from '@/components/sidebar/DataSourcesSidebar'
import { useEditorStore } from '@/stores/editorStore'
import { useUiStore } from '@/stores/uiStore'
import type { LucideIcon } from 'lucide-react'

const RAIL_ITEMS = [
  { view: 'explorer', icon: Database, labelKey: 'connection.explorerTitle' },
] as const

/** The shell owns rail visibility and resize; DataSourcesSidebar owns data-source UI. */
export function Sidebar() {
  const { t } = useTranslation()
  const sidebarView = useUiStore((state) => state.sidebarView)
  const setSidebarView = useUiStore((state) => state.setSidebarView)
  const sidebarWidth = useUiStore((state) => state.sidebarWidth)
  const setSidebarWidth = useUiStore((state) => state.setSidebarWidth)
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed)
  const setSidebarCollapsed = useUiStore((state) => state.setSidebarCollapsed)
  const [compactViewport, setCompactViewport] = useState(false)
  const [sidebarResizing, setSidebarResizing] = useState(false)
  const tabs = useEditorStore((state) => state.tabs)
  const activeTabId = useEditorStore((state) => state.activeTabId)
  const addTab = useEditorStore((state) => state.addTab)
  const setActiveTab = useEditorStore((state) => state.setActiveTab)
  const settingsTab = tabs.find((tab) => tab.kind === 'settings')
  const settingsActive = settingsTab?.id === activeTabId

  useEffect(() => {
    const media = window.matchMedia('(max-width: 960px)')
    const update = () => setCompactViewport(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  function openSettings() {
    if (settingsTab) {
      setActiveTab(settingsTab.id)
    } else {
      addTab({
        id: crypto.randomUUID(),
        kind: 'settings',
        title: t('settings.title'),
        sql: '',
        connectionId: null,
      })
    }
    setSidebarView('explorer')
  }

  function toggleExplorer() {
    if (sidebarCollapsed) {
      setSidebarCollapsed(false)
      setSidebarView('explorer')
      return
    }
    if (sidebarView === 'explorer') {
      setSidebarCollapsed(true)
      return
    }
    setSidebarView('explorer')
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (sidebarCollapsed) return
    event.preventDefault()

    const startX = event.clientX
    const startWidth = sidebarWidth
    const previousCursor = document.body.style.cursor
    document.body.style.cursor = 'col-resize'
    setSidebarResizing(true)

    const onMove = (moveEvent: PointerEvent) => setSidebarWidth(startWidth + moveEvent.clientX - startX)
    const stopResize = () => {
      document.body.style.cursor = previousCursor
      setSidebarResizing(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stopResize)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stopResize, { once: true })
  }

  return (
    <aside
      className="ide-chrome relative flex shrink-0 border-r border-border/60"
      style={{ width: sidebarCollapsed ? 32 : compactViewport ? Math.min(sidebarWidth, 232) : sidebarWidth }}
    >
      <nav className="flex w-8 shrink-0 flex-col items-center gap-1 border-r border-border/50 bg-sidebar/60 py-2">
        {RAIL_ITEMS.map((item) => (
          <RailButton
            key={item.view}
            active={sidebarView === item.view && !sidebarCollapsed}
            icon={item.icon}
            label={t(item.labelKey)}
            onClick={toggleExplorer}
          />
        ))}
        <div className="flex-1" />
        <RailButton active={settingsActive} icon={Settings} label={t('nav.settings')} onClick={openSettings} />
      </nav>
      {!sidebarCollapsed && <DataSourcesSidebar />}
      {!sidebarCollapsed && (
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label={t('connection.explorerTitle')}
          aria-valuemin={232}
          aria-valuemax={460}
          aria-valuenow={sidebarWidth}
          className={[
            'absolute inset-y-0 -right-px z-20 w-1 cursor-col-resize touch-none transition-colors focus-visible:outline-none',
            sidebarResizing
              ? 'bg-primary/70'
              : 'bg-transparent hover:bg-border-strong/70 focus-visible:bg-border-strong',
          ].join(' ')}
          onPointerDown={startResize}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault()
              setSidebarWidth(sidebarWidth - 16)
            }
            if (event.key === 'ArrowRight') {
              event.preventDefault()
              setSidebarWidth(sidebarWidth + 16)
            }
          }}
        />
      )}
    </aside>
  )
}

function RailButton({
  active = false,
  icon: Icon,
  label,
  onClick,
}: {
  active?: boolean
  icon: LucideIcon
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={[
        'grid size-7 place-items-center rounded-md text-muted-foreground transition-colors',
        active
          ? 'bg-accent-selected text-accent-foreground'
          : 'hover:bg-accent-hover hover:text-accent-foreground',
      ].join(' ')}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon className="size-3.5" />
    </button>
  )
}
