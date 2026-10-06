import { useTranslation } from 'react-i18next'
import { useEditorStore } from '@/stores/editorStore'
import { useConnectionStore } from '@/stores/connectionStore'

/** Uses the tab's execution context, never the Explorer metadata path. */
export function ExecutionContextBar() {
  const { t } = useTranslation()
  const tabs = useEditorStore((state) => state.tabs)
  const activeTabId = useEditorStore((state) => state.activeTabId)
  const connections = useConnectionStore((state) => state.connections)
  const statuses = useConnectionStore((state) => state.statuses)
  const browsingId = useConnectionStore((state) => state.browsingConnectionId)
  const tab = tabs.find((item) => item.id === activeTabId)
  if (!tab || (tab.kind && tab.kind !== 'sql')) return null
  const execution = connections.find((item) => item.id === tab.connectionId)
  const browsing = connections.find((item) => item.id === browsingId)
  const phase = tab.transactionMode === 'manual' ? tab.transactionPhase ?? 'idle' : 'auto'
  return (
    <div aria-label={t('executionContext.title')} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-muted/20 px-3 py-1 text-xs">
      <span className="break-all font-medium">{t('executionContext.execution')}: {execution?.name ?? tab.unavailableConnectionName ?? t('executionContext.none')}</span>
      <span>{t('metadata.database')}: {tab.database ?? execution?.database ?? t('executionContext.none')}</span>
      <span>{t('metadata.schema')}: {tab.schema ?? t('executionContext.defaultSchema')}</span>
      {(!execution || statuses[execution.id]?.status !== 'connected') && <span className="text-warning">{t('connection.disconnected')}</span>}
      <span className={phase === 'failed' ? 'font-medium text-destructive' : phase === 'active' ? 'font-medium text-warning' : 'text-muted-foreground'}>{t(`executionContext.${phase}`)}</span>
      {tab.transactionBusy && <span role="status">{t('executionContext.switchPending')}</span>}
      {browsingId !== tab.connectionId && <span className="break-all text-muted-foreground">{t('executionContext.browsing')}: {browsing?.name ?? t('executionContext.none')}</span>}
    </div>
  )
}
