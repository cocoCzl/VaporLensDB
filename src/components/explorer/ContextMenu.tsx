import { Clipboard, Code2, RefreshCw, Table2 } from 'lucide-react'

export interface ContextMenuAction {
  id: string
  label: string
  icon: 'data' | 'ddl' | 'copy' | 'copyFull' | 'refresh'
  disabled?: boolean
  onSelect: () => void
}

interface ContextMenuProps {
  x: number
  y: number
  actions: ContextMenuAction[]
  onClose: () => void
}

const ICONS = {
  data: Table2,
  ddl: Code2,
  copy: Clipboard,
  copyFull: Clipboard,
  refresh: RefreshCw,
}

export function ContextMenu({ x, y, actions, onClose }: ContextMenuProps) {
  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 cursor-default"
        aria-label="关闭菜单"
        onClick={onClose}
      />
      <div
        className="fixed z-50 min-w-44 rounded-md border bg-card p-1 text-xs text-foreground shadow-lg"
        style={{ left: x, top: y }}
      >
        {actions.map((action) => {
          const Icon = ICONS[action.icon]
          return (
            <button
              key={action.id}
              type="button"
              className="flex h-8 w-full items-center gap-2 rounded px-2 text-left disabled:opacity-45 enabled:hover:bg-accent"
              disabled={action.disabled}
              onClick={() => {
                action.onSelect()
                onClose()
              }}
            >
              <Icon className="size-3.5" />
              {action.label}
            </button>
          )
        })}
      </div>
    </>
  )
}
