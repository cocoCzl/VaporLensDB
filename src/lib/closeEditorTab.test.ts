import { beforeEach, describe, expect, it, vi } from 'vitest'
import { closeEditorTab, closeEditorTabs } from '@/lib/closeEditorTab'
import { runTabTransaction } from '@/lib/tabTransaction'
import { useEditorStore, type EditorTab } from '@/stores/editorStore'

const mocks = vi.hoisted(() => ({ save: vi.fn(), rollback: vi.fn(), mode: vi.fn(), notify: vi.fn(), notifyError: vi.fn() }))
vi.mock('@/ipc/query', () => ({ rollbackConsoleTransaction: mocks.rollback, setConsoleTransactionMode: mocks.mode }))
vi.mock('@/stores/sqlDraftStore', () => ({ useSqlDraftStore: { getState: () => ({ saveTabDraft: mocks.save }) } }))
vi.mock('@/stores/connectionStore', () => ({ useConnectionStore: { getState: () => ({ connections: [] }) } }))
vi.mock('@/stores/uiStore', () => ({ useUiStore: { getState: () => ({ notify: mocks.notify, notifyError: mocks.notifyError }) } }))

function tab(overrides: Partial<EditorTab> = {}): EditorTab {
  return { id: 'tab', kind: 'sql', title: 'SQL', sql: 'SELECT 1', connectionId: 'source', database: 'app', schema: 'tenant', dirty: true, ...overrides }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const current = () => useEditorStore.getState().tabs[0]

describe('shared tab closing', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    useEditorStore.setState({ tabs: [tab()], activeTabId: 'tab' })
    mocks.save.mockResolvedValue({ kind: 'saved', draft: { id: 'draft' } })
    mocks.rollback.mockResolvedValue({ mode: 'manual', phase: 'idle' })
    mocks.mode.mockResolvedValue({ mode: 'auto', phase: 'idle' })
  })

  it('waits for persistence, includes context, and deduplicates repeated close requests', async () => {
    const saving = deferred<{ kind: string; draft: { id: string } }>()
    mocks.save.mockReturnValue(saving.promise)
    const first = closeEditorTab('tab')
    expect(closeEditorTab('tab')).toBe(first)
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    expect(current().closing).toBe(true)
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'tab' }), { connection: null, database: 'app', schema: 'tenant' }, true)
    saving.resolve({ kind: 'saved', draft: { id: 'draft' } })
    expect(await first).toBe(true)
    expect(useEditorStore.getState().tabs).toEqual([])
  })

  it.each(['active', 'failed'] as const)('confirms and rolls back a %s manual transaction before removing its console', async (phase) => {
    useEditorStore.setState({ tabs: [tab({ transactionMode: 'manual', transactionPhase: phase })] })
    mocks.rollback.mockImplementation(async () => {
      expect(mocks.mode).not.toHaveBeenCalled()
      expect(mocks.save).not.toHaveBeenCalled()
      return { mode: 'manual', phase: 'idle' }
    })
    expect(await closeEditorTab('tab')).toBe(true)
    expect(window.confirm).toHaveBeenCalledOnce()
    expect(mocks.rollback).toHaveBeenCalledWith('source', 'tab')
    expect(mocks.mode).toHaveBeenCalledWith('source', 'tab', 'auto')
  })

  it('retains a transaction when the rollback confirmation is cancelled', async () => {
    useEditorStore.setState({ tabs: [tab({ transactionMode: 'manual', transactionPhase: 'active' })] })
    vi.mocked(window.confirm).mockReturnValue(false)
    expect(await closeEditorTab('tab')).toBe(false)
    expect(mocks.rollback).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
    expect(current().transactionPhase).toBe('active')
  })

  it.each(['rollback', 'mode'] as const)('retains the tab and reports a %s failure', async (operation) => {
    useEditorStore.setState({ tabs: [tab({ transactionMode: 'manual', transactionPhase: 'active' })] })
    mocks[operation].mockRejectedValue(new Error('session unavailable'))
    expect(await closeEditorTab('tab')).toBe(false)
    expect(current().closing).toBe(false)
    expect(current().transactionPhase).toBe(operation === 'rollback' ? 'active' : 'idle')
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.notifyError).toHaveBeenCalledOnce()
  })

  it('retains the tab when saving fails and permits a retry', async () => {
    mocks.save.mockResolvedValueOnce(null)
    expect(await closeEditorTab('tab')).toBe(false)
    expect(current()).toMatchObject({ dirty: true, closing: false })
    expect(await closeEditorTab('tab')).toBe(true)
  })

  it('retains new edits made during the final save', async () => {
    const saving = deferred<{ kind: string; draft: { id: string } }>()
    mocks.save.mockReturnValue(saving.promise)
    const closing = closeEditorTab('tab')
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledOnce())
    useEditorStore.getState().updateTabSql('tab', 'SELECT 2')
    saving.resolve({ kind: 'saved', draft: { id: 'draft' } })
    expect(await closing).toBe(false)
    expect(current()).toMatchObject({ sql: 'SELECT 2', dirty: true, closing: false })
  })

  it.each([{ running: true }, { transactionBusy: true }])('refuses to close busy tabs: %j', async (busy) => {
    useEditorStore.setState({ tabs: [tab(busy)] })
    expect(await closeEditorTab('tab')).toBe(false)
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('closes a batch sequentially and stops on failure', async () => {
    useEditorStore.setState({ tabs: [tab(), tab({ id: 'second' }), tab({ id: 'third' })] })
    mocks.save.mockResolvedValueOnce({ kind: 'cleared' }).mockResolvedValueOnce(null)
    await closeEditorTabs(['tab', 'second', 'third'])
    expect(mocks.save.mock.calls.map(([snapshot]) => snapshot.id)).toEqual(['tab', 'second'])
    expect(useEditorStore.getState().tabs.map((item) => item.id)).toEqual(['second', 'third'])
  })

  it('closes non-SQL tabs without draft persistence', async () => {
    useEditorStore.setState({ tabs: [tab({ kind: 'settings', connectionId: null })] })
    expect(await closeEditorTab('tab')).toBe(true)
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('reserves transaction controls synchronously and releases on failure', async () => {
    const operation = deferred<never>()
    const transaction = runTabTransaction('tab', () => operation.promise)
    expect(current().transactionBusy).toBe(true)
    expect(await closeEditorTab('tab')).toBe(false)
    operation.reject(new Error('commit unavailable'))
    await expect(transaction).rejects.toThrow('commit unavailable')
    expect(current().transactionBusy).toBe(false)
  })

  it('does not start transaction controls while closing', async () => {
    useEditorStore.getState().setTabClosing('tab', true)
    const action = vi.fn()
    await runTabTransaction('tab', action)
    expect(action).not.toHaveBeenCalled()
  })
})
