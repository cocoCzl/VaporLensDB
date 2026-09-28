import i18n from '@/i18n'
import { normalizeAppError } from '@/ipc/client'
import { rollbackConsoleTransaction, setConsoleTransactionMode } from '@/ipc/query'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore, type EditorTab } from '@/stores/editorStore'
import { useSqlDraftStore } from '@/stores/sqlDraftStore'
import { useUiStore } from '@/stores/uiStore'

const closingTabs = new Map<string, Promise<boolean>>()
const getTab = (id: string) => useEditorStore.getState().tabs.find((tab) => tab.id === id)

function warn(key: 'closeTabBusy' | 'closeTabChanged') {
  useUiStore.getState().notify({ kind: 'warning', title: i18n.t(`workbench.${key}`) })
}

/** Shared by tab buttons, bulk actions and the native menu. False stops a batch. */
export function closeEditorTab(id: string, options?: { confirmTransaction?: boolean }): Promise<boolean> {
  const pending = closingTabs.get(id)
  if (pending) return pending
  // Start on a microtask so the deduplication entry exists before any work.
  const operation = Promise.resolve()
    .then(() => closeTab(id, options))
    .finally(() => closingTabs.delete(id))
  closingTabs.set(id, operation)
  return operation
}

export async function closeEditorTabs(
  ids: string[],
  options?: { confirmTransaction?: boolean },
): Promise<boolean> {
  for (const id of ids) {
    if (!(await closeEditorTab(id, options))) return false
  }
  return true
}

async function closeTab(id: string, options?: { confirmTransaction?: boolean }): Promise<boolean> {
  const initial = getTab(id)
  if (!initial) return true
  if (initial.running || initial.transactionBusy) {
    warn('closeTabBusy')
    return false
  }
  if (options?.confirmTransaction !== false
    && initial.connectionId && initial.transactionMode === 'manual' && initial.transactionPhase !== 'idle'
    && !window.confirm(i18n.t('workbench.closeTabRollbackConfirm'))) return false

  useEditorStore.getState().setTabClosing(id, true)
  let savedClosed = false
  const unchanged = (tab: EditorTab | undefined): tab is EditorTab => Boolean(tab
    && tab.connectionId === initial.connectionId
    && (tab.draftRevision ?? 0) === (initial.draftRevision ?? 0)
    && !tab.running && !tab.transactionBusy)
  try {
    if (initial.connectionId && initial.transactionMode === 'manual') {
      if (initial.transactionPhase !== 'idle') {
        const next = await rollbackConsoleTransaction(initial.connectionId, id)
        if (getTab(id)?.connectionId === initial.connectionId) {
          useEditorStore.getState().setTabTransactionState(id, next.mode, next.phase)
        }
      }
      const next = await setConsoleTransactionMode(initial.connectionId, id, 'auto')
      if (getTab(id)?.connectionId === initial.connectionId) {
        useEditorStore.getState().setTabTransactionState(id, next.mode, next.phase)
      }
    }
    const tab = getTab(id)
    if (!unchanged(tab)) { warn('closeTabChanged'); return false }
    if (!tab.kind || tab.kind === 'sql') {
      const connection = useConnectionStore.getState().connections.find((item) => item.id === tab.connectionId) ?? null
      const result = await useSqlDraftStore.getState().saveTabDraft(tab, {
        connection,
        database: tab.database ?? connection?.database ?? null,
        schema: tab.schema ?? null,
      }, true)
      if (!result) return false // Persistence already reports storage errors.
      savedClosed = result.kind === 'saved'
      if (!unchanged(getTab(id))) { warn('closeTabChanged'); return false }
    }
    useEditorStore.getState().closeTab(id)
    return true
  } catch (error) {
    useUiStore.getState().notifyError(normalizeAppError(error), i18n.t('workbench.closeTabFailed'))
    return false
  } finally {
    useEditorStore.getState().setTabClosing(id, false)
    if (savedClosed && getTab(id)) {
      // Editing during the final save retains the tab. Let autosave also repair
      // the native closed marker, even if only non-SQL state changed.
      useEditorStore.setState((state) => ({ tabs: state.tabs.map((tab) => tab.id === id ? { ...tab, dirty: true } : tab) }))
    }
  }
}
