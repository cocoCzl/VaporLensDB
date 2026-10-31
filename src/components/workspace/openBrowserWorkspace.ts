import { useEditorStore, type BrowserContext } from '@/stores/editorStore'

/** Reuse one browser tab while leaving SQL tabs and their execution state intact. */
export function openBrowserWorkspace(connectionId: string, title: string, context: BrowserContext = { kind: 'connection' }) {
  const editor = useEditorStore.getState()
  const existing = editor.tabs.find(tab => tab.kind === 'browser')
  if (existing) {
    useEditorStore.setState(state => ({
      tabs: state.tabs.map(tab => tab.id === existing.id ? { ...tab, connectionId, title, browserContext: context } : tab),
      activeTabId: existing.id,
    }))
  } else {
    editor.addTab({ id: crypto.randomUUID(), kind: 'browser', connectionId, title, sql: '', browserContext: context })
  }
}
