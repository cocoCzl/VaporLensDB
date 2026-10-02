import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { classifyStatement, containsLikelyDdl, useQuery } from '@/hooks/useQuery'
import { useEditorStore } from '@/stores/editorStore'
import { useQueryResultStore } from '@/stores/queryResultStore'
import { cancelQuery, executeQuery, executeQueryStream, onQueryResultChunk, onQueryResultDone, onQueryResultError, explainQuery, getConsoleTransactionState } from '@/ipc/query'
import { useQueryHistoryStore } from '@/stores/queryHistoryStore'
import { useUiStore } from '@/stores/uiStore'

vi.mock('@/ipc/query', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/ipc/query')>(),
  cancelQuery: vi.fn(),
  executeQuery: vi.fn(),
  executeQueryStream: vi.fn(),
  onQueryResultChunk: vi.fn(),
  onQueryResultDone: vi.fn(),
  onQueryResultError: vi.fn(),
  explainQuery: vi.fn(),
  getConsoleTransactionState: vi.fn(),
}))

describe('stream failure lifecycle', () => {
  let chunkListener: Parameters<typeof onQueryResultChunk>[0]
  let errorListener: Parameters<typeof onQueryResultError>[0]
  let doneListener: Parameters<typeof onQueryResultDone>[0]

  beforeEach(() => {
    vi.mocked(executeQueryStream).mockReset()
    vi.mocked(getConsoleTransactionState).mockReset()
    vi.spyOn(useUiStore.getState(), 'notify').mockImplementation(() => {})
    useEditorStore.setState({ tabs: [{ id: 'stream-tab', title: 'SQL', sql: 'SELECT 1', connectionId: 'source', transactionMode: 'manual', transactionPhase: 'active' }] })
    useQueryResultStore.setState({ results: {}, explains: {}, sources: {} })
    vi.mocked(onQueryResultChunk).mockImplementation(async (handler) => { chunkListener = handler; return vi.fn<() => void>() })
    vi.mocked(onQueryResultDone).mockImplementation(async (handler) => { doneListener = handler; return vi.fn<() => void>() })
    vi.mocked(onQueryResultError).mockImplementation(async (handler) => { errorListener = handler; return vi.fn<() => void>() })
    vi.mocked(getConsoleTransactionState).mockResolvedValue({ connectionId: 'source', consoleId: 'stream-tab', mode: 'manual', phase: 'active' })
    vi.spyOn(useQueryHistoryStore.getState(), 'addEntry').mockResolvedValue(undefined)
  })

  it('terminalizes partial rows after an error event and promise rejection without failing the transaction', async () => {
    vi.mocked(executeQueryStream).mockImplementationOnce(async ({ queryId }) => {
      chunkListener({ queryId, columns: [{ name: 'value', dataType: 'INTEGER', nullable: false }], rows: [[1]], rowOffset: 0 })
      errorListener({ queryId, code: 'RESULT_LIMIT_EXCEEDED', message: 'interactive result limit exceeded' })
      throw { code: 'RESULT_LIMIT_EXCEEDED', message: 'interactive result limit exceeded' }
    })
    const { result } = renderHook(() => useQuery())
    await act(async () => { expect(await result.current.runQuery('stream-tab', 'source', 'SELECT 1')).toBe(false) })
    const queryId = useEditorStore.getState().tabs[0].lastQueryId!
    expect(useQueryResultStore.getState().results[queryId][0]).toMatchObject({ streaming: false, rows: [[1]], rowCount: 1 })
    expect(useEditorStore.getState().tabs[0].transactionPhase).toBe('active')
    expect(useQueryHistoryStore.getState().addEntry).toHaveBeenCalledOnce()
    expect(useUiStore.getState().notify).toHaveBeenCalledOnce()
    expect(doneListener).toBeDefined()
  })

  it.each(['QUERY_FAILED', 'TIMEOUT', 'RESULT_LIMIT_EXCEEDED', 'RESULT_PROCESSING_ERROR', 'SERIALIZATION_ERROR', 'CANCELLED'])('ends a %s failure once, ignoring late chunks and DONE', async (code) => {
    vi.mocked(executeQueryStream).mockImplementationOnce(async ({ queryId }) => {
      chunkListener({ queryId, columns: [], rows: [[1]], rowOffset: 0 })
      errorListener({ queryId, code, message: 'query stopped' })
      chunkListener({ queryId, columns: [], rows: [[2]], rowOffset: 1 })
      doneListener({ queryId, rowCount: 99, affectedRows: 0, elapsedMs: 1, truncated: false, receivedBytes: 99 })
      return { connectionGeneration: 1 }
    })
    const { result } = renderHook(() => useQuery())
    await act(async () => { expect(await result.current.runQuery('stream-tab', 'source', 'SELECT 1')).toBe(false) })
    const queryId = useEditorStore.getState().tabs[0].lastQueryId!
    expect(useQueryResultStore.getState().results[queryId][0]).toMatchObject({ streaming: false, rows: [[1]], rowCount: 1 })
    expect(useQueryHistoryStore.getState().addEntry).toHaveBeenCalledOnce()
    expect(useQueryHistoryStore.getState().addEntry).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', errorCode: code }))
    expect(useUiStore.getState().notify).toHaveBeenCalledOnce()
  })

  it('preserves DONE when a late error event and promise rejection follow it', async () => {
    vi.mocked(executeQueryStream).mockImplementationOnce(async ({ queryId }) => {
      chunkListener({ queryId, columns: [], rows: [[1]], rowOffset: 0 })
      doneListener({ queryId, rowCount: 1, affectedRows: 0, elapsedMs: 1, truncated: false, receivedBytes: 5 })
      errorListener({ queryId, code: 'TIMEOUT', message: 'late rejection' })
      throw new Error('late command rejection')
    })
    const { result } = renderHook(() => useQuery())
    await act(async () => { expect(await result.current.runQuery('stream-tab', 'source', 'SELECT 1')).toBe(true) })
    expect(useQueryHistoryStore.getState().addEntry).toHaveBeenCalledOnce()
    expect(useQueryHistoryStore.getState().addEntry).toHaveBeenCalledWith(expect.objectContaining({ status: 'success', rowCount: 1 }))
    expect(useUiStore.getState().notify).not.toHaveBeenCalled()
  })

  it('terminalizes a completion processing exception as a client error', async () => {
    vi.spyOn(useQueryResultStore.getState(), 'finishStreamResult').mockImplementationOnce(() => { throw new Error('renderer unavailable') })
    vi.mocked(executeQueryStream).mockImplementationOnce(async ({ queryId }) => {
      chunkListener({ queryId, columns: [], rows: [[1]], rowOffset: 0 })
      expect(() => doneListener({ queryId, rowCount: 1, affectedRows: 0, elapsedMs: 1, truncated: false, receivedBytes: 5 })).not.toThrow()
      return { connectionGeneration: 1 }
    })
    const { result } = renderHook(() => useQuery())
    await act(async () => { expect(await result.current.runQuery('stream-tab', 'source', 'SELECT 1')).toBe(false) })
    const queryId = useEditorStore.getState().tabs[0].lastQueryId!
    expect(useQueryResultStore.getState().results[queryId][0]).toMatchObject({ streaming: false, rows: [[1]], rowCount: 1 })
    expect(useQueryHistoryStore.getState().addEntry).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'RESULT_PROCESSING_ERROR' }))
    expect(useEditorStore.getState().tabs[0].transactionPhase).toBe('active')
  })

  it.each(['rejected', 'missing-terminal'] as const)('terminalizes a command that is %s without an event', async (mode) => {
    if (mode === 'rejected') vi.mocked(executeQueryStream).mockRejectedValueOnce(new Error('command rejected'))
    else vi.mocked(executeQueryStream).mockResolvedValueOnce({ connectionGeneration: 1 })
    const { result } = renderHook(() => useQuery())
    await act(async () => { expect(await result.current.runQuery('stream-tab', 'source', 'SELECT 1')).toBe(false) })
    const queryId = useEditorStore.getState().tabs[0].lastQueryId!
    expect(useQueryResultStore.getState().results[queryId][0].streaming).toBe(false)
    expect(useQueryHistoryStore.getState().addEntry).toHaveBeenCalledOnce()
  })

  it('cleans up successful listener registrations if another registration fails', async () => {
    const unlisten = vi.fn()
    vi.mocked(onQueryResultChunk).mockResolvedValueOnce(unlisten)
    vi.mocked(onQueryResultError).mockRejectedValueOnce(new Error('listener unavailable'))
    const { result } = renderHook(() => useQuery())
    await act(async () => { expect(await result.current.runQuery('stream-tab', 'source', 'SELECT 1')).toBe(false) })
    expect(unlisten).toHaveBeenCalledOnce()
    expect(executeQueryStream).not.toHaveBeenCalled()
    const queryId = useEditorStore.getState().tabs[0].lastQueryId!
    expect(useQueryResultStore.getState().results[queryId][0].streaming).toBe(false)
  })

  it.each(['active', 'failed'] as const)('takes the backend transaction phase %s after a query error', async (phase) => {
    vi.mocked(executeQueryStream).mockRejectedValueOnce({ code: 'QUERY_FAILED', message: 'statement failed' })
    vi.mocked(getConsoleTransactionState).mockResolvedValueOnce({ connectionId: 'source', consoleId: 'stream-tab', mode: 'manual', phase })
    const { result } = renderHook(() => useQuery())
    await act(async () => { await result.current.runQuery('stream-tab', 'source', 'SELECT 1') })
    expect(useEditorStore.getState().tabs[0].transactionPhase).toBe(phase)
  })

  it('retains last known transaction phase when backend state is unavailable', async () => {
    vi.mocked(executeQueryStream).mockRejectedValueOnce(new Error('command rejected'))
    vi.mocked(getConsoleTransactionState).mockRejectedValueOnce(new Error('session unavailable'))
    const { result } = renderHook(() => useQuery())
    await act(async () => { expect(await result.current.runQuery('stream-tab', 'source', 'SELECT 1')).toBe(false) })
    expect(useEditorStore.getState().tabs[0].transactionPhase).toBe('active')
  })

  it.each(['query', 'connection', 'console', 'mode', 'removed'] as const)('ignores stale transaction responses after the %s changes', async (change) => {
    vi.mocked(executeQueryStream).mockRejectedValueOnce(new Error('command rejected'))
    vi.mocked(getConsoleTransactionState).mockImplementationOnce(async () => {
      if (change === 'removed') useEditorStore.setState({ tabs: [] })
      else useEditorStore.setState({ tabs: [{ ...useEditorStore.getState().tabs[0],
        ...(change === 'query' ? { lastQueryId: 'new-query' } : {}),
        ...(change === 'connection' ? { connectionId: 'other-source' } : {}),
        ...(change === 'mode' ? { transactionMode: 'auto', transactionPhase: 'idle' } as const : {}),
      }] })
      return { connectionId: 'source', consoleId: change === 'console' ? 'other-console' : 'stream-tab', mode: 'manual', phase: 'failed' }
    })
    const { result } = renderHook(() => useQuery())
    await act(async () => { await result.current.runQuery('stream-tab', 'source', 'SELECT 1') })
    expect(useEditorStore.getState().tabs[0]?.transactionPhase).not.toBe('failed')
  })

  it('a successful cancel request keeps streaming until execution really ends', async () => {
    let resolveExecution: (session: { connectionGeneration: number }) => void
    vi.mocked(executeQueryStream).mockImplementationOnce(() => new Promise((resolve) => { resolveExecution = resolve }))
    vi.mocked(cancelQuery).mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useQuery())
    let running: Promise<boolean>
    await act(async () => { running = result.current.runQuery('stream-tab', 'source', 'SELECT 1') })
    const queryId = useEditorStore.getState().tabs[0].lastQueryId!
    await act(async () => { expect(await result.current.cancelRunningQuery('stream-tab', 'source', queryId)).toBe(true) })
    expect(useQueryResultStore.getState().results[queryId][0].streaming).toBe(true)
    await act(async () => {
      errorListener({ queryId, code: 'CANCELLED', message: 'query cancelled' })
      resolveExecution!({ connectionGeneration: 1 })
      expect(await running!).toBe(false)
    })
    expect(useQueryResultStore.getState().results[queryId][0].streaming).toBe(false)
  })
})

