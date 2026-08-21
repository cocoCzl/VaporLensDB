import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorStore } from '@/stores/editorStore'
import { useQueryResultStore } from '@/stores/queryResultStore'
import type { QueryResult } from '@/types/query'

function result(queryId: string): QueryResult {
  return {
    queryId,
    columns: [],
    rows: [],
    rowCount: 0,
    affectedRows: 0,
    elapsedMs: 0,
    truncated: false,
    maxRows: 10_000,
  }
}

describe('query result lifecycle', () => {
  beforeEach(() => {
    useQueryResultStore.setState({ results: {}, explains: {}, sources: {} })
    useEditorStore.setState({
      tabs: [{ id: 'tab-1', kind: 'sql', title: 'SQL', sql: 'select 1', connectionId: 'connection-1' }],
      activeTabId: 'tab-1',
    })
  })

  it('releases the previous result when a tab starts another query', () => {
    useQueryResultStore.getState().setResults('old-query', [result('old-query')])
    useEditorStore.setState((state) => ({
      tabs: state.tabs.map((tab) => ({ ...tab, lastQueryId: 'old-query' })),
    }))

    useEditorStore.getState().setTabRunning('tab-1', true, 'new-query')

    expect(useQueryResultStore.getState().results['old-query']).toBeUndefined()
    expect(useEditorStore.getState().tabs[0].lastQueryId).toBe('new-query')
  })

  it('keeps a global fallback budget for orphaned query results', () => {
    for (let index = 0; index < 25; index += 1) {
      const queryId = `query-${index}`
      useQueryResultStore.getState().setResults(queryId, [result(queryId)])
    }

    const retained = Object.keys(useQueryResultStore.getState().results)
    expect(retained).toHaveLength(20)
    expect(retained).not.toContain('query-0')
    expect(retained).toContain('query-24')
  })
})
