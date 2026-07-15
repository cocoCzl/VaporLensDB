import { Database, FileCode2, History, Moon, Settings, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import { useQueryHistoryStore } from '@/stores/queryHistoryStore'
import { useUiStore } from '@/stores/uiStore'

export function WorkspaceCommandPalette() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { connections, activeConnectionId, setActiveConnection } = useConnectionStore()
  const { tabs, addTab, setActiveTab } = useEditorStore()
  const historyCount = useQueryHistoryStore((state) => state.entries.length)
  const theme = useUiStore((state) => state.theme)
  const setTheme = useUiStore((state) => state.setTheme)
  const requestQueryHistory = useUiStore((state) => state.requestQueryHistory)
  const shortcut = isMacPlatform() ? '⌘K' : 'Ctrl+K'

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(true)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  function closeAnd(action: () => void) {
    action()
    setOpen(false)
  }

  function openTab(kind: 'dataSources' | 'settings') {
    const existing = tabs.find((tab) => tab.kind === kind)
    if (existing) {
      setActiveTab(existing.id)
      return
    }
    addTab({
      id: crypto.randomUUID(),
      kind,
      title: kind === 'settings' ? t('settings.title') : t('connection.dataSources'),
      sql: '',
      connectionId: null,
    })
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t('commandPalette.title')}
      description={t('commandPalette.description')}
      className="max-w-xl sm:max-w-xl"
    >
      <CommandInput placeholder={t('commandPalette.placeholder')} />
      <CommandList>
        <CommandEmpty>{t('commandPalette.empty')}</CommandEmpty>
        <CommandGroup heading={t('commandPalette.workspace')}>
          <CommandItem
            value={`${t('workbench.newSql')} new sql`}
            onSelect={() => closeAnd(() => addTab({
              id: crypto.randomUUID(),
              kind: 'sql',
              title: `SQL ${tabs.filter((tab) => tab.kind === 'sql' || !tab.kind).length + 1}`,
              sql: '',
              connectionId: activeConnectionId,
            }))}
          >
            <FileCode2 />
            {t('workbench.newSql')}
          </CommandItem>
          <CommandItem value={`${t('connection.dataSources')} data sources`} onSelect={() => closeAnd(() => openTab('dataSources'))}>
            <Database />
            {t('connection.dataSources')}
          </CommandItem>
          <CommandItem value={`${t('settings.title')} settings`} onSelect={() => closeAnd(() => openTab('settings'))}>
            <Settings />
            {t('settings.title')}
          </CommandItem>
          <CommandItem
            value={`${t('sql.history')} query history`}
            disabled={historyCount === 0}
            onSelect={() => closeAnd(requestQueryHistory)}
          >
            <History />
            {t('sql.history')}
            <CommandShortcut>{historyCount > 0 ? historyCount : t('commandPalette.unavailable')}</CommandShortcut>
          </CommandItem>
          <CommandItem
            value={`${t('commandPalette.toggleTheme')} theme`}
            onSelect={() => closeAnd(() => setTheme(theme === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? <Sun /> : <Moon />}
            {t('commandPalette.toggleTheme')}
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading={t('commandPalette.dataSources')}>
          {connections.length === 0 ? (
            <CommandItem disabled value="no data sources">{t('connection.empty')}</CommandItem>
          ) : (
            connections.map((connection) => (
              <CommandItem
                key={connection.id}
                value={`${connection.name} ${connection.driverType} ${connection.host ?? ''} ${connection.database ?? ''}`}
                onSelect={() => closeAnd(() => setActiveConnection(connection.id))}
              >
                <Database />
                <span className="min-w-0 flex-1 truncate">{connection.name}</span>
                <CommandShortcut>{connection.driverType}</CommandShortcut>
              </CommandItem>
            ))
          )}
        </CommandGroup>
      </CommandList>
      <div className="flex items-center justify-between border-t px-3 py-2 text-[11px] text-muted-foreground">
        <span>{t('commandPalette.hint')}</span>
        <kbd className="font-mono">{shortcut}</kbd>
      </div>
    </CommandDialog>
  )
}

function isMacPlatform() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
}
