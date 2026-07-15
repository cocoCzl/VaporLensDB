import { ChartNoAxesCombined, Database, MoreHorizontal, Play, Square, Wand2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { IconTooltipButton } from '@/components/common/IconTooltipButton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ConnectionConfig } from '@/types/connection'
import type { DatabaseInfo, SchemaInfo } from '@/types/metadata'

interface EditorToolbarProps {
  connections: ConnectionConfig[]
  connectionStatuses?: Record<string, string>
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
        <select
          className="ide-select min-w-36 max-w-52 shrink-0"
          aria-label={t('connection.select')}
          value={connectionId ?? ''}
          onChange={(event) => onConnectionChange(event.target.value || null)}
        >
          {!connectionId && <option value="">{t('connection.select')}</option>}
          {connections.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.name}
              {connectionStatuses[connection.id] === 'connected' ? '' : ` (${t('connection.disconnected')})`}
            </option>
          ))}
        </select>
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

      {running && canCancel ? (
        <IconTooltipButton label={t('editor.cancel')} variant="destructive" onClick={onCancel}>
          <Square />
        </IconTooltipButton>
      ) : running ? (
        <IconTooltipButton label={t('editor.running')} variant="secondary" disabled>
          <Play />
        </IconTooltipButton>
      ) : (
        <IconTooltipButton
          label={`${t('editor.run')} (${runShortcut})`}
          disabled={disabled}
          onClick={onRun}
        >
          <Play />
        </IconTooltipButton>
      )}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            <DropdownMenuTrigger
              render={
                <Button type="button" size="icon-sm" variant="ghost" aria-label={t('editor.moreActions')}>
                  <MoreHorizontal />
                </Button>
              }
            />
          </TooltipTrigger>
          <TooltipContent>{t('editor.moreActions')}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem disabled={disabled || running || !canExplain} onClick={onExplain}>
            <ChartNoAxesCombined />
            {explainTitle}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={disabled || running} onClick={onFormat}>
            <Wand2 />
            {t('editor.format')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function isMacPlatform() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
}
