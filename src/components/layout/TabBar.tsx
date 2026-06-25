import { Check, Pencil, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, addTab, closeTab, renameTab } = useEditorStore()
  const connections = useConnectionStore((state) => state.connections)
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId)
  const setActiveConnection = useConnectionStore((state) => state.setActiveConnection)
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

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

  return (
    <div className="flex h-9 items-center border-b ide-toolbar">
      <div className="flex min-w-0 flex-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId
          const connection = connections.find((item) => item.id === tab.connectionId)
          const editing = editingTabId === tab.id
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
                  <span
                    className="max-w-24 shrink truncate rounded border bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                    title={connection?.name ?? 'No Data Source'}
                  >
                    {connection?.name ?? 'No DS'}
                  </span>
                  <Pencil className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
                </>
              )}
              <span
                role="button"
                tabIndex={0}
                className="grid size-5 place-items-center rounded hover:bg-accent"
                onClick={(event) => {
                  event.stopPropagation()
                  closeTab(tab.id)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    closeTab(tab.id)
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
    </div>
  )
}

function nextSqlIndex(titles: string[]) {
  let index = 1
  const existing = new Set(titles)
  while (existing.has(`SQL ${index}`)) index += 1
  return index
}
