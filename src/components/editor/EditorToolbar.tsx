import { ChartNoAxesCombined, Database, Play, Square, Wand2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconTooltipButton } from '@/components/common/IconTooltipButton'
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
  running?: boolean
  canCancel?: boolean
  canExplain?: boolean
  explainUnsupportedReason?: string
  disabled?: boolean
  onConnectionChange: (connectionId: string | null) => void
  onDatabaseChange?: (database: string | null) => void
  onSchemaChange?: (schema: string | null) => void
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
  running = false,
  canCancel = false,
  canExplain = true,
  explainUnsupportedReason,
  disabled = false,
  onConnectionChange,
  onDatabaseChange,
  onSchemaChange,
  onRun,
  onCancel,
  onExplain,
  onFormat,
}: EditorToolbarProps) {
  const { t } = useTranslation()
  const explainTitle = canExplain ? t('editor.explain') : (explainUnsupportedReason ?? t('editor.explainUnsupported'))

  return (
    <div className="flex h-11 items-center gap-2 border-b ide-toolbar px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Database className="size-4 text-muted-foreground" />
        <select
          className="ide-select min-w-44"
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
          className="ide-select min-w-36"
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
          className="ide-select min-w-32"
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
      </div>

      {running && canCancel ? (
        <IconTooltipButton label={t('editor.cancel')} variant="destructive" onClick={onCancel}>
          <Square />
        </IconTooltipButton>
      ) : running ? (
        <IconTooltipButton label={t('editor.running')} disabled>
          <Play />
        </IconTooltipButton>
      ) : (
        <IconTooltipButton label={t('editor.run')} disabled={disabled} onClick={onRun}>
          <Play />
        </IconTooltipButton>
      )}
      <IconTooltipButton
        label={explainTitle}
        variant="outline"
        disabled={disabled || running || !canExplain}
        onClick={onExplain}
      >
        <ChartNoAxesCombined />
      </IconTooltipButton>
      <IconTooltipButton label={t('editor.format')} variant="ghost" disabled={disabled} onClick={onFormat}>
        <Wand2 />
      </IconTooltipButton>
    </div>
  )
}
