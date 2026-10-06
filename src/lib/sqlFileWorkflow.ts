import i18n from '@/i18n'
import { chooseSqlFileAction } from './sqlFileChoice'
import { sqlFile } from '@/ipc/sqlFile'
import { useEditorStore } from '@/stores/editorStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useUiStore } from '@/stores/uiStore'
let opening = false
let saving = false
function failure(key = 'readFailed') { useUiStore.getState().notify({ kind: 'error', title: i18n.t(`sqlFile.${key}`) }) }
export async function openSqlFile() {
  if (opening || saving) return
  opening = true
  const editor = useEditorStore.getState()
  const source = editor.tabs.find((tab) => tab.id === editor.activeTabId)
  const connectionId = source && (!source.kind || source.kind === 'sql') ? source.connectionId : useConnectionStore.getState().browsingConnectionId
  try {
    const doc = await sqlFile({ action: 'open' })
    if (!doc) return
    const existing = useEditorStore.getState().tabs.find((tab) => tab.filePath === doc.path)
    if (existing) { useEditorStore.getState().setActiveTab(existing.id); return }
    useEditorStore.getState().addTab({ id: crypto.randomUUID(), kind: 'sql', title: doc.name, sql: doc.text, connectionId, dirty: false,
      filePath: doc.path, fileToken: doc.token, fileSavedText: doc.text, fileFingerprint: doc.fingerprint, fileBom: doc.bom, fileEol: doc.eol })
  } catch (error) { failure(fileError(error, 'readFailed')) } finally { opening = false }
}
export async function saveSqlFile(id = useEditorStore.getState().activeTabId, saveAs = false, closing = false): Promise<boolean> {
  const tab = useEditorStore.getState().tabs.find((item) => item.id === id)
  if (opening || saving || !tab || (tab.kind && tab.kind !== 'sql') || tab.fileBusy || tab.transactionBusy || (tab.closing && !closing)) return false
  saving = true
  patch(tab.id, { fileBusy: true })
  try {
    let token = tab.fileToken
    let fingerprint = tab.fileFingerprint
    if (saveAs || !token) {
      const selected = await sqlFile({ action: 'select', suggested: tab.filePath ?? `${tab.title}.sql` })
      if (!selected) return false
      if (useEditorStore.getState().tabs.some((other) => other.id !== id && other.filePath === selected.path)) {
        failure('alreadyOpen'); return false
      }
      token = selected.token
      // Restored snapshots must still detect external changes after reauthorization.
      fingerprint = selected.path === tab.filePath ? tab.fileFingerprint : selected.fingerprint
    }
    const text = tab.sql.replace(/\r\n/g, '\n')
    let result = await sqlFile({ action: 'write', token, text, fingerprint, bom: tab.fileBom ?? false, eol: tab.fileEol ?? 'lf' })
    while (result?.conflict) {
      const decision = await chooseSqlFileAction('changed', ['reload', 'overwrite', 'cancel'], result.path)
      if (decision === 'cancel') return false
      if (decision === 'reload') {
        const disk = await sqlFile({ action: 'read', token })
        if (!disk) return false
        patch(tab.id, { filePath: disk.path, title: disk.name, sql: disk.text, fileSavedText: disk.text, fileFingerprint: disk.fingerprint, fileBom: disk.bom, fileEol: disk.eol, fileToken: token, dirty: false, draftRevision: (tab.draftRevision ?? 0) + 1 })
        return false // Reload never implicitly closes a tab.
      }
      result = await sqlFile({ action: 'write', token, text, fingerprint: result.fingerprint, bom: tab.fileBom ?? false, eol: tab.fileEol ?? 'lf' })
    }
    if (!result) return false
    patch(tab.id, { filePath: result.path, title: result.name, fileToken: token, fileSavedText: text, fileFingerprint: result.fingerprint, fileBom: result.bom, fileEol: result.eol, dirty: false })
    return true
  } catch (error) { failure(fileError(error, 'saveFailed')); return false } finally { saving = false; patch(tab.id, { fileBusy: false }) }
}
function patch(id: string, values: Partial<import('@/stores/editorStore').EditorTab>) {
  useEditorStore.setState((state) => ({ tabs: state.tabs.map((tab) => tab.id === id ? { ...tab, ...values } : tab) }))
}
export function runSqlFileAction(action: 'open' | 'save' | 'saveAs') {
  if (action === 'open') return openSqlFile()
  return saveSqlFile(undefined, action === 'saveAs')
}

function fileError(error: unknown, fallback: string) {
  const message = typeof error === 'object' && error && 'message' in error ? String(error.message) : ''
  return ['encoding', 'extension', 'tooLarge', 'missing', 'changedDuringSave'].includes(message) ? message : fallback
}
