import { ChevronLeft, ChevronRight, Database, FileCode2, HardDrive, History, Home, LayoutPanelLeft, MoreHorizontal, PanelTop, Plus, Search, Settings, Upload, Download } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { ConnectionDialog } from '@/components/connection/ConnectionDialog'
import { IconTooltipButton } from '@/components/common/IconTooltipButton'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { NEW_CONNECTION_EVENT, openSettingsSection, openWorkspaceTab, requestNewConnection } from '@/lib/workspaceNavigation'
import { createNewSqlTab } from '@/lib/newSqlCommand'
import { useEditorStore } from '@/stores/editorStore'
import { useUiStore } from '@/stores/uiStore'
import { VaporLensMark } from '@/components/layout/VaporLensMark'

/** Global entry points only: selecting a workspace never establishes a session. */
export function AppTopBar() {
  const { t } = useTranslation()
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false)
  const connectionTrigger = useRef<HTMLElement | null>(null)
  const commandShortcut = isMacPlatform() ? '⌘K' : 'Ctrl K'
  const addTab = useEditorStore(state => state.addTab)
  const { sidebarCollapsed, setSidebarCollapsed } = useUiStore(useShallow((state) => ({
    sidebarCollapsed: state.sidebarCollapsed, setSidebarCollapsed: state.setSidebarCollapsed,
  })))

  useEffect(() => {
    const open = () => {
      connectionTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setConnectionDialogOpen(true)
    }
    window.addEventListener(NEW_CONNECTION_EVENT, open)
    return () => window.removeEventListener(NEW_CONNECTION_EVENT, open)
  }, [])

  function openNewQuery() {
    addTab(createNewSqlTab())
  }

  return (
    <header className="ide-top-bar shell-top flex min-w-0 shrink-0 items-center gap-1.5 border-b px-3" aria-label={t('topBar.label')}>
      <VaporLensMark className="mr-1 size-6 shrink-0" />
      <div className="flex shrink-0 items-center gap-0.5">
        <IconTooltipButton label={t('topBar.backUnavailable')} variant="ghost" disabled><ChevronLeft /></IconTooltipButton>
        <IconTooltipButton label={t('topBar.forwardUnavailable')} variant="ghost" disabled><ChevronRight /></IconTooltipButton>
      </div>
      <div className="flex shrink-0 items-center gap-1 border-l border-border/70 pl-2">
        <IconTooltipButton label={t('connection.new')} size="sm" className="h-8 w-8 px-0 min-[1200px]:w-auto min-[1200px]:px-2.5" onClick={requestNewConnection}>
          <Plus /><span className="hidden min-[1200px]:inline">{t('connection.new')}</span>
        </IconTooltipButton>
        <IconTooltipButton label={t('topBar.drivers')} size="sm" variant="ghost" className="h-8 w-8 px-0 min-[1200px]:w-auto min-[1200px]:px-2.5" onClick={() => openWorkspaceTab('drivers')}>
          <HardDrive /><span className="hidden min-[1200px]:inline">{t('topBar.drivers')}</span>
        </IconTooltipButton>
        <DropdownMenu>
          <DropdownMenuTrigger render={<IconTooltipButton label={t('topBar.more')} size="sm" variant="ghost" className="h-8 w-8 px-0 min-[1200px]:w-auto min-[1200px]:px-2"><MoreHorizontal /><span className="hidden min-[1200px]:inline">{t('topBar.more')}</span></IconTooltipButton>} />
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuItem onClick={openNewQuery}><FileCode2 /><span>{t('workbench.newSql')}</span></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => openSettingsSection('import')}><Upload /><span>{t('dbeaver.title')}</span></DropdownMenuItem>
            <DropdownMenuItem onClick={() => openWorkspaceTab('queryHistory')}><History /><span>{t('sql.history')}</span></DropdownMenuItem>
            <DropdownMenuItem onClick={() => openSettingsSection('diagnostics')}><Download /><span>{t('settings.diagnostics.title')}</span></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex min-w-0 flex-1 justify-center px-2 min-[1200px]:px-4">
        <Button type="button" size="sm" variant="outline" className="h-8 w-full min-w-0 max-w-[520px] justify-start gap-2 px-2.5 font-normal text-muted-foreground shadow-none" aria-label={t('topBar.searchAria')} onClick={() => window.dispatchEvent(new Event('vaporlensdb:open-command-palette'))}>
          <Search className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left"><span className="hidden min-[1200px]:inline">{t('topBar.searchPlaceholder')}</span><span className="min-[1200px]:hidden">{t('topBar.searchShort')}</span></span>
          <kbd className="hidden rounded-sm border border-border/70 px-1 py-px font-mono text-[10px] min-[980px]:inline">{commandShortcut}</kbd>
        </Button>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <IconTooltipButton label={sidebarCollapsed ? t('topBar.showSidebar') : t('topBar.hideSidebar')} variant="ghost" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}><LayoutPanelLeft /></IconTooltipButton>
        <DropdownMenu>
          <DropdownMenuTrigger render={<IconTooltipButton label={t('topBar.workspaces')} variant="ghost"><PanelTop /></IconTooltipButton>} />
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => useEditorStore.setState({ activeTabId: null })}><Home /><span>{t('topBar.home')}</span></DropdownMenuItem>
            <DropdownMenuItem onClick={() => openWorkspaceTab('dataSources')}><Database /><span>{t('connection.dataSources')}</span></DropdownMenuItem>
            <DropdownMenuItem onClick={() => openWorkspaceTab('sqlScripts')}><FileCode2 /><span>{t('sql.drafts')}</span></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <IconTooltipButton label={t('settings.title')} variant="ghost" onClick={() => openWorkspaceTab('settings')}><Settings /></IconTooltipButton>
      </div>
      <ConnectionDialog open={connectionDialogOpen} onOpenChange={(open) => {
        setConnectionDialogOpen(open)
        if (!open) requestAnimationFrame(() => connectionTrigger.current?.focus())
      }} hideTrigger />
    </header>
  )
}

function isMacPlatform() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
}
