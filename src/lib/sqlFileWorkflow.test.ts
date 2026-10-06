import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore, persistSqlWorkspace, readStoredSqlWorkspace } from '@/stores/editorStore'
import { useSqlFileChoice } from './sqlFileChoice'
import { useUiStore } from '@/stores/uiStore'
import { persistDirtySqlDrafts } from './sqlDraftPersistence'
import { useConnectionStore } from '@/stores/connectionStore'
import { openSqlFile, saveSqlFile } from './sqlFileWorkflow'
const native = vi.hoisted(() => vi.fn())
vi.mock('@/ipc/sqlFile', () => ({ sqlFile: native }))
const doc = { token: 'grant', path: '/selected/query.sql', name: 'query.sql', text: 'SELECT 1;\n', fingerprint: 'one', bom: false, eol: 'lf', conflict: false }
beforeEach(() => { vi.clearAllMocks(); native.mockReset(); useEditorStore.setState({ tabs: [{ id: 'A', title: 'SQL', sql: '', connectionId: 'execution-A' }], activeTabId: 'A' }); useConnectionStore.setState({ browsingConnectionId: 'B' }) })
describe('SQL file workflow', () => {
  it('opens a selected file clean on the existing execution source, and focuses the same path without replacing edits', async () => {
    native.mockResolvedValue(doc)
    await openSqlFile()
    const tab = useEditorStore.getState().tabs[1]
    expect(tab).toMatchObject({ title: 'query.sql', sql: doc.text, dirty: false, filePath: doc.path, connectionId: 'execution-A' })
    useEditorStore.getState().updateTabSql(tab.id, 'unsaved')
    await openSqlFile()
    expect(useEditorStore.getState().tabs).toHaveLength(2)
    expect(useEditorStore.getState().tabs[1].sql).toBe('unsaved')
  })
  it('keeps disk dirty through autosave and context edits, clears only after an explicit successful write, and preserves results', async () => {
    native.mockResolvedValue(doc)
    await openSqlFile()
    const id = useEditorStore.getState().activeTabId!
    useEditorStore.getState().updateTabSql(id, 'SELECT 2;')
    useEditorStore.getState().setTabDraft(id, 'draft', 1)
    expect(useEditorStore.getState().tabs[1].dirty).toBe(true)
    native.mockResolvedValue({ ...doc, text: 'SELECT 2;', fingerprint: 'two' })
    useEditorStore.setState((s) => ({ tabs: s.tabs.map(t => t.id === id ? { ...t, lastQueryId: 'result' } : t) }))
    expect(await saveSqlFile(id)).toBe(true)
    expect(native).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'write', text: 'SELECT 2;' }))
    expect(useEditorStore.getState().tabs[1]).toMatchObject({ dirty: false, lastQueryId: 'result' })
    useEditorStore.getState().updateSqlTabContext(id, { schema: 'other' })
    expect(useEditorStore.getState().tabs[1].dirty).toBe(false)
    useEditorStore.getState().updateTabSql(id, 'SELECT 3;')
    useEditorStore.getState().updateTabSql(id, 'SELECT 2;')
    expect(useEditorStore.getState().tabs[1].dirty).toBe(false)
  })
  it('restores the unsaved snapshot and file identity without reading or writing disk', async () => {
    native.mockResolvedValue(doc); await openSqlFile()
    const id = useEditorStore.getState().activeTabId!
    useEditorStore.getState().updateTabSql(id, 'recovered SQL')
    const { tabs, activeTabId } = useEditorStore.getState()
    persistSqlWorkspace(tabs, activeTabId)
    native.mockClear()
    expect(readStoredSqlWorkspace().tabs[1]).toMatchObject({ filePath: doc.path, sql: 'recovered SQL', dirty: true, fileSavedText: doc.text })
    expect(readStoredSqlWorkspace().tabs[1].fileToken).toBeUndefined()
    expect(native).not.toHaveBeenCalled()
  })

  it('untitled Save selects a destination, then writes; Save As adopts only a successfully written new path', async () => {
    native.mockResolvedValueOnce(doc).mockResolvedValueOnce(doc)
    expect(await saveSqlFile('A')).toBe(true)
    expect(native.mock.calls.map(call => call[0].action)).toEqual(['select', 'write'])
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ filePath: doc.path, dirty: false })
    native.mockReset()
    const other = { ...doc, path: '/selected/other.sql', name: 'other.sql', token: 'other' }
    native.mockResolvedValueOnce(other).mockResolvedValueOnce(other)
    expect(await saveSqlFile('A', true)).toBe(true)
    expect(native.mock.calls[1][0].token).toBe('other')
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ filePath: other.path, title: other.name })
  })
  it.each(['cancel', 'failure'])('Save As %s preserves identity, content and dirty state', async (outcome) => {
    native.mockResolvedValue(doc); await openSqlFile()
    const id = useEditorStore.getState().activeTabId!
    useEditorStore.getState().updateTabSql(id, 'unsaved')
    const before = { ...useEditorStore.getState().tabs[1] }
    native.mockReset()
    if (outcome === 'cancel') native.mockResolvedValue(null)
    else native.mockResolvedValueOnce({ ...doc, token: 'other', path: '/selected/other.sql' }).mockRejectedValueOnce(new Error('private SQL'))
    expect(await saveSqlFile(id, true)).toBe(false)
    expect(useEditorStore.getState().tabs[1]).toMatchObject(before)
  })
  it('reports read/encoding failure once without creating a broken tab or leaking SQL', async () => {
    const notify = vi.spyOn(useUiStore.getState(), 'notify')
    native.mockRejectedValue({ message: 'encoding' })
    await openSqlFile()
    expect(useEditorStore.getState().tabs).toHaveLength(1)
    expect(notify).toHaveBeenCalledTimes(1)
    notify.mockRestore()
  })
  it('does not send file-backed tabs to internal draft autosave', async () => {
    native.mockResolvedValue(doc); await openSqlFile()
    useEditorStore.getState().updateTabSql(useEditorStore.getState().activeTabId!, 'dirty')
    native.mockClear()
    const save = vi.fn()
    await persistDirtySqlDrafts({ tabs: useEditorStore.getState().tabs, connections: [], saveTabDraft: save, completeTabPersistence: vi.fn() })
    expect(save).not.toHaveBeenCalled(); expect(native).not.toHaveBeenCalled()
  })
  it.each(['cancel', 'overwrite', 'reload'])('external disk conflict: %s is explicit', async (decision) => {
    native.mockResolvedValue(doc); await openSqlFile()
    const id = useEditorStore.getState().activeTabId!
    useEditorStore.getState().updateTabSql(id, 'local')
    native.mockReset()
    native.mockResolvedValueOnce({ ...doc, conflict: true, fingerprint: 'external' }).mockResolvedValueOnce({ ...doc, text: 'disk', fingerprint: 'latest' })
    const saving = saveSqlFile(id)
    await vi.waitFor(() => expect(useSqlFileChoice.getState().pending).not.toBeNull())
    expect(useEditorStore.getState().tabs[1]).toMatchObject({ sql: 'local', dirty: true })
    useSqlFileChoice.getState().pending!.resolve(decision)
    expect(await saving).toBe(decision === 'overwrite')
    if (decision === 'cancel') expect(native).toHaveBeenCalledTimes(1)
    if (decision === 'overwrite') expect(native).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'write', fingerprint: 'external', text: 'local' }))
    if (decision === 'reload') expect(useEditorStore.getState().tabs[1]).toMatchObject({ sql: 'disk', dirty: false })
  })
  it('blocks duplicate saves and close while a write is pending', async () => {
    native.mockResolvedValue(doc); await openSqlFile()
    const id = useEditorStore.getState().activeTabId!
    let finish!: (value: typeof doc) => void
    native.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const first = saveSqlFile(id)
    expect(await saveSqlFile(id)).toBe(false)
    const { closeEditorTab } = await import('./closeEditorTab')
    expect(await closeEditorTab(id)).toBe(false)
    finish(doc); expect(await first).toBe(true)
  })
  it('refuses Save As onto another open file before writing', async () => {
    native.mockResolvedValue(doc); await openSqlFile()
    native.mockClear()
    expect(await saveSqlFile('A', true)).toBe(false)
    expect(native).toHaveBeenCalledTimes(1)
    expect(native.mock.calls[0][0].action).toBe('select')
  })

  it('normal Save failure keeps unsaved content/path and emits one safe notification', async () => {
    native.mockResolvedValue(doc); await openSqlFile()
    const id = useEditorStore.getState().activeTabId!
    useEditorStore.getState().updateTabSql(id, 'private SQL')
    const notify = vi.spyOn(useUiStore.getState(), 'notify')
    native.mockRejectedValue(new Error('private SQL'))
    expect(await saveSqlFile(id)).toBe(false)
    expect(useEditorStore.getState().tabs[1]).toMatchObject({ sql: 'private SQL', filePath: doc.path, dirty: true, fileBusy: false })
    expect(notify).toHaveBeenCalledOnce()
    expect(JSON.stringify(notify.mock.calls)).not.toContain('private SQL')
    notify.mockRestore()
  })
  it('restored file reauthorizes through a dialog and checks its original disk fingerprint', async () => {
    useEditorStore.setState({ tabs: [{ id: 'restored', title: doc.name, sql: 'recovered', connectionId: null, filePath: doc.path, fileSavedText: 'original', fileFingerprint: 'original', dirty: true }], activeTabId: 'restored' })
    native.mockResolvedValueOnce({ ...doc, fingerprint: 'external' }).mockResolvedValueOnce({ ...doc, conflict: true, fingerprint: 'external' })
    const saving = saveSqlFile('restored')
    await vi.waitFor(() => expect(useSqlFileChoice.getState().pending).not.toBeNull())
    expect(native.mock.calls[0][0]).toMatchObject({ action: 'select', suggested: doc.path })
    expect(native.mock.calls[1][0]).toMatchObject({ action: 'write', fingerprint: 'original', text: 'recovered' })
    useSqlFileChoice.getState().pending!.resolve('cancel')
    expect(await saving).toBe(false)
    expect(useEditorStore.getState().tabs[0].sql).toBe('recovered')
  })
  it('cancelled Open does nothing, and an unbound SQL tab does not inherit browsing B', async () => {
    native.mockResolvedValueOnce(null)
    await openSqlFile()
    expect(useEditorStore.getState().tabs).toHaveLength(1)
    useEditorStore.setState({ tabs: [{ id: 'unbound', title: 'SQL', sql: '', connectionId: null }], activeTabId: 'unbound' })
    native.mockResolvedValue(doc); await openSqlFile()
    expect(useEditorStore.getState().tabs[1].connectionId).toBeNull()
  })

})
