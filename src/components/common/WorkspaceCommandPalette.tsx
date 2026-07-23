import { Database, FileCode2, Folder, History, Moon, PanelTop, Settings, Sun } from 'lucide-react'
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
import { useSqlDraftStore } from '@/stores/sqlDraftStore'
import { useUiStore } from '@/stores/uiStore'

export function WorkspaceCommandPalette() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { connections, dataSourceGroups, activeConnectionId, setActiveConnection } = useConnectionStore()
  const { tabs, addTab, setActiveTab } = useEditorStore()
  const historyCount = useQueryHistoryStore((state) => state.entries.length)
  const drafts = useSqlDraftStore((state) => state.drafts)
  const theme = useUiStore((state) => state.theme)
  const setTheme = useUiStore((state) => state.setTheme)
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

  useEffect(() => {
    const openPalette = () => setOpen(true)
    window.addEventListener('vaporlensdb:open-command-palette', openPalette)
    return () => window.removeEventListener('vaporlensdb:open-command-palette', openPalette)
  }, [])

  function closeAnd(action: () => void) {
    action()
    setOpen(false)
  }

  function openTab(kind: 'dataSources' | 'settings' | 'sqlScripts' | 'queryHistory') {
    const existing = tabs.find((tab) => tab.kind === kind)
    if (existing) {
      setActiveTab(existing.id)
      return
    }
    addTab({
      id: crypto.randomUUID(),
      kind,
      title: kind === 'settings' ? t('settings.title') : kind === 'dataSources' ? t('connection.dataSources') : kind === 'queryHistory' ? t('sql.history') : t('sql.drafts'),
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
            onSelect={() => closeAnd(() => openTab('queryHistory'))}
          >
            <History />
            {t('sql.history')}
            <CommandShortcut>{historyCount > 0 ? historyCount : t('commandPalette.unavailable')}</CommandShortcut>
          </CommandItem>
          <CommandItem value={`${t('sql.drafts')} scripts`} onSelect={() => closeAnd(() => openTab('sqlScripts'))}>
            <FileCode2 />
            {t('sql.drafts')}
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
            <>
              {dataSourceGroups.map((group) => (
                <CommandItem
                  key={`group-${group.id}`}
                  value={`${group.name} group`}
                  onSelect={() => closeAnd(() => {
                    const first = connections.find((connection) => connection.groupId === group.id)
                    if (first) setActiveConnection(first.id)
                  })}
                >
                  <Folder />
                  <span className="min-w-0 flex-1 truncate">{group.name}</span>
                  <CommandShortcut>{connections.filter((connection) => connection.groupId === group.id).length}</CommandShortcut>
                </CommandItem>
              ))}
              {connections.map((connection) => (
              <CommandItem
                key={connection.id}
                value={`${connection.name} ${connection.driverType} ${connection.host ?? ''} ${connection.database ?? ''}`}
                onSelect={() => closeAnd(() => setActiveConnection(connection.id))}
              >
                <Database />
                <span className="min-w-0 flex-1 truncate">{connection.name}</span>
                <CommandShortcut>{connection.driverType}</CommandShortcut>
              </CommandItem>
              ))}
            </>
          )}
        </CommandGroup>
        {tabs.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={t('sql.allTabs')}>
              {tabs.map((tab) => (
                <CommandItem key={tab.id} value={`${tab.title} tab`} onSelect={() => closeAnd(() => setActiveTab(tab.id))}>
                  <PanelTop />
                  <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        {drafts.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={t('sql.drafts')}>
              {drafts.slice(0, 20).map((draft) => (
                <CommandItem
                  key={draft.id}
                  value={`${draft.title} ${draft.sql} script`}
                  className="min-h-11 items-start py-1.5"
                  onSelect={() => closeAnd(() => addTab({
                    id: crypto.randomUUID(),
                    kind: 'sql',
                    title: draft.title,
                    sql: draft.sql,
                    connectionId: connections.some((connection) => connection.id === draft.connectionId)
                      ? draft.connectionId ?? null
                      : null,
                    draftId: draft.id,
                  }))}
                >
                  <FileCode2 className="mt-0.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[12px] text-foreground" title={draft.sql}>
                      {sqlPreview(draft.sql)}
                    </span>
                    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-[10px] text-muted-foreground">
                      <span className="truncate">{draft.connectionNameSnapshot ?? t('connection.disconnected')}</span>
                      {draftLocation(draft) && <><span aria-hidden="true">·</span><span className="truncate">{draftLocation(draft)}</span></>}
                      <span aria-hidden="true">·</span>
                      <time dateTime={draft.updatedAt}>{formatDraftTime(draft.updatedAt)}</time>
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
      <div className="flex items-center justify-between border-t px-3 py-2 text-[11px] text-muted-foreground">
        <span>{t('commandPalette.hint')}</span>
        <kbd className="font-mono">{shortcut}</kbd>
      </div>
    </CommandDialog>
  )
}

function sqlPreview(sql: string) {
  return sql.trim().split(/\s*\n\s*/).find(Boolean) ?? ''
}

function draftLocation(draft: { database?: string | null; schema?: string | null }) {
  return [draft.database, draft.schema].filter(Boolean).join(' / ')
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

function isMacPlatform() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
}
