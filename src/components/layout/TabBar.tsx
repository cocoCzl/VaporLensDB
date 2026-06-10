import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, addTab, closeTab } = useEditorStore()
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId)
  const setActiveConnection = useConnectionStore((state) => state.setActiveConnection)

  function createTab() {
    const index = tabs.length + 1
    addTab({
      id: crypto.randomUUID(),
      kind: 'sql',
      title: `SQL ${index}`,
      sql: '',
      connectionId: activeConnectionId,
    })
  }

  return (
    <div className="flex h-9 items-center border-b ide-toolbar">
      <div className="flex min-w-0 flex-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId
          return (
            <button
              key={tab.id}
              type="button"
              className={[
                'group flex h-9 max-w-56 items-center gap-2 border-r px-3 text-xs',
                active
                  ? 'bg-background text-foreground shadow-[inset_0_-2px_0_hsl(var(--primary))]'
                  : 'text-muted-foreground hover:bg-muted',
              ].join(' ')}
              onClick={() => {
                setActiveTab(tab.id)
                setActiveConnection(tab.connectionId)
              }}
            >
              <span className="truncate">{tab.title}</span>
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
