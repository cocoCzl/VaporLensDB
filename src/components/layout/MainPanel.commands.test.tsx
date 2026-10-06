import { WorkspaceCommandPalette } from '@/components/common/WorkspaceCommandPalette'
import { dispatchSqlCommand, useSqlCommandState } from '@/lib/sqlCommands'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MainPanel } from './MainPanel'
import { useEditorStore } from '@/stores/editorStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useMetadataStore } from '@/stores/metadataStore'
import { useSqlDraftStore } from '@/stores/sqlDraftStore'
import { useQueryHistoryStore } from '@/stores/queryHistoryStore'
import { useQueryResultStore } from '@/stores/queryResultStore'
import i18n from '@/i18n'
import type { QueryStreamDone } from '@/types/query'

const ipc = vi.hoisted(() => ({ execute: vi.fn(), state: vi.fn(), mode: vi.fn(), rollback: vi.fn(), connect: vi.fn(), file: vi.fn(), done: null as ((event: QueryStreamDone) => void) | null }))
vi.mock('@/ipc/sqlFile', () => ({ sqlFile: ipc.file }))
vi.mock('@/ipc/query', async (original) => ({
  ...await original<typeof import('@/ipc/query')>(),
  analyzeSqlRisk: async () => ({ dangerous: false, reasons: [], status: 'safe' }),
  executeQuery: ipc.execute, executeQueryStream: ipc.execute, getConsoleTransactionState: ipc.state,
  onQueryResultDone: async (handler: (event: QueryStreamDone) => void) => { ipc.done = handler; return () => {} },
  onQueryResultChunk: async () => () => {}, onQueryResultError: async () => () => {},
  setConsoleTransactionMode: ipc.mode, rollbackConsoleTransaction: ipc.rollback,
}))
vi.mock('@/components/editor/SqlEditor', () => ({ SqlEditor: (props: {
  value: string; onRun: () => void; onScopeChange: (cursor: { start: number; end: number; cursor: number }) => void
}) => <textarea aria-label="SQL fixture editor" value={props.value} readOnly
  onSelect={(event) => { const el = event.currentTarget; props.onScopeChange({ start: el.selectionStart, end: el.selectionEnd, cursor: el.selectionEnd }) }}
  onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') props.onRun() }} /> }))

const current = () => useEditorStore.getState().tabs[0]
beforeEach(async () => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  await i18n.changeLanguage('en')
  vi.resetAllMocks()
  useEditorStore.setState({ activeTabId: 'tab', tabs: [{ id: 'tab', kind: 'sql', title: 'SQL A', sql: 'UPDATE fixture SET value = 2 WHERE id = 1', connectionId: 'A', database: 'db-A', schema: 'schema-A', transactionMode: 'manual', transactionPhase: 'idle' }] })
  useConnectionStore.setState({ connections: ['A', 'B'].map((id) => ({ id, name: `Connection ${id}`, driverType: 'postgres', database: `db-${id}`, hasSavedPassword: false })), activeConnectionId: 'A', browsingConnectionId: 'A', statuses: { A: { connectionId: 'A', status: 'connected' } }, connectConnection: ipc.connect })
  useQueryResultStore.setState({ results: {}, explains: {}, sources: {} })
  vi.spyOn(useSqlDraftStore.getState(), 'loadDrafts').mockResolvedValue(undefined)
  vi.spyOn(useSqlDraftStore.getState(), 'saveTabDraft').mockResolvedValue({ kind: 'cleared' })
  vi.spyOn(useQueryHistoryStore.getState(), 'loadHistory').mockResolvedValue(undefined)
  vi.spyOn(useQueryHistoryStore.getState(), 'addEntry').mockResolvedValue(undefined)
  for (const key of ['loadDatabases', 'loadSchemas', 'loadTables', 'loadViews', 'loadFunctions'] as const) vi.spyOn(useMetadataStore.getState(), key).mockResolvedValue([])
  ipc.state.mockImplementation(async (connectionId, consoleId) => ({ connectionId, consoleId, mode: connectionId === 'A' ? 'manual' : 'auto', phase: connectionId === 'A' ? 'active' : 'idle' }))
  ipc.execute.mockImplementation(async ({ queryId }) => {
    ipc.done?.({ queryId, affectedRows: 1, rowCount: 0, elapsedMs: 2, truncated: false, receivedBytes: 0 })
    return { connectionGeneration: 1, results: [] }
  })
  ipc.rollback.mockResolvedValue({ connectionId: 'A', consoleId: 'tab', mode: 'manual', phase: 'idle' })
  ipc.mode.mockResolvedValue({ connectionId: 'A', consoleId: 'tab', mode: 'auto', phase: 'idle' })
  ipc.connect.mockResolvedValue(undefined)
})


afterEach(() => { vi.unstubAllGlobals(); Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView') })

async function editorAt(start: number, end = start) {
  const placeholder = screen.getByRole('textbox')
  fireEvent.focus(placeholder)
  const editor = await screen.findByLabelText('SQL fixture editor') as HTMLTextAreaElement
  editor.setSelectionRange(start, end)
  fireEvent.select(editor)
  return editor
}
function seedScript() {
  useEditorStore.setState({ tabs: [{ ...current(), sql: 'SELECT 1;\nSELECT 2;', filePath: '/selected/query.sql', fileSavedText: '', dirty: true, transactionPhase: 'active' }] })
  useConnectionStore.getState().setActiveConnection('B')
}
describe('SQL command entry consistency', () => {
  it.each(['toolbar', 'keyboard', 'palette'] as const)('%s runs selection only and preserves file/transaction/provenance', async (entry) => {
    seedScript()
    render(<><MainPanel /><WorkspaceCommandPalette /></>)
    const editor = await editorAt(10, 18)
    if (entry === 'toolbar') fireEvent.click(screen.getByRole('button', { name: 'Run Selection' }))
    if (entry === 'keyboard') fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })
    if (entry === 'palette') {
      fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
      fireEvent.click(await screen.findByRole('option', { name: /Run Selection/ }))
    }
    await waitFor(() => expect(ipc.execute).toHaveBeenCalledOnce())
    expect(ipc.execute.mock.calls[0][0]).toMatchObject({ sql: 'SELECT 2', connectionId: 'A', consoleId: 'tab', database: 'db-A', schema: 'schema-A' })
    await waitFor(() => expect(current().running).toBe(false))
    expect(ipc.file).not.toHaveBeenCalled()
    expect(current()).toMatchObject({ dirty: true, filePath: '/selected/query.sql', transactionMode: 'manual', transactionPhase: 'active' })
    expect(useQueryResultStore.getState().sources[current().lastQueryId!]).toMatchObject({ sql: 'SELECT 2', connectionId: 'A' })
  })
  it.each(['toolbar', 'keyboard', 'palette'] as const)('%s runs the cursor statement, not the whole script', async (entry) => {
    seedScript(); render(<><MainPanel /><WorkspaceCommandPalette /></>)
    const editor = await editorAt(14)
    if (entry === 'toolbar') fireEvent.click(screen.getByRole('button', { name: 'Run Current Statement' }))
    if (entry === 'keyboard') fireEvent.keyDown(editor, { key: 'Enter', metaKey: true })
    if (entry === 'palette') {
      fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
      fireEvent.click(await screen.findByRole('option', { name: /Run Current Statement/ }))
    }
    await waitFor(() => expect(ipc.execute).toHaveBeenCalledOnce())
    expect(ipc.execute.mock.calls[0][0].sql).toBe('SELECT 2')
  })
  it.each(['toolbar', 'palette'] as const)('%s Run All explicitly sends the complete unsaved script', async (entry) => {
    seedScript(); render(<><MainPanel /><WorkspaceCommandPalette /></>)
    await editorAt(10, 18)
    if (entry === 'toolbar') {
      fireEvent.click(screen.getByRole('button', { name: i18n.t('editor.moreActions') }))
      fireEvent.click(await screen.findByRole('button', { name: 'Run All' }))
    } else {
      fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
      fireEvent.click(await screen.findByRole('option', { name: /Run All/ }))
    }
    await waitFor(() => expect(ipc.execute).toHaveBeenCalledOnce())
    expect(ipc.execute.mock.calls[0][0].sql).toBe(current().sql)
    expect(current().dirty).toBe(true)
  })
  it('empty current is a no-op across all entries', async () => {
    useEditorStore.setState({ tabs: [{ ...current(), sql: '; SELECT 2;' }] })
    render(<MainPanel />)
    const editor = await editorAt(0)
    fireEvent.click(screen.getByRole('button', { name: 'Run Current Statement' }))
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })
    act(() => dispatchSqlCommand('runCurrent'))
    expect(ipc.execute).not.toHaveBeenCalled()
  })
  it.each(['postgres', 'mysql'] as const)('running %s disables both run actions and advertises only supported cancel', async (driverType) => {
    useConnectionStore.setState(state => ({ connections: state.connections.map(connection => ({ ...connection, driverType })) }))
    useEditorStore.setState({ tabs: [{ ...current(), running: true, runningQueryId: 'pending' }] })
    render(<MainPanel />)
    act(() => { dispatchSqlCommand('runCurrent'); dispatchSqlCommand('runAll') })
    expect(ipc.execute).not.toHaveBeenCalled()
    expect(useSqlCommandState.getState().available).toMatchObject({ runCurrent: false, runAll: false, cancel: driverType === 'postgres' })
    expect(screen.queryByRole('button', { name: 'Cancel Query' }) !== null).toBe(driverType === 'postgres')
  })
  it('keeps earlier result tabs visible beside a later failure report', async () => {
    seedScript()
    ipc.execute.mockResolvedValueOnce({ connectionGeneration: 1, results: [
      { columns: [{ name: 'first_value', dataType: 'INTEGER', nullable: false }], rows: [[1]], rowCount: 1, affectedRows: 0, elapsedMs: 1, truncated: false },
      { columns: [{ name: 'second_value', dataType: 'INTEGER', nullable: false }], rows: [[2]], rowCount: 1, affectedRows: 0, elapsedMs: 1, truncated: false },
    ], outcome: 'failed', terminalError: { code: 'QUERY_FAILED', message: 'fixture syntax error' }, statements: [
      { index: 1, preview: 'SELECT 1', status: 'succeeded', resultIndex: 0 },
      { index: 2, preview: 'SELECT 2', status: 'succeeded', resultIndex: 1 },
      { index: 3, preview: 'bad', status: 'failed', error: { code: 'QUERY_FAILED', message: 'fixture syntax error' } },
      { index: 4, preview: 'SELECT 4', status: 'notExecuted' },
    ] })
    render(<MainPanel />)
    act(() => dispatchSqlCommand('runAll'))
    expect(await screen.findByText('Not executed')).toBeVisible()
    expect(screen.getByText('fixture syntax error')).toBeVisible()
    expect(screen.getByRole('button', { name: /^Statement 1 / })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Statement 2' }))
    expect(screen.getByRole('button', { name: /^Statement 2 / })).toHaveClass('bg-background')
    expect(current().dirty).toBe(true)
    expect(ipc.file).not.toHaveBeenCalled()
    expect(useQueryResultStore.getState().sources[current().lastQueryId!].connectionId).toBe('A')
  })

  it('blocks repeated commands while preflight/execution is in progress', async () => {
    seedScript(); render(<MainPanel />)
    await editorAt(14)
    act(() => { dispatchSqlCommand('runCurrent'); dispatchSqlCommand('runAll'); dispatchSqlCommand('runCurrent') })
    await waitFor(() => expect(ipc.execute).toHaveBeenCalledOnce())
  })

})
