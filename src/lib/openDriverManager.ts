import i18n from '@/i18n'
import { useUiStore } from '@/stores/uiStore'
import { useEditorStore } from '@/stores/editorStore'
export function openDriverManager() {
  useUiStore.getState().setSettingsSection('drivers')
  const editor = useEditorStore.getState()
  const tab = editor.tabs.find((tab) => tab.kind === 'settings')
  if (tab) editor.setActiveTab(tab.id)
  else editor.addTab({ id: crypto.randomUUID(), kind: 'settings', title: i18n.t('settings.title'), sql: '', connectionId: null })
}
