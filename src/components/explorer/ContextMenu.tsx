import { Clipboard, Code2, Copy, FolderInput, Link, Pencil, RefreshCw, Star, Table2, Trash2, Unplug } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

export interface ContextMenuAction {
  id: string
  label: string
  icon: 'data' | 'ddl' | 'copy' | 'copyFull' | 'refresh' | 'connect' | 'disconnect' | 'edit' | 'duplicate' | 'move' | 'favorite' | 'delete'
  disabled?: boolean
  separatorBefore?: boolean
  tone?: 'danger'
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
  connect: Link,
  disconnect: Unplug,
  edit: Pencil,
  duplicate: Copy,
  move: FolderInput,
  favorite: Star,
  delete: Trash2,
}

export function ContextMenu({ x, y, actions, onClose }: ContextMenuProps) {
  const { t } = useTranslation()
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    menuRef.current?.focus()
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 cursor-default"
        aria-label={t('common.closeMenu', { defaultValue: 'Close menu' })}
        onClick={onClose}
      />
      <div
        ref={menuRef}
        role="menu"
        tabIndex={-1}
        className="ide-overlay fixed z-50 min-w-44 rounded p-1 text-xs outline-none"
        style={{ left: x, top: y }}
      >
        {actions.map((action) => {
          const Icon = ICONS[action.icon]
          return (
            <div key={action.id} className={action.separatorBefore ? 'mt-1 border-t border-border/65 pt-1' : ''}>
              <button
                type="button"
                role="menuitem"
                className={[
                  'flex h-7 w-full items-center gap-2 rounded px-2 text-left disabled:opacity-45 enabled:hover:bg-accent',
                  action.tone === 'danger' ? 'text-danger enabled:hover:bg-danger/10 enabled:hover:text-danger' : '',
                ].join(' ')}
                disabled={action.disabled}
                onClick={() => {
                  action.onSelect()
                  onClose()
                }}
              >
                <Icon className="size-3.5" />
                {action.label}
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}
