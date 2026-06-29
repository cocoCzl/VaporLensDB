import { Check, ChevronDown, Clock3, Pencil, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import { useSqlDraftStore } from '@/stores/sqlDraftStore'
import type { EditorTab } from '@/stores/editorStore'
import type { SqlDraft } from '@/types/sqlDraft'

export function TabBar() {
  const { t } = useTranslation()
  const { tabs, activeTabId, setActiveTab, addTab, closeTab, renameTab, setTabDraft } = useEditorStore()
  const connections = useConnectionStore((state) => state.connections)
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId)
  const setActiveConnection = useConnectionStore((state) => state.setActiveConnection)
  const drafts = useSqlDraftStore((state) => state.drafts)
  const saveTabDraft = useSqlDraftStore((state) => state.saveTabDraft)
  const markDraftClosed = useSqlDraftStore((state) => state.markClosed)
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [recentOpen, setRecentOpen] = useState(false)
  const recentMenuRef = useRef<HTMLDivElement | null>(null)

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
    if (!recentOpen) return

    function closeOnOutside(event: MouseEvent) {
      if (!recentMenuRef.current?.contains(event.target as Node)) {
        setRecentOpen(false)
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setRecentOpen(false)
      }
    }

    document.addEventListener('mousedown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [recentOpen])

  return (
    <div className="flex h-9 items-center border-b ide-toolbar">
      <div className="flex min-w-0 flex-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId
          const connection = connections.find((item) => item.id === tab.connectionId)
          const editing = editingTabId === tab.id
          const managementTab = tab.kind === 'dataSources' || tab.kind === 'settings'
          return (
            <button
              key={tab.id}
              type="button"
              className={[
                'group flex h-9 max-w-64 items-center gap-2 border-r px-3 text-xs',
                active
                  ? 'bg-background text-foreground shadow-[inset_0_-2px_0_hsl(var(--primary))]'
                  : 'text-muted-foreground hover:bg-muted',
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
                  <span className="min-w-0 truncate">{tab.title}</span>
                  {!managementTab && (
                    <span
                      className="max-w-24 shrink truncate rounded border bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      title={connection?.name ?? 'No Data Source'}
                    >
                      {connection?.name ?? 'No DS'}
                    </span>
                  )}
                  <Pencil className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
                </>
              )}
              <span
                role="button"
                tabIndex={0}
                className="grid size-5 place-items-center rounded hover:bg-accent"
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
      <Button type="button" size="sm" variant="ghost" className="h-8 px-2" onClick={createTab}>
        <Plus />
      </Button>
      <div ref={recentMenuRef} className="relative shrink-0">
        <button
          type="button"
          className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-lg border border-transparent px-2 text-sm font-medium transition-all outline-none select-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-muted aria-expanded:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          title={t('sql.recentScripts')}
          aria-haspopup="menu"
          aria-expanded={recentOpen}
          onClick={() => setRecentOpen((open) => !open)}
        >
          <Clock3 />
          <ChevronDown className="size-3" />
        </button>
        {recentOpen && (
          <div
            role="menu"
            className="absolute right-0 top-9 z-[100] max-h-[70vh] w-80 overflow-auto rounded-lg border bg-card p-1 text-card-foreground shadow-xl"
          >
            <div className="px-1.5 py-1 text-xs font-medium text-muted-foreground">
              {t('sql.recentScripts')}
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
          </div>
        )}
      </div>
    </div>
  )
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
