import type { EditorTab } from '@/stores/editorStore'

export type DisconnectPreflight =
  | { kind: 'idle' }
  | { kind: 'runningQuery'; tabIds: string[] }
  | { kind: 'uncommittedTransaction'; tabIds: string[] }

/**
 * The frontend's advisory disconnect preflight. ConnectionManager remains the
 * final authority because an operation can begin after this snapshot.
 */
export function getDisconnectPreflight(
  tabs: readonly EditorTab[],
  connectionId: string,
): DisconnectPreflight {
  const boundTabs = tabs.filter((tab) => tab.connectionId === connectionId)
  const transactionTabs = boundTabs.filter(
    (tab) => tab.transactionMode === 'manual' && tab.transactionPhase !== 'idle',
  )
  if (transactionTabs.length > 0) {
    return { kind: 'uncommittedTransaction', tabIds: transactionTabs.map((tab) => tab.id) }
  }

  const runningTabs = boundTabs.filter((tab) => Boolean(tab.runningQueryId))
  if (runningTabs.length > 0) {
    return { kind: 'runningQuery', tabIds: runningTabs.map((tab) => tab.id) }
  }

  return { kind: 'idle' }
}
