import { useEditorStore } from '@/stores/editorStore'
import type { ConsoleTransactionState } from '@/types/query'

/** Reserve the tab synchronously before IPC so close/query cannot race controls. */
export async function runTabTransaction(
  tabId: string,
  operation: () => Promise<ConsoleTransactionState>,
): Promise<void> {
  const editor = useEditorStore.getState()
  const tab = editor.tabs.find((item) => item.id === tabId)
  if (!tab || tab.closing || tab.running || tab.transactionBusy) return
  editor.setTabTransactionBusy(tabId, true)
  try {
    const next = await operation()
    const current = useEditorStore.getState().tabs.find((item) => item.id === tabId)
    if (current?.connectionId === tab.connectionId) {
      useEditorStore.getState().setTabTransactionState(tabId, next.mode, next.phase)
    }
  } finally {
    useEditorStore.getState().setTabTransactionBusy(tabId, false)
  }
}
