import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { useExecutionTargetSwitch } from '@/hooks/useExecutionTargetSwitch'
import { StatusBar } from '@/components/layout/StatusBar'
import { useMetadataStore } from '@/stores/metadataStore'
import { ExecutionContextBar } from './ExecutionContextBar'
import { useEditorStore } from '@/stores/editorStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useQueryResultStore } from '@/stores/queryResultStore'
import { beginExecutionTargetSwitch } from '@/lib/executionTargetSwitch'
import { closeEditorTab } from '@/lib/closeEditorTab'
import type { ConsoleTransactionState, TransactionPhase } from '@/types/query'
import i18n from '@/i18n'

const ipc = vi.hoisted(() => ({ get: vi.fn(), commit: vi.fn(), rollback: vi.fn(), mode: vi.fn(), connect: vi.fn() }))
vi.mock('@/ipc/query', () => ({
  getConsoleTransactionState: ipc.get, commitConsoleTransaction: ipc.commit,
  rollbackConsoleTransaction: ipc.rollback, setConsoleTransactionMode: ipc.mode,
}))

// Stateful mock backend: mutation stays uncommitted until commit/rollback,
// and unresolved sessions cannot be released, matching the manager contract.
let backend: ConsoleTransactionState
let storedValue: number
let pendingValue: number | null
let sessionExists: boolean
const current = () => useEditorStore.getState().tabs[0]
const state = () => ({ ...backend })
function seed(phase: TransactionPhase = 'active', manual = true) {
  backend = { connectionId: 'A', consoleId: 'tab', mode: manual ? 'manual' : 'auto', phase }
  sessionExists = manual
  storedValue = 1
  pendingValue = phase === 'idle' ? null : 2 // UPDATE fixture SET value = 2, then optionally a failing statement.
  useEditorStore.setState({ activeTabId: 'tab', tabs: [{ id: 'tab', kind: 'sql', title: 'SQL', connectionId: 'A', database: 'db-A', schema: 'schema-A', sql: 'UPDATE fixture SET value = 2', transactionMode: backend.mode, transactionPhase: phase, lastQueryId: 'result-A' }] })
}
function Harness() {
  const { request, dialog } = useExecutionTargetSwitch()
  return <><ExecutionContextBar /><button onClick={() => request('tab', 'B')}>Choose B</button><button onClick={() => request('tab', 'C')}>Choose C</button>{dialog}</>
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
async function request() {
  fireEvent.click(screen.getByText('Choose B'))
  return screen.findByRole('dialog')
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.resetAllMocks()
  seed()
  useConnectionStore.setState({
    connections: ['A', 'B', 'C'].map((id) => ({ id, name: `Connection ${id}`, driverType: 'postgres', database: `db-${id}`, hasSavedPassword: true, connectionUrl: 'postgres://fixture:secret@example.invalid/db' })),
    browsingConnectionId: 'B', activeConnectionId: 'B', statuses: {
      A: { connectionId: 'A', status: 'connected' }, B: { connectionId: 'B', status: 'connected' },
    }, connectConnection: ipc.connect,
  })
  useQueryResultStore.setState({ sources: { 'result-A': { queryId: 'result-A', connectionId: 'A', connectionGeneration: 1, database: 'db-A', schema: 'schema-A', consoleId: 'tab', transactionMode: 'manual', sql: 'SELECT 1', executedAt: '2026-10-06T00:00:00Z' } } })
  ipc.get.mockImplementation(async (connectionId, consoleId) => connectionId === 'A' ? state() : ({ connectionId, consoleId, mode: 'auto', phase: 'idle' }))
  ipc.commit.mockImplementation(async () => {
    if (backend.phase === 'failed') throw new Error('Cannot commit failed transaction')
    storedValue = pendingValue ?? storedValue
    pendingValue = null
    backend.phase = 'idle'
    return state()
  })
  ipc.rollback.mockImplementation(async () => { pendingValue = null; backend.phase = 'idle'; return state() })
  ipc.mode.mockImplementation(async () => {
    if (backend.phase !== 'idle') throw new Error('Unresolved transaction')
    sessionExists = false
    backend.mode = 'auto'
    return state()
  })
  ipc.connect.mockResolvedValue(undefined)
})
afterEach(async () => { await i18n.changeLanguage('en') })

