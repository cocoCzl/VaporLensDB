import { describe, expect, it } from 'vitest'
import { persistSqlWorkspace, type EditorTab } from '@/stores/editorStore'

const storageKey = 'vaporlensdb.sqlWorkspace.v1'

describe('SQL workspace persistence', () => {
  it('stores only restorable SQL state and selects a valid active tab', () => {
    const tabs: EditorTab[] = [
      {
        id: 'sql-1',
        kind: 'sql',
        title: 'Analysis',
        sql: 'select 1',
        connectionId: 'connection-1',
        draftId: 'draft-1',
        dirty: true,
        pinned: true,
        running: true,
        runningQueryId: 'running-query',
        lastQueryId: 'previous-query',
        error: 'transient error',
      },
      {
        id: 'data-1',
        kind: 'data',
        title: 'Rows',
        sql: 'select * from users',
        connectionId: 'connection-1',
      },
    ]

    persistSqlWorkspace(tabs, 'data-1')

    const stored = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}')
    expect(stored.activeTabId).toBe('sql-1')
    expect(stored.tabs).toEqual([
      {
        id: 'sql-1',
        kind: 'sql',
        title: 'Analysis',
        sql: 'select 1',
        connectionId: 'connection-1',
        draftId: 'draft-1',
        dirty: true,
        pinned: true,
        unavailableConnectionName: null,
      },
    ])
  })
})
