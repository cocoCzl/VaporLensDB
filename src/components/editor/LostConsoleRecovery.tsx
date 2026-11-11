import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { recoverLostConsoleSession } from '@/ipc/query'
import { normalizeAppError } from '@/ipc/client'
import { useEditorStore, type EditorTab } from '@/stores/editorStore'
import { useUiStore } from '@/stores/uiStore'

/** Ends one invalid console, never resolves the old transaction or replays SQL. */
export function LostConsoleRecovery({ tab }: { tab: EditorTab }) {
  const { t } = useTranslation()
  const [confirmation, setConfirmation] = useState<Pick<EditorTab, 'id' | 'connectionId' | 'database' | 'schema'> | null>(null)
  if (tab.transactionMode !== 'manual' || tab.transactionPhase !== 'lost') return null
  const recover = async () => {
    const current = useEditorStore.getState().tabs.find(item => item.id === tab.id)
    if (!current?.connectionId || current.running || current.closing || current.transactionBusy) return
    if (!confirmation || current.id !== confirmation.id || current.connectionId !== confirmation.connectionId || current.database !== confirmation.database || current.schema !== confirmation.schema) {
      setConfirmation(null)
      return
    }
    useEditorStore.getState().setTabTransactionBusy(tab.id, true)
    try {
      const next = await recoverLostConsoleSession({ connectionId: current.connectionId, consoleId: tab.id, newConsoleId: crypto.randomUUID(), database: current.database ?? null, schema: current.schema ?? null })
      useEditorStore.setState(state => ({
        activeTabId: state.activeTabId === tab.id ? next.consoleId : state.activeTabId,
        tabs: state.tabs.map(item => item.id === tab.id ? { ...item, id: next.consoleId, transactionMode: next.mode, transactionPhase: next.phase, transactionBusy: false } : item),
      }))
    } catch (error) {
      useUiStore.getState().notifyError(normalizeAppError(error), t('executionContext.recoverFailed'))
    } finally {
      useEditorStore.getState().setTabTransactionBusy(tab.id, false)
    }
  }
  return <div role="alert" className="border-b border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
    <p>{t('executionContext.lost')}</p>
    {confirmation ? <div role="alertdialog" aria-label={t('executionContext.recover')} className="mt-2 rounded border p-2">
      <p>{t('executionContext.recoverConfirm', { target: [confirmation.connectionId, confirmation.database ?? t('executionContext.unsetTarget'), confirmation.schema].filter(Boolean).join(' · ') })}</p>
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={tab.transactionBusy} onClick={() => setConfirmation(null)}>{t('common.cancel')}</button>
        <button type="button" disabled={tab.transactionBusy} onClick={() => void recover()}>{t('common.confirm')}</button>
      </div>
    </div> : <button type="button" className="mt-2 rounded border px-2 py-1 hover:bg-accent disabled:opacity-50" disabled={tab.running || tab.closing || tab.transactionBusy} onClick={() => setConfirmation({ id: tab.id, connectionId: tab.connectionId, database: tab.database, schema: tab.schema })}>{t('executionContext.recover')}</button>}
  </div>
}
