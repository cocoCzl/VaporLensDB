import { useTranslation } from 'react-i18next'
import { useEditorStore } from '@/stores/editorStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { executionDatabase } from '@/lib/executionContext'
import { connectionSqlDialect } from '@/lib/databaseDialect'

/** Uses the tab's execution context, never the Explorer metadata path. */
export function ExecutionContextBar() {
  const { t } = useTranslation()
  const tabs = useEditorStore((state) => state.tabs)
  const activeTabId = useEditorStore((state) => state.activeTabId)
  const connections = useConnectionStore((state) => state.connections)
  const capabilities = useConnectionStore(state => state.capabilities)
  const statuses = useConnectionStore((state) => state.statuses)
  const browsingId = useConnectionStore((state) => state.browsingConnectionId)
  const tab = tabs.find((item) => item.id === activeTabId)
  if (!tab || (tab.kind && tab.kind !== 'sql')) return null
  const execution = connections.find((item) => item.id === tab.connectionId)
  const browsing = connections.find((item) => item.id === browsingId)
  const disconnected = !execution || statuses[execution.id]?.status !== 'connected'
  const browsingDiffers = browsing && browsingId !== tab.connectionId
  const hasDetails = disconnected || tab.transactionMode === 'manual' || tab.transactionBusy || browsingDiffers
  const database = executionDatabase(execution, tab.database)
  const hasSchema = execution && (capabilities[execution.id]?.hasSchema ?? connectionSqlDialect(execution) !== 'mysql')
  const phase = tab.transactionMode === 'manual' ? tab.transactionPhase ?? 'idle' : 'auto'
  return (
    <div aria-label={t('executionContext.title')} className={hasDetails ? "flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/20 px-3 py-1 text-xs" : "sr-only"}>
      <span className="sr-only">{t('executionContext.execution')}: {execution?.name ?? tab.unavailableConnectionName ?? t('executionContext.none')}{database ? ` · ${t('metadata.database')}: ${database}` : ''}{hasSchema && tab.schema ? ` · ${t('metadata.schema')}: ${tab.schema}` : ''}</span>
      {disconnected && <span className="text-muted-foreground">{t(execution ? 'executionContext.connectOnRun' : tab.unavailableConnectionName ? 'executionContext.unavailable' : 'executionContext.selectToRun', { name: tab.unavailableConnectionName })}</span>}
      {tab.transactionMode === 'manual' && <span className={phase === 'failed' ? 'font-medium text-destructive' : phase === 'active' ? 'font-medium text-warning' : 'text-muted-foreground'}>{t(`executionContext.${phase}`)}</span>}
      {tab.transactionBusy && <span role="status">{t('executionContext.switchPending')}</span>}
      {browsingDiffers && <span className="break-all text-muted-foreground">{t('executionContext.browsing')}: {browsing?.name ?? t('executionContext.none')}</span>}
    </div>
  )
}
