import { ChevronLeft, ChevronRight, Database, FileCode2, LayoutPanelLeft, Plus, Search, Settings } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { ConnectionDialog } from '@/components/connection/ConnectionDialog'
import { IconTooltipButton } from '@/components/common/IconTooltipButton'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import { useUiStore } from '@/stores/uiStore'
import { VaporLensMark } from '@/components/layout/VaporLensMark'

/**
 * Application-wide actions belong here, above the tab strip. It intentionally
 * owns no workspace history: disabled Back/Forward make that boundary honest.
 */
export function AppTopBar() {
  const { t } = useTranslation()
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false)
  const commandShortcut = isMacPlatform() ? '⌘K' : 'Ctrl K'
  const { tabs, activeTabId, addTab, setActiveTab } = useEditorStore(useShallow((state) => ({
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    addTab: state.addTab,
    setActiveTab: state.setActiveTab,
  })))
  const { connections, browsingConnectionId } = useConnectionStore(useShallow((state) => ({
    connections: state.connections,
    browsingConnectionId: state.browsingConnectionId,
  })))
  const { sidebarCollapsed, setSidebarCollapsed } = useUiStore(useShallow((state) => ({
    sidebarCollapsed: state.sidebarCollapsed,
    setSidebarCollapsed: state.setSidebarCollapsed,
  })))

  function openNewQuery() {
    const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null
    const connectionId = activeTab?.kind === 'sql' || !activeTab?.kind
      ? activeTab?.connectionId ?? browsingConnectionId
      : browsingConnectionId
    const connection = connections.find((item) => item.id === connectionId)
    addTab({
      id: crypto.randomUUID(),
      kind: 'sql',
      title: connection ? `SQL · ${connection.name}` : 'SQL',
      sql: '',
      connectionId,
    })
  }

  function openSettings() {
    const existing = tabs.find((tab) => tab.kind === 'settings')
    if (existing) {
      setActiveTab(existing.id)
      return
    }
    addTab({ id: crypto.randomUUID(), kind: 'settings', title: t('settings.title'), sql: '', connectionId: null })
  }

  return (
    <header className="ide-top-bar flex h-[46px] shrink-0 items-center gap-2.5 border-b px-3.5" aria-label={t('topBar.label')}>
      <VaporLensMark className="size-6 shrink-0" />

      <div className="flex shrink-0 items-center gap-0.5">
        <IconTooltipButton label={t('topBar.backUnavailable')} variant="ghost" disabled>
          <ChevronLeft />
        </IconTooltipButton>
        <IconTooltipButton label={t('topBar.forwardUnavailable')} variant="ghost" disabled>
          <ChevronRight />
        </IconTooltipButton>
      </div>

      <div className="flex min-w-0 flex-1 justify-center px-4">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 w-[clamp(260px,32vw,520px)] max-w-full justify-start gap-2 px-2.5 font-normal text-muted-foreground shadow-none"
          aria-label={t('topBar.searchAria')}
          onClick={() => window.dispatchEvent(new Event('vaporlensdb:open-command-palette'))}
        >
          <Search className="size-3.5" />
          <span className="min-w-0 flex-1 truncate text-left">
            <span className="hidden min-[980px]:inline">{t('topBar.searchPlaceholder')}</span>
            <span className="min-[980px]:hidden">{t('topBar.searchShort')}</span>
          </span>
          <kbd className="hidden rounded-sm border border-border/70 bg-surface-secondary/65 px-1 py-px font-mono text-[10px] text-muted-foreground/80 min-[760px]:inline">{commandShortcut}</kbd>
        </Button>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<IconTooltipButton label={t('topBar.new')} variant="ghost"><Plus /></IconTooltipButton>}
          />
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={openNewQuery}>
              <FileCode2 />
              <span>{t('workbench.newSql')}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setConnectionDialogOpen(true)}>
              <Database />
              <span>{t('connection.new')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <IconTooltipButton
          label={sidebarCollapsed ? t('topBar.showSidebar') : t('topBar.hideSidebar')}
          variant="ghost"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          <LayoutPanelLeft />
        </IconTooltipButton>
        <IconTooltipButton label={t('settings.title')} variant="ghost" onClick={openSettings}>
          <Settings />
        </IconTooltipButton>
      </div>
      <ConnectionDialog open={connectionDialogOpen} onOpenChange={setConnectionDialogOpen} hideTrigger />
    </header>
  )
}

function isMacPlatform() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
}
