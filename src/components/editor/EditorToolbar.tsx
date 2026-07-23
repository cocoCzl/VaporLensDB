import { Check, ChartNoAxesCombined, ChevronDown, Database, Play, Search, Square, Wand2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { IconTooltipButton } from '@/components/common/IconTooltipButton'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { ConnectionConfig, DataSourceGroup } from '@/types/connection'
import type { DatabaseInfo, SchemaInfo } from '@/types/metadata'

interface EditorToolbarProps {
  connections: ConnectionConfig[]
  connectionStatuses?: Record<string, string>
  dataSourceGroups?: DataSourceGroup[]
  connectionId: string | null
  database?: string | null
  schema?: string | null
  databases?: DatabaseInfo[]
  schemas?: SchemaInfo[]
  maxRows: number
  running?: boolean
  canCancel?: boolean
  canExplain?: boolean
  explainUnsupportedReason?: string
  disabled?: boolean
  formatDisabled?: boolean
  onConnectionChange: (connectionId: string | null) => void
  onDatabaseChange?: (database: string | null) => void
  onSchemaChange?: (schema: string | null) => void
  onMaxRowsChange: (maxRows: number) => void
  onRun: () => void
  onCancel: () => void
  onExplain: () => void
  onFormat: () => void
}

export function EditorToolbar({
  connections,
  connectionStatuses = {},
  dataSourceGroups = [],
  connectionId,
  database,
  schema,
  databases = [],
  schemas = [],
  maxRows,
  running = false,
  canCancel = false,
  canExplain = true,
  explainUnsupportedReason,
  disabled = false,
  formatDisabled = false,
  onConnectionChange,
  onDatabaseChange,
  onSchemaChange,
  onMaxRowsChange,
  onRun,
  onCancel,
  onExplain,
  onFormat,
}: EditorToolbarProps) {
  const { t } = useTranslation()
  const explainTitle = canExplain ? t('editor.explain') : (explainUnsupportedReason ?? t('editor.explainUnsupported'))
  const runShortcut = isMacPlatform() ? '⌘↵' : 'Ctrl+Enter'

  return (
    <div className="flex h-11 items-center gap-2 overflow-hidden border-b ide-toolbar px-3">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
        <Database className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <ExecutionDataSourcePicker
          connections={connections}
          groups={dataSourceGroups}
          statuses={connectionStatuses}
          connectionId={connectionId}
          disabled={running}
          onChange={onConnectionChange}
        />
        <select
          className="ide-select hidden min-w-28 max-w-40 shrink-0 sm:block"
          aria-label={t('metadata.database')}
          value={database ?? ''}
          disabled={!connectionId || databases.length === 0}
          title={t('editor.databaseSelectHint')}
          onChange={(event) => onDatabaseChange?.(event.target.value || null)}
        >
          {!database && <option value="">{t('metadata.database')}</option>}
          {databases.map((item) => (
            <option key={item.name} value={item.name}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          className="ide-select hidden min-w-24 max-w-36 shrink-0 md:block"
          aria-label={t('metadata.schema')}
          value={schema ?? ''}
          disabled={!connectionId || schemas.length === 0}
          onChange={(event) => onSchemaChange?.(event.target.value || null)}
        >
          {!schema && <option value="">Schema</option>}
          {schemas.map((item) => (
            <option key={item.name} value={item.name}>
              {item.name}
            </option>
          ))}
        </select>
        <label className="flex shrink-0 items-center gap-1 rounded-md border border-transparent px-1.5 text-[11px] text-muted-foreground hover:border-border">
          <span className="hidden lg:inline">{t('editor.rowLimit')}</span>
          <select
            className="h-7 max-w-18 bg-transparent font-mono text-xs text-foreground outline-none"
            aria-label={t('editor.rowLimit')}
            value={maxRows}
            onChange={(event) => onMaxRowsChange(Number(event.target.value))}
          >
            {[100, 500, 1000, 5000, 10000, 50000].map((value) => (
              <option key={value} value={value}>{value.toLocaleString()}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {running && canCancel ? (
          <IconTooltipButton label={t('editor.cancel')} variant="destructive" onClick={onCancel}>
            <Square />
          </IconTooltipButton>
        ) : running ? (
          <IconTooltipButton label={t('editor.running')} variant="secondary" disabled>
            <Play />
          </IconTooltipButton>
        ) : (
          <Button
            type="button"
            size="icon-sm"
            aria-label={`${t('editor.run')} (${runShortcut})`}
            title={`${t('editor.run')} (${runShortcut})`}
            disabled={disabled}
            onClick={() => onRun()}
          >
            <Play />
          </Button>
        )}
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={explainTitle}
          title={explainTitle}
          disabled={disabled || running || !canExplain}
          onClick={() => onExplain()}
        >
          <ChartNoAxesCombined />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t('editor.format')}
          title={t('editor.format')}
          disabled={formatDisabled || running}
          onClick={() => onFormat()}
        >
          <Wand2 />
        </Button>
      </div>
    </div>
  )
}

function ExecutionDataSourcePicker({
  connections,
  groups,
  statuses,
  connectionId,
  disabled,
  onChange,
}: {
  connections: ConnectionConfig[]
  groups: DataSourceGroup[]
  statuses: Record<string, string>
  connectionId: string | null
  disabled: boolean
  onChange: (connectionId: string | null) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const current = connections.find((connection) => connection.id === connectionId) ?? null
  const currentStatus = current ? statuses[current.id] ?? 'disconnected' : 'disconnected'
  const grouped = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    const filtered = connections.filter((connection) => !normalized || [connection.name, connection.driverType, connection.group ?? '']
      .join(' ').toLocaleLowerCase().includes(normalized))
    const entries = groups.map((group) => ({
      id: group.id,
      name: group.name,
      connections: filtered.filter((connection) => connection.groupId === group.id),
    })).filter((group) => group.connections.length > 0)
    const ungrouped = filtered.filter((connection) => !connection.groupId)
    if (ungrouped.length > 0) entries.push({ id: '__ungrouped__', name: t('connection.ungrouped'), connections: ungrouped })
    return entries
  }, [connections, groups, query, t])

  function choose(id: string | null) {
    setOpen(false)
    setQuery('')
    onChange(id)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button type="button" size="sm" variant="outline" disabled={disabled} className="h-8 min-w-44 max-w-64 justify-between gap-2 px-2 text-xs" aria-label={t('connection.select')} />}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <Database className="size-3.5 shrink-0 text-muted-foreground" />
          {current && <span className={['size-1.5 shrink-0 rounded-full', connectionStatusClass(currentStatus)].join(' ')} title={connectionStatusTitle(currentStatus, t)} />}
          <span className="truncate">{current?.name ?? t('connection.select')}</span>
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-1 p-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus className="h-8 pl-7 text-xs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('connection.searchDataSources')} />
        </div>
        <div className="max-h-64 overflow-auto py-1">
          <button type="button" className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-accent" onClick={() => choose(null)}>
            <span className="size-2 rounded-full bg-muted-foreground/40" />
            <span className="flex-1">{t('connection.select')}</span>
            {!connectionId && <Check className="size-3.5" />}
          </button>
          {grouped.map((group) => (
            <section key={group.id} className="pt-1">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{group.name}</div>
              {group.connections.map((connection) => (
                <button key={connection.id} type="button" className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-accent" onClick={() => choose(connection.id)}>
                  <span className={['size-1.5 rounded-full', connectionStatusClass(statuses[connection.id] ?? 'disconnected')].join(' ')} />
                  <span className="min-w-0 flex-1 truncate">{connection.name}</span>
                  <span className="text-[10px] text-muted-foreground">{connection.driverType}</span>
                  {connection.id === connectionId && <Check className="size-3.5" />}
                </button>
              ))}
            </section>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function connectionStatusClass(status: string) {
  if (status === 'connected') return 'bg-emerald-500'
  if (status === 'connecting') return 'bg-amber-500'
  if (status === 'failed') return 'bg-destructive'
  return 'bg-muted-foreground/40'
}

function connectionStatusTitle(status: string, t: ReturnType<typeof useTranslation>['t']) {
  if (status === 'connected') return t('connection.connected')
  if (status === 'connecting') return t('connection.connecting')
  if (status === 'failed') return t('connection.failed')
  return t('connection.disconnected')
}

function isMacPlatform() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
}
