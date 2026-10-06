import i18n from '@/i18n'
import { shutdownApplication } from '@/ipc/lifecycle'
import { closeEditorTabs } from '@/lib/closeEditorTab'
import { useEditorStore } from '@/stores/editorStore'
import { useUiStore } from '@/stores/uiStore'
import { normalizeAppError } from '@/ipc/client'

let closing: Promise<boolean> | null = null

export function requestApplicationClose(): Promise<boolean> {
  if (closing) return closing
  closing = closeApplication().finally(() => { closing = null })
  return closing
}

async function closeApplication(): Promise<boolean> {
  const tabs = useEditorStore.getState().tabs
  const dirtyCount = tabs.filter((tab) => (!tab.kind || tab.kind === 'sql') && tab.dirty).length
  const fileCount = tabs.filter((tab) => tab.filePath && tab.dirty).length
  const transactionCount = tabs.filter((tab) => tab.connectionId
    && tab.transactionMode === 'manual'
    && tab.transactionPhase !== 'idle').length

  if ((dirtyCount > 0 || transactionCount > 0) && !window.confirm(i18n.t('workbench.closeApplicationConfirm', {
    dirtyCount,
    transactionCount,
  }) + (fileCount ? `\n${i18n.t('sqlFile.quit', { count: fileCount })}` : ''))) return false

  const closed = await closeEditorTabs(tabs.map((tab) => tab.id), { confirmTransaction: false })
  if (!closed) return false

  try {
    await shutdownApplication()
    return true
  } catch (error) {
    useUiStore.getState().notifyError(normalizeAppError(error), i18n.t('workbench.closeApplicationFailed'))
    return false
  }
}
