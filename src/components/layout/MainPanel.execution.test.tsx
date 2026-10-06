import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MainPanel } from './MainPanel'
import { useEditorStore } from '@/stores/editorStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useMetadataStore } from '@/stores/metadataStore'
import { useSqlDraftStore } from '@/stores/sqlDraftStore'
import { useQueryHistoryStore } from '@/stores/queryHistoryStore'
import { useQueryResultStore } from '@/stores/queryResultStore'
import i18n from '@/i18n'
import type { QueryStreamDone } from '@/types/query'

const ipc = vi.hoisted(() => ({ execute: vi.fn(), state: vi.fn(), mode: vi.fn(), rollback: vi.fn(), connect: vi.fn(), done: null as ((event: QueryStreamDone) => void) | null }))
vi.mock('@/ipc/query', async (original) => ({
  ...await original<typeof import('@/ipc/query')>(),
  analyzeSqlRisk: async () => ({ dangerous: false, reasons: [], status: 'safe' }),
  executeQuery: ipc.execute, executeQueryStream: ipc.execute, getConsoleTransactionState: ipc.state,
  onQueryResultDone: async (handler: (event: QueryStreamDone) => void) => { ipc.done = handler; return () => {} },
  onQueryResultChunk: async () => () => {}, onQueryResultError: async () => () => {},
  setConsoleTransactionMode: ipc.mode, rollbackConsoleTransaction: ipc.rollback,
}))
// Exercise MainPanel's actual execution/switch handlers without Monaco/popover layout.
vi.mock('@/components/editor/EditorToolbar', () => ({ EditorToolbar: (props: {
  onRun: () => void; onConnectionChange: (id: string) => void; contextDisabled: boolean
}) => <><button onClick={() => props.onRun()}>Run fixture</button><button disabled={props.contextDisabled} onClick={() => props.onConnectionChange('B')}>Switch fixture</button></> }))

const current = () => useEditorStore.getState().tabs[0]
beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.resetAllMocks()
  useEditorStore.setState({ activeTabId: 'tab', tabs: [{ id: 'tab', kind: 'sql', title: 'SQL A', sql: 'UPDATE fixture SET value = 2 WHERE id = 1', connectionId: 'A', database: 'db-A', schema: 'schema-A', transactionMode: 'manual', transactionPhase: 'idle' }] })
  useConnectionStore.setState({ connections: ['A', 'B'].map((id) => ({ id, name: `Connection ${id}`, driverType: 'postgres', database: `db-${id}`, hasSavedPassword: false })), activeConnectionId: 'A', browsingConnectionId: 'A', statuses: { A: { connectionId: 'A', status: 'connected' } }, connectConnection: ipc.connect })
  useQueryResultStore.setState({ results: {}, explains: {}, sources: {} })
  vi.spyOn(useSqlDraftStore.getState(), 'loadDrafts').mockResolvedValue(undefined)
  vi.spyOn(useSqlDraftStore.getState(), 'saveTabDraft').mockResolvedValue({ kind: 'cleared' })
  vi.spyOn(useQueryHistoryStore.getState(), 'addEntry').mockResolvedValue(undefined)
  for (const key of ['loadDatabases', 'loadSchemas', 'loadTables', 'loadViews', 'loadFunctions'] as const) vi.spyOn(useMetadataStore.getState(), key).mockResolvedValue([])
  ipc.state.mockImplementation(async (connectionId, consoleId) => ({ connectionId, consoleId, mode: connectionId === 'A' ? 'manual' : 'auto', phase: connectionId === 'A' ? 'active' : 'idle' }))
  ipc.execute.mockImplementation(async ({ queryId }) => {
    ipc.done?.({ queryId, affectedRows: 1, rowCount: 0, elapsedMs: 2, truncated: false, receivedBytes: 0 })
    return { connectionGeneration: 1 }
  })
  ipc.rollback.mockResolvedValue({ connectionId: 'A', consoleId: 'tab', mode: 'manual', phase: 'idle' })
  ipc.mode.mockResolvedValue({ connectionId: 'A', consoleId: 'tab', mode: 'auto', phase: 'idle' })
  ipc.connect.mockResolvedValue(undefined)
})

describe('MainPanel execution target integration', () => {
  it('browsing B leaves the tab on A, and Run sends its SQL and schema to A', async () => {
    render(<MainPanel />)
    act(() => useConnectionStore.getState().setActiveConnection('B'))
    expect(current().connectionId).toBe('A')
    expect(screen.getByText('Execution: Connection A')).toBeVisible()
    expect(screen.getByText('Browsing: Connection B')).toBeVisible()
    fireEvent.click(screen.getByText('Run fixture'))
    await waitFor(() => expect(ipc.execute).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'A', consoleId: 'tab', database: 'db-A', schema: 'schema-A', sql: current().sql.replace(/;$/, '') })))
    await waitFor(() => expect(current().running).toBe(false))
    expect(current().transactionPhase).toBe('active')
  })

  it('after a mutation, requires a decision before switching, blocks execution, and preserves result provenance', async () => {
    render(<MainPanel />)
    fireEvent.click(screen.getByText('Run fixture'))
    await waitFor(() => expect(current().transactionPhase).toBe('active'))
    const queryId = current().lastQueryId!
    fireEvent.click(screen.getByText('Switch fixture'))
    await screen.findByRole('dialog')
    expect(current().connectionId).toBe('A')
    fireEvent.click(screen.getByText('Run fixture'))
    expect(ipc.execute).toHaveBeenCalledOnce()
    expect(screen.getByText('Switch fixture')).toBeDisabled()
    fireEvent.click(screen.getByText('Rollback and switch'))
    await waitFor(() => expect(current().connectionId).toBe('B'))
    expect(current().lastQueryId).toBe(queryId)
    expect(useQueryResultStore.getState().sources[queryId].connectionId).toBe('A')
    expect(screen.getByText(new RegExp(`Connection A.*${i18n.t('workbench.previousResult')}`))).toBeInTheDocument()
  })

  it('reconnects execution A rather than the independently selected browsing B', async () => {
    useConnectionStore.setState({ statuses: {}, activeConnectionId: 'B', browsingConnectionId: 'B' })
    render(<MainPanel />)
    fireEvent.click(screen.getByText('Run fixture'))
    await waitFor(() => expect(ipc.execute).toHaveBeenCalled())
    expect(ipc.connect).toHaveBeenCalledWith('A', { selectForBrowsing: false })
    expect(ipc.execute.mock.calls[0][0].connectionId).toBe('A')
    expect(current().connectionId).toBe('A')
  })

  it('a separate new SQL tab on A uses its own Auto execution, not the first tab console', async () => {
    render(<MainPanel />)
    act(() => useEditorStore.getState().addTab({ id: 'new', kind: 'sql', title: 'SQL A', sql: 'UPDATE fixture SET value = 3 WHERE id = 1', connectionId: 'A' }))
    fireEvent.click(screen.getByText('Run fixture'))
    await waitFor(() => expect(ipc.execute).toHaveBeenCalled())
    expect(ipc.execute.mock.calls[0][0]).toMatchObject({ connectionId: 'A', tabId: 'new', consoleId: undefined })
    expect(current().transactionMode).toBe('manual')
  })
})
