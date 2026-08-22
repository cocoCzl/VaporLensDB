import { Check, Database, FileCode2, History, List, Network, Pin, Plus, Search, Settings2, Table2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { IconTooltipButton } from '@/components/common/IconTooltipButton'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import { useSqlDraftStore } from '@/stores/sqlDraftStore'
import { rollbackConsoleTransaction, setConsoleTransactionMode } from '@/ipc/query'
import type { EditorTab } from '@/stores/editorStore'

export function TabBar() {
  const { t } = useTranslation()
  const { tabs, activeTabId, setActiveTab, addTab, closeTab, renameTab, setTabDraft, setRecordsConnectionFilter, toggleTabPinned } = useEditorStore(useShallow((state) => ({
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    setActiveTab: state.setActiveTab,
    addTab: state.addTab,
    closeTab: state.closeTab,
    renameTab: state.renameTab,
    setTabDraft: state.setTabDraft,
    setRecordsConnectionFilter: state.setRecordsConnectionFilter,
    toggleTabPinned: state.toggleTabPinned,
  })))
  const connections = useConnectionStore((state) => state.connections)
  const statuses = useConnectionStore((state) => state.statuses)
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId)
  const setActiveConnection = useConnectionStore((state) => state.setActiveConnection)
  const saveTabDraft = useSqlDraftStore((state) => state.saveTabDraft)
  const markDraftClosed = useSqlDraftStore((state) => state.markClosed)
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [tabListOpen, setTabListOpen] = useState(false)
  const [tabContextMenu, setTabContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(null)
  const tabListMenuRef = useRef<HTMLDivElement | null>(null)
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())

  function createTab() {
    const connection = connections.find((item) => item.id === activeConnectionId)
    addTab({
      id: crypto.randomUUID(),
      kind: 'sql',
      title: connection ? `${connection.name} SQL` : `SQL ${nextSqlIndex(tabs.map((tab) => tab.title))}`,
      sql: '',
      connectionId: activeConnectionId,
    })
  }

  function openRecordsWorkspace(kind: 'sqlScripts' | 'queryHistory') {
    const activeTab = tabs.find((tab) => tab.id === activeTabId)
    const connectionId = kind === 'queryHistory'
      ? activeTab?.connectionId ?? activeConnectionId
      : null
    const existing = tabs.find((tab) => tab.kind === kind)
    if (existing) {
      setRecordsConnectionFilter(existing.id, connectionId)
      setActiveTab(existing.id)
      return
    }
    addTab({
      id: crypto.randomUUID(),
      kind,
      title: kind === 'sqlScripts' ? t('sql.drafts') : t('sql.history'),
      sql: '',
      connectionId: null,
      recordsConnectionFilter: connectionId,
    })
  }

  function commitRename(tabId: string) {
    renameTab(tabId, editingTitle)
    setEditingTabId(null)
    setEditingTitle('')
  }

  function closeEditorTab(tab: EditorTab) {
    if (tab.connectionId && tab.transactionMode === 'manual') {
      if (tab.transactionPhase !== 'idle') {
        if (!window.confirm('This Console has an uncommitted transaction. Roll it back and close the Console?')) return
        void rollbackConsoleTransaction(tab.connectionId, tab.id)
          .then(() => setConsoleTransactionMode(tab.connectionId!, tab.id, 'auto'))
          .then(() => closeEditorTabAfterTransaction(tab))
        return
      }
      void setConsoleTransactionMode(tab.connectionId, tab.id, 'auto').then(() => closeEditorTabAfterTransaction(tab))
      return
    }
    closeEditorTabAfterTransaction(tab)
  }

  function closeEditorTabAfterTransaction(tab: EditorTab) {
    if (!tab.kind || tab.kind === 'sql') {
      const connection = connections.find((item) => item.id === tab.connectionId) ?? null
      if (tab.sql.trim()) {
        void saveTabDraft(tab, { connection }, true).then((draft) => {
          if (draft) setTabDraft(tab.id, draft.id)
        })
      } else if (tab.draftId) {
        void markDraftClosed(tab.draftId)
      }
    }
    closeTab(tab.id)
  }

  useEffect(() => {
    if (!activeTabId) return
    tabRefs.current.get(activeTabId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTabId])

  useEffect(() => {
    if (!tabListOpen && !tabContextMenu) return

    function closeMenus(event: MouseEvent) {
      if (tabListMenuRef.current?.contains(event.target as Node)) return
      setTabListOpen(false)
      setTabContextMenu(null)
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setTabListOpen(false)
        setTabContextMenu(null)
      }
    }

    document.addEventListener('mousedown', closeMenus)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeMenus)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [tabContextMenu, tabListOpen])

  function closeTabs(candidates: EditorTab[]) {
    candidates.forEach((tab) => closeEditorTab(tab))
    setTabContextMenu(null)
  }

  return (
    <div className="ide-tab-strip flex h-8 items-center border-b">
      <div className="flex min-w-0 flex-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId
          const connection = connections.find((item) => item.id === tab.connectionId)
          const editing = editingTabId === tab.id
          const managementTab = tab.kind === 'dataSources' || tab.kind === 'settings'
          return (
            <button
              key={tab.id}
              ref={(element) => {
                if (element) {
                  tabRefs.current.set(tab.id, element)
                } else {
                  tabRefs.current.delete(tab.id)
                }
              }}
              type="button"
              className={[
                'group flex h-8 max-w-56 items-center gap-1.5 border-r border-border/55 px-2.5 text-xs transition-colors',
                active
                  ? 'bg-background text-foreground shadow-[inset_0_-2px_0_hsl(var(--primary)),inset_0_1px_0_hsl(var(--foreground)/0.04)]'
                  : 'text-muted-foreground hover:bg-[hsl(var(--hover))] hover:text-foreground',
              ].join(' ')}
              onClick={() => {
                setActiveTab(tab.id)
                if (tab.connectionId) {
                  setActiveConnection(tab.connectionId)
                }
              }}
              onDoubleClick={() => {
                setEditingTabId(tab.id)
                setEditingTitle(tab.title)
              }}
              onAuxClick={(event) => {
                if (event.button === 1 && !tab.pinned) {
                  event.preventDefault()
                  closeEditorTab(tab)
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                setTabContextMenu({ tabId: tab.id, x: event.clientX, y: event.clientY })
              }}
            >
              {editing ? (
                <span className="flex min-w-32 items-center gap-1" onClick={(event) => event.stopPropagation()}>
                  <input
                    className="h-6 min-w-0 flex-1 rounded border bg-background px-1.5 text-xs outline-none"
                    value={editingTitle}
                    autoFocus
                    onChange={(event) => setEditingTitle(event.target.value)}
                    onBlur={() => commitRename(tab.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        commitRename(tab.id)
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        setEditingTabId(null)
                        setEditingTitle('')
                      }
                    }}
                  />
                  <Check className="size-3" />
                </span>
              ) : (
                <>
                  <TabKindGlyph kind={tab.kind} />
                  {!managementTab && (
                    <span
                      className={[
                        'size-1.5 shrink-0 rounded-full',
                        connectionStatusClass(connection ? statuses[connection.id]?.status ?? 'disconnected' : 'disconnected'),
                      ].join(' ')}
                      title={connection ? `${connection.name} · ${connectionStatusLabel(statuses[connection.id]?.status ?? 'disconnected', t)}` : t('connection.disconnected')}
                    />
                  )}
                  <span className="min-w-0 truncate">{tab.title}</span>
                  {tab.dirty && (
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-primary"
                      title={t('sql.unsavedChanges')}
                      aria-label={t('sql.unsavedChanges')}
                    />
                  )}
                  {tab.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" />}
                </>
              )}
              <span
                role="button"
                tabIndex={0}
                className="grid size-5 shrink-0 place-items-center rounded opacity-0 hover:bg-accent group-hover:opacity-100 group-focus-within:opacity-100"
                onClick={(event) => {
                  event.stopPropagation()
                  closeEditorTab(tab)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    closeEditorTab(tab)
                  }
                }}
              >
                <X className="size-3" />
              </span>
            </button>
          )
        })}
      </div>
      <div ref={tabListMenuRef} className="relative shrink-0">
        <IconTooltipButton
          label={t('sql.allTabs')}
          variant="ghost"
          aria-expanded={tabListOpen}
          onClick={() => setTabListOpen((open) => !open)}
        >
          <List className="size-3.5" />
        </IconTooltipButton>
        {tabListOpen && (
          <div
            role="menu"
            className="ide-overlay absolute right-0 top-8 z-[100] max-h-[70vh] w-72 overflow-auto rounded-lg p-1"
          >
            <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('sql.allTabs')}
            </div>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="menuitem"
                className={[
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs',
                  tab.id === activeTabId ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
                ].join(' ')}
                onClick={() => {
                  setActiveTab(tab.id)
                  if (tab.connectionId) setActiveConnection(tab.connectionId)
                  setTabListOpen(false)
                }}
              >
                <span className={['size-1.5 rounded-full', connectionStatusClass(tab.connectionId ? statuses[tab.connectionId]?.status ?? 'disconnected' : 'disconnected')].join(' ')} />
                <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                {tab.dirty && <span className="size-1.5 rounded-full bg-primary" title={t('sql.unsavedChanges')} />}
                {tab.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" />}
              </button>
            ))}
          </div>
        )}
      </div>
      <IconTooltipButton label={t('sql.new')} variant="ghost" onClick={createTab}>
        <Plus />
      </IconTooltipButton>
      <IconTooltipButton label={t('sql.drafts')} variant="ghost" onClick={() => openRecordsWorkspace('sqlScripts')}>
        <FileCode2 />
      </IconTooltipButton>
      <IconTooltipButton label={t('sql.history')} variant="ghost" onClick={() => openRecordsWorkspace('queryHistory')}>
        <History />
      </IconTooltipButton>
      <span className="ide-toolbar-separator" aria-hidden="true" />
      <IconTooltipButton
        label={t('commandPalette.title')}
        variant="ghost"
        onClick={() => window.dispatchEvent(new Event('vaporlensdb:open-command-palette'))}
      >
        <Search />
      </IconTooltipButton>
      {tabContextMenu && (() => {
        const tab = tabs.find((candidate) => candidate.id === tabContextMenu.tabId)
        if (!tab) return null
        const tabIndex = tabs.findIndex((candidate) => candidate.id === tab.id)
        const closableOthers = tabs.filter((candidate) => candidate.id !== tab.id && !candidate.pinned)
        const closableRight = tabs.slice(tabIndex + 1).filter((candidate) => !candidate.pinned)
        return (
          <div
            role="menu"
            className="ide-overlay fixed z-[200] w-48 rounded-lg p-1 text-xs"
            style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
          >
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
              onClick={() => {
                toggleTabPinned(tab.id)
                setTabContextMenu(null)
              }}
            >
              <Pin className="size-3.5" />
              {tab.pinned ? t('sql.unpinTab') : t('sql.pinTab')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted disabled:opacity-40"
              onClick={() => closeTabs([tab])}
            >
              <X className="size-3.5" />
              {t('sql.closeTab')}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={closableOthers.length === 0}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted disabled:opacity-40"
              onClick={() => closeTabs(closableOthers)}
            >
              <X className="size-3.5" />
              {t('sql.closeOtherTabs')}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={closableRight.length === 0}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted disabled:opacity-40"
              onClick={() => closeTabs(closableRight)}
            >
              <X className="size-3.5" />
              {t('sql.closeTabsToRight')}
            </button>
          </div>
        )
      })()}
    </div>
  )
}

function TabKindGlyph({ kind }: { kind: EditorTab['kind'] }) {
  const iconClass = 'size-3.5 shrink-0 text-muted-foreground'
  if (kind === 'dataSources') return <Database className={iconClass} />
  if (kind === 'settings') return <Settings2 className={iconClass} />
  if (kind === 'diagram') return <Network className={iconClass} />
  if (kind === 'data' || kind === 'structure' || kind === 'objectSummary') return <Table2 className={iconClass} />
  return <FileCode2 className={iconClass} />
}

function connectionStatusClass(status: string) {
  if (status === 'connected') return 'bg-emerald-500'
  if (status === 'connecting') return 'bg-amber-500'
  if (status === 'failed') return 'bg-destructive'
  return 'bg-muted-foreground/40'
}

function connectionStatusLabel(status: string, t: ReturnType<typeof useTranslation>['t']) {
  if (status === 'connected') return t('connection.connected')
  if (status === 'connecting') return t('connection.connecting')
  if (status === 'failed') return t('connection.failed')
  return t('connection.disconnected')
}

function nextSqlIndex(titles: string[]) {
  let index = 1
  const existing = new Set(titles)
  while (existing.has(`SQL ${index}`)) index += 1
  return index
}
