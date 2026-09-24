import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { containsLikelyDdl, useQuery } from '@/hooks/useQuery'
import { useEditorStore } from '@/stores/editorStore'
import { useQueryResultStore } from '@/stores/queryResultStore'
import { cancelQuery, executeQuery, explainQuery, getConsoleTransactionState } from '@/ipc/query'

vi.mock('@/ipc/query', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/ipc/query')>(),
  cancelQuery: vi.fn(),
  executeQuery: vi.fn(),
  explainQuery: vi.fn(),
  getConsoleTransactionState: vi.fn(),
}))

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
