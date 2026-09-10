import { describe, expect, it } from 'vitest'
import { persistSqlWorkspace, readStoredSqlWorkspace, type EditorTab, useEditorStore } from '@/stores/editorStore'

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
        database: 'ORCLPDB1',
        schema: 'DEVELOP',
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
        database: 'ORCLPDB1',
        schema: 'DEVELOP',
        draftId: 'draft-1',
        dirty: true,
        pinned: true,
        unavailableConnectionName: null,
      },
    ])
  })

  it('switches a SQL tab atomically and never carries its schema to another data source', () => {
    useEditorStore.setState({
      tabs: [{
        id: 'oracle-tab',
        kind: 'sql',
        title: 'Oracle',
        sql: 'SELECT * FROM DEVELOP.META_DATA',
        connectionId: 'mysql-id',
        database: 'mysql_app',
        schema: 'mysql_app',
        transactionMode: 'manual',
        transactionPhase: 'active',
      }],
      activeTabId: 'oracle-tab',
    })

    useEditorStore.getState().updateTabConnection('oracle-tab', 'oracle-id', {
      database: 'ORCLPDB1',
      schema: null,
    })

    expect(useEditorStore.getState().tabs[0]).toMatchObject({
      connectionId: 'oracle-id',
      database: 'ORCLPDB1',
      schema: null,
      transactionMode: 'auto',
      transactionPhase: 'idle',
    })
  })

  it('restores a SQL tab with its own data-source context instead of any global selection', () => {
    window.localStorage.setItem(storageKey, JSON.stringify({
      activeTabId: 'oracle-tab',
      tabs: [{
        id: 'oracle-tab',
        kind: 'sql',
        title: 'Oracle workspace',
        sql: 'SELECT * FROM DEVELOP.META_DATA',
        connectionId: 'oracle-id',
        database: 'ORCLPDB1',
        schema: 'DEVELOP',
      }],
    }))

    expect(readStoredSqlWorkspace()).toMatchObject({
      activeTabId: 'oracle-tab',
      tabs: [{
        connectionId: 'oracle-id',
        database: 'ORCLPDB1',
        schema: 'DEVELOP',
      }],
    })
  })
})