describe('query start protection', () => {
  it.each(['closing', 'transactionBusy', 'removed'] as const)('rejects query and EXPLAIN for a %s tab', async (state) => {
    vi.mocked(executeQuery).mockClear()
    vi.mocked(explainQuery).mockClear()
    useEditorStore.setState({ tabs: state === 'removed' ? [] : [{
      id: 'protected-tab', title: 'SQL', sql: 'UPDATE items SET value = 1', connectionId: 'source', [state]: true,
    }] })
    const { result, unmount } = renderHook(() => useQuery())
    await act(async () => {
      expect(await result.current.runQuery('protected-tab', 'source', 'UPDATE items SET value = 1')).toBe(false)
      await result.current.runExplain('protected-tab', 'source', 'SELECT 1')
    })
    expect(executeQuery).not.toHaveBeenCalled()
    expect(explainQuery).not.toHaveBeenCalled()
    unmount()
    useEditorStore.setState({ tabs: [], activeTabId: null })
  })
})

describe('query cancellation state', () => {
  it('keeps a query running when cancellation fails', async () => {
    vi.mocked(cancelQuery).mockRejectedValueOnce(new Error('cancellation unavailable'))
    useEditorStore.setState({ tabs: [{ id: 'cancel-tab', title: 'SQL', sql: 'SELECT 1', connectionId: 'source', running: true, runningQueryId: 'running-query', lastQueryId: 'running-query' }] })
    const { result, unmount } = renderHook(() => useQuery())
    await act(async () => {
      expect(await result.current.cancelRunningQuery('cancel-tab', 'source', 'running-query')).toBe(false)
    })
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ running: true, runningQueryId: 'running-query', cancelling: false })
    unmount()
    useEditorStore.setState({ tabs: [], activeTabId: null })
  })
})

