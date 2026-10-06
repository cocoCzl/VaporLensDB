import { commitConsoleTransaction, getConsoleTransactionState, rollbackConsoleTransaction, setConsoleTransactionMode } from '@/ipc/query'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import type { ConsoleTransactionState } from '@/types/query'

export type SwitchDecision = 'commit' | 'rollback'
export type SwitchOutcome = 'confirm' | 'switched'

/** One tab reservation, shared with query/close/transaction controls. No global queue. */
export function beginExecutionTargetSwitch(tabId: string, targetId: string | null) {
  const initial = useEditorStore.getState().tabs.find((tab) => tab.id === tabId)
  if (!initial || initial.connectionId === targetId || initial.running || initial.closing || initial.transactionBusy) return null
  const sourceId = initial.connectionId
  let busy = false
  let finished = false
  useEditorStore.getState().setTabTransactionBusy(tabId, true)

  function current() {
    const tab = useEditorStore.getState().tabs.find((item) => item.id === tabId)
    if (!tab || tab.connectionId !== sourceId || !tab.transactionBusy || tab.running || tab.closing) {
      throw new Error('Execution context changed')
    }
    return tab
  }

  function accept(state: ConsoleTransactionState, connectionId: string) {
    current()
    if (state.connectionId !== connectionId || state.consoleId !== tabId) throw new Error('Unexpected console state')
    if (connectionId === sourceId) useEditorStore.getState().setTabTransactionState(tabId, state.mode, state.phase)
    return state
  }

  async function refreshSource() {
    if (!sourceId) return null
    return accept(await getConsoleTransactionState(sourceId, tabId), sourceId)
  }

  function cancel() {
    if (busy || finished) return false
    finished = true
    useEditorStore.getState().setTabTransactionBusy(tabId, false)
    return true
  }

  async function advance(decision?: SwitchDecision): Promise<SwitchOutcome> {
    if (busy || finished) throw new Error('Switch already in progress')
    busy = true
    try {
      current()
      let transaction = await refreshSource()
      if (transaction?.mode === 'manual' && transaction.phase !== 'idle') {
        if (!decision || (decision === 'commit' && transaction.phase === 'failed')) return 'confirm'
        transaction = accept(await (decision === 'commit'
          ? commitConsoleTransaction(sourceId!, tabId)
          : rollbackConsoleTransaction(sourceId!, tabId)), sourceId!)
        if (transaction.phase !== 'idle') throw new Error('Transaction is unresolved')
      }
      if (transaction?.mode === 'manual') {
        const released = accept(await setConsoleTransactionMode(sourceId!, tabId, 'auto'), sourceId!)
        if (released.mode !== 'auto' || released.phase !== 'idle') throw new Error('Console was not released')
      }
      current()
      let targetTransaction: ConsoleTransactionState | null = null
      if (targetId) {
        if (!useConnectionStore.getState().connections.some((item) => item.id === targetId)) throw new Error('Target unavailable')
        await useConnectionStore.getState().connectConnection(targetId, { selectForBrowsing: false })
        current()
        targetTransaction = accept(await getConsoleTransactionState(targetId, tabId), targetId)
      }
      const target = useConnectionStore.getState().connections.find((item) => item.id === targetId)
      if (targetId && !target) throw new Error('Target unavailable')
      current()
      // No await between releasing the reservation and adopting the target.
      // SQL and lastQueryId (including its provenance snapshot) are preserved.
      useEditorStore.getState().setTabTransactionBusy(tabId, false)
      useEditorStore.getState().updateTabConnection(tabId, targetId, { database: target?.database ?? null, schema: null })
      if (targetTransaction) useEditorStore.getState().setTabTransactionState(tabId, targetTransaction.mode, targetTransaction.phase)
      finished = true
      return 'switched'
    } catch (error) {
      // A rejected operation never implies Failed or Idle. Ask the backend;
      // if unavailable, retain the last confirmed state and allow a retry.
      await refreshSource().catch(() => {})
      throw error
    } finally {
      busy = false
    }
  }

  return { tabId, sourceId, targetId, advance, cancel }
}
export type ExecutionTargetSwitch = NonNullable<ReturnType<typeof beginExecutionTargetSwitch>>