describe('transaction-aware execution target UI', () => {
  it.each(['active', 'failed'] as const)('retains the %s mutation, target and results until a decision; cancel preserves them', async (phase) => {
    seed(phase)
    render(<Harness />)
    const dialog = await request()
    expect(current()).toMatchObject({ connectionId: 'A', transactionMode: 'manual', transactionPhase: phase, transactionBusy: true, lastQueryId: 'result-A' })
    expect(backend.phase).toBe(phase)
    expect(sessionExists).toBe(true)
    expect(pendingValue).toBe(2)
    expect(storedValue).toBe(1)
    expect(ipc.connect).not.toHaveBeenCalled()
    expect(within(dialog).getByText('Connection A · db-A / schema-A')).toBeVisible()
    expect(within(dialog).getByText('Connection B')).toBeVisible()
    if (phase === 'failed') expect(within(dialog).queryByRole('button', { name: 'Commit and switch' })).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel switch' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(current()).toMatchObject({ connectionId: 'A', transactionPhase: phase, transactionBusy: false, sql: 'UPDATE fixture SET value = 2', lastQueryId: 'result-A' })
    expect(pendingValue).toBe(2)
    expect(ipc.commit).not.toHaveBeenCalled()
    expect(ipc.rollback).not.toHaveBeenCalled()
    expect(useConnectionStore.getState().browsingConnectionId).toBe('B')
  })

  it.each([
    ['active', 'commit', 'Commit and switch'],
    ['active', 'rollback', 'Rollback and switch'],
    ['failed', 'rollback', 'Rollback and switch'],
  ] as const)('%s: %s finishes the old transaction, releases it, then adopts B', async (phase, operation, label) => {
    seed(phase)
    ipc.connect.mockImplementation(async () => {
      expect(pendingValue).toBeNull()
      expect(sessionExists).toBe(false)
      expect(current().connectionId).toBe('A')
    })
    render(<Harness />)
    const dialog = await request()
    fireEvent.click(within(dialog).getByRole('button', { name: label }))
    await waitFor(() => expect(current().connectionId).toBe('B'))
    expect(ipc[operation]).toHaveBeenCalledWith('A', 'tab')
    expect(storedValue).toBe(operation === 'commit' ? 2 : 1)
    expect(ipc.mode).toHaveBeenCalledWith('A', 'tab', 'auto')
    expect(ipc.connect).toHaveBeenCalledWith('B', { selectForBrowsing: false })
    expect(current()).toMatchObject({ database: 'db-B', schema: null, transactionMode: 'auto', transactionPhase: 'idle', transactionBusy: false, lastQueryId: 'result-A' })
    expect(useQueryResultStore.getState().sources['result-A'].connectionId).toBe('A')
    expect(screen.getByText('Execution: Connection B')).toBeVisible()
    expect(screen.queryByText('Manual · Active transaction')).not.toBeInTheDocument()
  })

  it.each([
    ['active', 'commit', 'Commit and switch'],
    ['active', 'rollback', 'Rollback and switch'],
    ['failed', 'rollback', 'Rollback and switch'],
  ] as const)('%s: rejected %s stays on A, refreshes backend state and supports retry', async (phase, operation, label) => {
    seed(phase)
    ipc[operation].mockRejectedValueOnce(new Error('postgres://user:fixture-secret@example.invalid/db'))
    render(<Harness />)
    const dialog = await request()
    fireEvent.click(within(dialog).getByRole('button', { name: label }))
    expect(await screen.findByRole('alert')).toHaveTextContent('execution connection is unchanged')
    expect(document.body.textContent).not.toContain('fixture-secret')
    expect(current()).toMatchObject({ connectionId: 'A', transactionPhase: phase })
    expect(sessionExists).toBe(true)
    expect(ipc.connect).not.toHaveBeenCalled()
    expect(screen.getByText('Execution: Connection A')).toBeVisible()
    fireEvent.click(within(dialog).getByRole('button', { name: label }))
    await waitFor(() => expect(current().connectionId).toBe('B'))
  })

  it.each([false, true])('idle (manual=%s) switches without confirmation and releases only an existing session', async (manual) => {
    seed('idle', manual)
    render(<Harness />)
    fireEvent.click(screen.getByText('Choose B'))
    await waitFor(() => expect(current().connectionId).toBe('B'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(ipc.mode).toHaveBeenCalledTimes(manual ? 1 : 0)
    expect(sessionExists).toBe(false)
    expect(ipc.commit).not.toHaveBeenCalled()
    expect(ipc.rollback).not.toHaveBeenCalled()
  })

  it('uses backend Failed over stale frontend Active and refuses Commit', async () => {
    backend.phase = 'failed'
    render(<Harness />)
    const dialog = await request()
    expect(within(dialog).getByText('Manual · Failed transaction')).toBeVisible()
    expect(within(dialog).queryByText('Commit and switch')).not.toBeInTheDocument()
  })

  it('refreshes a transaction that becomes Failed during a rejected commit', async () => {
    ipc.commit.mockImplementationOnce(async () => { backend.phase = 'failed'; throw new Error('rejected') })
    render(<Harness />)
    const dialog = await request()
    fireEvent.click(within(dialog).getByText('Commit and switch'))
    await screen.findByRole('alert')
    expect(current().transactionPhase).toBe('failed')
    expect(within(dialog).queryByText('Commit and switch')).not.toBeInTheDocument()
    expect(within(dialog).getByText('Rollback and switch')).toBeEnabled()
  })

  it.each(['release', 'connect', 'read'] as const)('keeps A after a %s failure without inventing a failed transaction', async (failure) => {
    seed('idle', true)
    if (failure === 'release') ipc.mode.mockRejectedValueOnce(new Error('release failed'))
    if (failure === 'connect') ipc.connect.mockRejectedValueOnce(new Error('connect failed'))
    if (failure === 'read') ipc.get.mockRejectedValue(new Error('state unavailable'))
    render(<Harness />)
    fireEvent.click(screen.getByText('Choose B'))
    await screen.findByRole('alert')
    expect(current()).toMatchObject({ connectionId: 'A', transactionPhase: 'idle', transactionMode: failure === 'connect' ? 'auto' : 'manual' })
    fireEvent.click(screen.getByText('Cancel switch'))
    expect(current().transactionBusy).toBe(false)
  })

  it('blocks close, query reservation, context edits, repeated switches and dismissal while committing', async () => {
    const commit = deferred<ConsoleTransactionState>()
    ipc.commit.mockReturnValueOnce(commit.promise)
    render(<Harness />)
    const dialog = await request()
    fireEvent.click(within(dialog).getByText('Commit and switch'))
    fireEvent.click(within(dialog).getByText('Commit and switch'))
    fireEvent.click(screen.getByText('Choose C'))
    await waitFor(() => expect(ipc.commit).toHaveBeenCalledOnce())
    expect(beginExecutionTargetSwitch('tab', 'C')).toBeNull()
    expect(await closeEditorTab('tab')).toBe(false)
    useEditorStore.getState().updateSqlTabContext('tab', { schema: 'wrong' })
    expect(current().schema).toBe('schema-A')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(within(dialog).getByText('Cancel switch')).toBeDisabled()
    backend.phase = 'idle'; pendingValue = null
    await act(async () => { commit.resolve(state()) })
    await waitFor(() => expect(current().connectionId).toBe('B'))
    expect(ipc.connect).toHaveBeenCalledTimes(1)
  })

  it('rechecks phase before acting on a stale Commit choice', async () => {
    render(<Harness />)
    const dialog = await request()
    backend.phase = 'failed'
    fireEvent.click(within(dialog).getByText('Commit and switch'))
    await waitFor(() => expect(within(dialog).queryByText('Commit and switch')).not.toBeInTheDocument())
    expect(ipc.commit).not.toHaveBeenCalled()
    expect(current().connectionId).toBe('A')
  })

  it('keeps the confirmation alive when the user selects another workspace tab', async () => {
    render(<Harness />)
    await request()
    act(() => useEditorStore.getState().addTab({ id: 'other', kind: 'settings', title: 'Settings', sql: '', connectionId: null }))
    expect(screen.getByRole('dialog')).toBeVisible()
    fireEvent.click(screen.getByText('Cancel switch'))
    expect(current().connectionId).toBe('A')
    expect(current().transactionBusy).toBe(false)
  })

  it('releases a waiting reservation on unmount', async () => {
    const rendered = render(<Harness />)
    await request()
    rendered.unmount()
    expect(current().transactionBusy).toBe(false)
    expect(pendingValue).toBe(2)
  })

  it.each(['en', 'zh'])('shows execution, independent browsing and transaction context in %s without secrets', async (language) => {
    await i18n.changeLanguage(language)
    render(<Harness />)
    const bar = screen.getByLabelText(i18n.t('executionContext.title'))
    expect(bar).toHaveTextContent(`${i18n.t('executionContext.execution')}: Connection A`)
    expect(bar).toHaveTextContent(`${i18n.t('executionContext.browsing')}: Connection B`)
    expect(bar).toHaveTextContent('db-A')
    expect(bar).toHaveTextContent('schema-A')
    expect(bar).toHaveTextContent(i18n.t('executionContext.active'))
    const dialog = await request()
    expect(within(dialog).getByText(i18n.t('executionContext.commitSwitch'))).toBeVisible()
    expect(document.body.textContent).not.toContain('postgres://')
    expect(document.body.textContent).not.toContain('secret')
  })


  it('ignores a late switch response after the source tab is removed', async () => {
    const reading = deferred<ConsoleTransactionState>()
    ipc.get.mockReturnValueOnce(reading.promise)
    render(<Harness />)
    fireEvent.click(screen.getByText('Choose B'))
    act(() => useEditorStore.setState({ tabs: [], activeTabId: null }))
    await act(async () => { reading.resolve(state()) })
    await screen.findByRole('alert')
    expect(useEditorStore.getState().tabs).toEqual([])
    expect(ipc.connect).not.toHaveBeenCalled()
    expect(ipc.commit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Cancel switch'))
  })

  it('retains the last confirmed state if both the operation and state refresh fail', async () => {
    render(<Harness />)
    const dialog = await request()
    ipc.commit.mockImplementationOnce(async () => { ipc.get.mockRejectedValue(new Error('unavailable')); throw new Error('unavailable') })
    fireEvent.click(within(dialog).getByText('Commit and switch'))
    await screen.findByRole('alert')
    expect(current()).toMatchObject({ connectionId: 'A', transactionMode: 'manual', transactionPhase: 'active' })
    expect(ipc.connect).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Cancel switch'))
  })

  it('blocks repeated requests while the initial backend state is pending', async () => {
    const reading = deferred<ConsoleTransactionState>()
    ipc.get.mockReturnValueOnce(reading.promise)
    render(<Harness />)
    fireEvent.click(screen.getByText('Choose B'))
    fireEvent.click(screen.getByText('Choose C'))
    expect(current().transactionBusy).toBe(true)
    expect(ipc.get).toHaveBeenCalledOnce()
    await act(async () => { reading.resolve(state()) })
    await screen.findByRole('dialog')
    expect(screen.getByRole('dialog')).toHaveTextContent('Connection B')
    fireEvent.click(screen.getByText('Cancel switch'))
  })

  it('never substitutes a browsing metadata path for the status bar execution context', () => {
    useMetadataStore.setState({ catalogSchemaPaths: { A: { connectionId: 'A', database: 'wrong-database', schema: 'wrong-schema', schemaListAvailable: true } } })
    const { container } = render(<StatusBar backendStatus="ok fixture" />)
    expect(container.textContent).toContain('db-A / schema-A')
    expect(container.textContent).not.toContain('wrong-schema')
    act(() => useEditorStore.setState({ tabs: [{ ...current(), connectionId: null, unavailableConnectionName: 'Removed source' }] }))
    expect(container.textContent).toContain('Removed source')
    expect(container.textContent).not.toContain('Connection B')
  })

  it('keeps the disconnected execution target visible independently of browsing and reconnect', () => {
    render(<Harness />)
    act(() => useConnectionStore.setState({ statuses: {} }))
    const bar = screen.getByLabelText('Execution context')
    expect(bar).toHaveTextContent('Execution: Connection A')
    expect(bar).toHaveTextContent(i18n.t('connection.disconnected'))
    act(() => useConnectionStore.setState({ statuses: { A: { connectionId: 'A', status: 'connected' } } }))
    expect(bar).toHaveTextContent('Execution: Connection A')
    expect(bar).not.toHaveTextContent(i18n.t('connection.disconnected'))
  })
})