describe('query execution snapshot', () => {
  it('keeps the executed SQL and context after the editor changes', async () => {
    useEditorStore.setState({ tabs: [{
      id: 'snapshot-tab', title: 'SQL', sql: 'SELECT * FROM original_items; SELECT 1',
      connectionId: 'source', database: 'app', schema: 'tenant_a',
    }] })
    useQueryResultStore.setState({ results: {}, explains: {}, sources: {} })
    vi.mocked(executeQuery).mockResolvedValueOnce({
      queryId: 'backend-query',
      connectionGeneration: 7,
      results: [{
        queryId: 'backend-query', columns: [{ name: 'id', dataType: 'INTEGER', nullable: false }],
        rows: [[1]], rowCount: 1, affectedRows: 0, elapsedMs: 1, truncated: false,
      }],
    })
    const { result, unmount } = renderHook(() => useQuery())

    await act(async () => {
      expect(await result.current.runQuery(
        'snapshot-tab',
        'source',
        'SELECT * FROM original_items; SELECT 1',
        { database: 'app', schema: 'tenant_a', maxRows: 25 },
      )).toBe(true)
    })
    expect(executeQuery).toHaveBeenCalledWith(expect.objectContaining({ maxRows: 25 }))
    const queryId = useEditorStore.getState().tabs[0].lastQueryId as string
    useEditorStore.getState().updateTabSql('snapshot-tab', 'SELECT * FROM edited_items')
    useEditorStore.getState().updateSqlTabContext('snapshot-tab', { schema: 'tenant_b' })

    expect(useQueryResultStore.getState().sources[queryId]).toMatchObject({
      queryId,
      sql: 'SELECT * FROM original_items; SELECT 1',
      connectionId: 'source',
      connectionGeneration: 7,
      database: 'app',
      schema: 'tenant_a',
      consoleId: null,
      transactionMode: 'auto',
    })
    unmount()
    useEditorStore.setState({ tabs: [], activeTabId: null })
  })
})

