import i18n from '@/i18n'
import { useEditorStore } from '@/stores/editorStore'
import { useUiStore } from '@/stores/uiStore'

export const NEW_CONNECTION_EVENT = 'vaporlensdb:new-connection'

/** Global and explorer entry points share the existing connection workflow. */
export function requestNewConnection() {
  window.dispatchEvent(new Event(NEW_CONNECTION_EVENT))
}

const workspaceTitles = {
  drivers: 'topBar.drivers',
  settings: 'settings.title',
  dataSources: 'connection.dataSources',
  queryHistory: 'sql.history',
  sqlScripts: 'sql.drafts',
} as const

export function openWorkspaceTab(kind: keyof typeof workspaceTitles) {
  const editor = useEditorStore.getState()
  const existing = editor.tabs.find(tab => tab.kind === kind)
  if (existing) editor.setActiveTab(existing.id)
  else editor.addTab({ id: crypto.randomUUID(), kind, title: i18n.t(workspaceTitles[kind]), sql: '', connectionId: null })
}

export function openSettingsSection(section: 'general' | 'import' | 'diagnostics') {
  useUiStore.getState().setSettingsSection(section)
  openWorkspaceTab('settings')
}
