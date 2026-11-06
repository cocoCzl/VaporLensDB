import { flushSync } from 'react-dom'
import { useEditorStore, type EditorTab } from '@/stores/editorStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { traceEditorPhase } from '@/lib/startupDiagnostics'

/** Snapshot the committed execution target at the command, independently of
 * Explorer. An explicitly unbound SQL tab must stay unbound in its new tab.
 * Only the target is inherited, never SQL, results or transaction state.
 */
export function createNewSqlTab(): EditorTab {
  const editor = useEditorStore.getState()
  const connections = useConnectionStore.getState()
  const active = editor.tabs.find(tab => tab.id === editor.activeTabId)
  const sqlTab = active && (active.kind === 'sql' || !active.kind) ? active : undefined
  const connectionId = sqlTab ? sqlTab.connectionId : connections.browsingConnectionId
  const connection = connections.connections.find(item => item.id === connectionId)
  return { id: crypto.randomUUID(), kind: 'sql',
    title: connection ? `SQL · ${connection.name}` : 'SQL', sql: '', connectionId,
    database: sqlTab?.database ?? null, schema: sqlTab?.schema ?? null }
}

/** Both native menu clicks and the in-page accelerator use the same commit. */
export function openNewSqlTab(source: 1 | 2) {
  if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return
  const editor = useEditorStore.getState()
  const tab = createNewSqlTab()
  traceEditorPhase(0, 1, { source, tabs: editor.tabs.length })
  // A native menu round trip can arrive after the next ordinary keydown.
  // When the shortcut reaches the page, commit its editable target in that
  // same event. No ordinary keys are buffered, intercepted or replayed.
  flushSync(() => editor.addTab(tab))
  traceEditorPhase(0, 2, { source, tabs: useEditorStore.getState().tabs.length })
}

export function installNewSqlShortcut(target: Window = window) {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform)
  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.key.toLowerCase() !== 'n' || event.altKey || event.shiftKey ||
      (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey)) return
    // Suppress the native accelerator too: otherwise the same physical command
    // could create a second Tab after this synchronous one. Held shortcuts and
    // modal/IME input must not create workspaces or move their focus.
    event.preventDefault()
    if (event.repeat || event.isComposing) return
    openNewSqlTab(2)
  }
  target.addEventListener('keydown', keydown, true)
  return () => target.removeEventListener('keydown', keydown, true)
}
