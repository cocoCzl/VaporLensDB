import { Check, Clock3, History, List, Pin, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconTooltipButton } from '@/components/common/IconTooltipButton'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import { useSqlDraftStore } from '@/stores/sqlDraftStore'
import type { EditorTab } from '@/stores/editorStore'
import type { SqlDraft } from '@/types/sqlDraft'

export function TabBar() {
  const { t } = useTranslation()
  const { tabs, activeTabId, setActiveTab, addTab, closeTab, renameTab, setTabDraft, setRecordsConnectionFilter, toggleTabPinned } = useEditorStore()
  const connections = useConnectionStore((state) => state.connections)
  const statuses = useConnectionStore((state) => state.statuses)
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId)
  const setActiveConnection = useConnectionStore((state) => state.setActiveConnection)
  const drafts = useSqlDraftStore((state) => state.drafts)
  const saveTabDraft = useSqlDraftStore((state) => state.saveTabDraft)
  const markDraftClosed = useSqlDraftStore((state) => state.markClosed)
  const clearDrafts = useSqlDraftStore((state) => state.clear)
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [recentOpen, setRecentOpen] = useState(false)
  const [tabListOpen, setTabListOpen] = useState(false)
  const [tabContextMenu, setTabContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(null)
  const recentMenuRef = useRef<HTMLDivElement | null>(null)
  const tabListMenuRef = useRef<HTMLDivElement | null>(null)
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())
  const clearDraftTimer = useRef<number | null>(null)
  const [confirmClearDrafts, setConfirmClearDrafts] = useState(false)

  function resetClearDraftConfirmation() {
    if (clearDraftTimer.current !== null) {
      window.clearTimeout(clearDraftTimer.current)
      clearDraftTimer.current = null
    }
    setConfirmClearDrafts(false)
  }

  function requestClearDrafts() {
    if (confirmClearDrafts) {
      void clearDrafts().finally(resetClearDraftConfirmation)
      return
    }
    setConfirmClearDrafts(true)
    clearDraftTimer.current = window.setTimeout(resetClearDraftConfirmation, 4_000)
  }

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

  function restoreDraft(draft: SqlDraft) {
    setRecentOpen(false)
    const existing = tabs.find((tab) => tab.draftId === draft.id)
    if (existing) {
      setActiveTab(existing.id)
      if (existing.connectionId) setActiveConnection(existing.connectionId)
      return
    }

    const connectionExists = connections.some((connection) => connection.id === draft.connectionId)
    const tabId = crypto.randomUUID()
    addTab({
      id: tabId,
      kind: 'sql',
      title: draft.title || t('sql.restoredDraftTitle'),
      sql: draft.sql,
      connectionId: connectionExists ? draft.connectionId ?? null : null,
      draftId: draft.id,
    })
    if (connectionExists && draft.connectionId) {
      setActiveConnection(draft.connectionId)
    }
  }

  function closeEditorTab(tab: EditorTab) {
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

  const lastDraft = drafts[0] ?? null

  useEffect(() => {
    if (!activeTabId) return
    tabRefs.current.get(activeTabId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTabId])

  useEffect(() => {
    if (!recentOpen) return

    function closeOnOutside(event: MouseEvent) {
      if (!recentMenuRef.current?.contains(event.target as Node)) {
        setRecentOpen(false)
        resetClearDraftConfirmation()
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setRecentOpen(false)
        resetClearDraftConfirmation()
      }
    }

    document.addEventListener('mousedown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [recentOpen])

  useEffect(() => () => {
    if (clearDraftTimer.current !== null) window.clearTimeout(clearDraftTimer.current)
  }, [])

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
                  ? 'bg-background text-foreground shadow-[inset_0_-2px_0_hsl(var(--primary))]'
                  : 'text-muted-foreground hover:bg-background/65 hover:text-foreground',
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
      <div ref={recentMenuRef} className="relative shrink-0">
        <IconTooltipButton
          label={t('sql.recentScripts')}
          variant="ghost"
          aria-haspopup="menu"
          aria-expanded={recentOpen}
          onClick={() => setRecentOpen((open) => !open)}
        >
          <Clock3 />
        </IconTooltipButton>
        {recentOpen && (
          <div
            role="menu"
            className="absolute right-0 top-9 z-[100] max-h-[70vh] w-80 overflow-auto rounded-lg border bg-card p-1 text-card-foreground shadow-xl"
          >
            <div className="flex items-center justify-between gap-2 px-1.5 py-1 text-xs font-medium text-muted-foreground">
              <span>{t('sql.recentScripts')}</span>
              {drafts.length > 0 && (
                <button
                  type="button"
                  className={confirmClearDrafts
                    ? 'grid size-6 place-items-center rounded text-destructive hover:bg-destructive/10'
                    : 'grid size-6 place-items-center rounded hover:bg-muted hover:text-foreground'}
                  title={confirmClearDrafts ? t('sql.confirmClearRecentScripts') : t('sql.clearRecentScripts')}
                  aria-label={confirmClearDrafts ? t('sql.confirmClearRecentScripts') : t('sql.clearRecentScripts')}
                  onClick={requestClearDrafts}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
            <button
              type="button"
              role="menuitem"
              disabled={!lastDraft}
              className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
              onClick={() => lastDraft && restoreDraft(lastDraft)}
            >
              <Clock3 className="size-3.5" />
              <span className="min-w-0 flex-1 truncate">{t('sql.lastEditedScript')}</span>
            </button>
            <div className="-mx-1 my-1 h-px bg-border" />
            {drafts.length === 0 ? (
              <div className="px-2 py-2 text-xs text-muted-foreground">{t('sql.noRecentScripts')}</div>
            ) : (
              drafts.slice(0, 12).map((draft) => (
                <button
                  key={draft.id}
                  type="button"
                  role="menuitem"
                  className="flex w-full items-start gap-1.5 rounded-md px-1.5 py-2 text-left outline-none hover:bg-accent hover:text-accent-foreground"
                  onClick={() => restoreDraft(draft)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{draft.title || t('sql.restoredDraftTitle')}</div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                      {sqlPreview(draft.sql)}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {draft.connectionNameSnapshot ?? t('connection.disconnected')} · {formatDraftTime(draft.updatedAt)}
                    </div>
                  </div>
                </button>
              ))
            )}
            <div className="-mx-1 mt-1 border-t px-1 pt-1">
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs font-medium hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  setRecentOpen(false)
                  openRecordsWorkspace('sqlScripts')
                }}
              >
                <List className="size-3.5" />
                {t('sql.showAllRecentScripts')}
              </button>
            </div>
          </div>
        )}
      </div>
      <IconTooltipButton label={t('sql.history')} variant="ghost" onClick={() => openRecordsWorkspace('queryHistory')}>
        <History />
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

function sqlPreview(sql: string) {
  return sql.trim().split(/\s*\n\s*/).find(Boolean) ?? ''
}

function formatDraftTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