describe('EXPLAIN execution context', () => {
  it('passes the selected context and synchronizes the original manual transaction', async () => {
    useEditorStore.setState({ tabs: [{ id: 'plan-tab', title: 'SQL', sql: 'SELECT * FROM items', connectionId: 'source', transactionMode: 'manual', transactionPhase: 'active' }] })
    vi.mocked(explainQuery).mockRejectedValueOnce(new Error('invalid query'))
    vi.mocked(getConsoleTransactionState).mockResolvedValueOnce({ connectionId: 'source', consoleId: 'plan-tab', mode: 'manual', phase: 'failed' })
    const { result, unmount } = renderHook(() => useQuery())
    await act(async () => {
      await result.current.runExplain('plan-tab', 'source', 'SELECT * FROM items', { database: 'app', schema: 'tenant_a', consoleId: 'plan-tab' })
    })
    expect(explainQuery).toHaveBeenCalledWith('source', 'SELECT * FROM items', {
      database: 'app', schema: 'tenant_a', consoleId: 'plan-tab', queryId: expect.any(String),
    })
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ transactionMode: 'manual', transactionPhase: 'failed', running: false })
    unmount()
    useEditorStore.setState({ tabs: [], activeTabId: null })
  })
})

describe('DDL metadata refresh classification', () => {
  it('classifies structure-changing statements without classifying ordinary SQL', () => {
    expect(containsLikelyDdl('CREATE TABLE child_items (id INTEGER PRIMARY KEY)')).toBe(true)
    expect(containsLikelyDdl('ALTER TABLE child_items ADD COLUMN note TEXT')).toBe(true)
    expect(containsLikelyDdl('DROP TABLE child_items')).toBe(true)
    expect(containsLikelyDdl('RENAME TABLE child_items TO archived_items')).toBe(true)
    expect(containsLikelyDdl('TRUNCATE TABLE child_items')).toBe(true)
    expect(containsLikelyDdl('SELECT 1')).toBe(false)
    expect(containsLikelyDdl('/* comment */ CREATE\nTABLE items(id INT)')).toBe(true)
    expect(containsLikelyDdl('SELECT $$; DROP TABLE items;$$')).toBe(false)
    expect(containsLikelyDdl('UPDATE child_items SET parent_id = parent_id WHERE id = 1')).toBe(false)
  })
})

describe('query result statement classification', () => {
  it.each([
    ['WITH ids AS (SELECT id FROM source) UPDATE items SET value = 1', 'dml'],
    ['WITH ids AS (SELECT id FROM source) DELETE FROM items WHERE id IN (SELECT id FROM ids)', 'dml'],
    ['WITH RECURSIVE ids AS (SELECT 1) INSERT INTO items SELECT * FROM ids', 'dml'],
    ['WITH changed AS (UPDATE items SET value = 1 RETURNING id) SELECT * FROM changed', 'other'],
    ['CREATE TABLE items (id INTEGER)', 'ddl'],
    ['COMMIT', 'commit'],
    ['ROLLBACK', 'rollback'],
  ] as const)('classifies %s as %s', (sql, kind) => {
    expect(classifyStatement(sql)).toBe(kind)
  })
})
