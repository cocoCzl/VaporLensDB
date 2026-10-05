import { describe, expect, it, vi } from 'vitest'
import {
  persistSqlWorkspace,
  readStoredSqlWorkspace,
  subscribeSqlWorkspacePersistence,
  type EditorTab,
  useEditorStore,
} from '@/stores/editorStore'
import { useUiStore } from '@/stores/uiStore'

const storageKey = 'vaporlensdb.sqlWorkspace.v1'

describe('SQL workspace persistence', () => {
  it('distinguishes a cancellation request from a terminal cancellation confirmation', () => {
    useEditorStore.setState({ tabs: [{
      id: 'cancel-state', title: 'SQL', sql: 'select 1', connectionId: 'source',
      running: true, runningQueryId: 'query-1', cancelling: true,
    }] })

    useEditorStore.getState().setTabQueryState('cancel-state', 'query-1', 'cancelled')
    expect(useEditorStore.getState().tabs[0]).toMatchObject({
      running: false,
      cancelling: false,
      cancellationConfirmed: true,
    })

    useEditorStore.getState().setTabRunning('cancel-state', true, 'query-2')
    expect(useEditorStore.getState().tabs[0].cancellationConfirmed).toBe(false)
  })

  it('acknowledges a saved ID without marking newer SQL or context as saved', () => {
    useEditorStore.setState({ tabs: [{
      id: 'editing', title: 'SQL', sql: 'select 1', connectionId: null, dirty: true,
    }] })
    useEditorStore.getState().updateTabSql('editing', 'select 2')
    useEditorStore.getState().setTabDraft('editing', 'saved-id', 0)
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ dirty: true, draftId: 'saved-id' })
    useEditorStore.getState().setTabDraft('editing', 'saved-id', 1)
    expect(useEditorStore.getState().tabs[0].dirty).toBe(false)
    useEditorStore.getState().updateSqlTabContext('editing', { schema: 'other' })
    useEditorStore.getState().setTabDraft('editing', 'saved-id', 1)
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ dirty: true, draftRevision: 2 })
  })

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

  it('applies asynchronous transaction updates only to the original manual console', () => {
    useEditorStore.setState({ tabs: [
      {
        id: 'manual-tab', title: 'Manual', sql: 'SELECT 1', connectionId: 'connection-1',
        transactionMode: 'manual', transactionPhase: 'active',
      },
      {
        id: 'auto-tab', title: 'Auto', sql: 'SELECT 1', connectionId: 'connection-1',
        transactionMode: 'auto', transactionPhase: 'idle',
      },
    ] })

    useEditorStore.getState().syncConsoleTransactionState({
      connectionId: 'other-connection', consoleId: 'manual-tab', mode: 'manual', phase: 'failed',
    })
    useEditorStore.getState().syncConsoleTransactionState({
      connectionId: 'connection-1', consoleId: 'auto-tab', mode: 'manual', phase: 'failed',
    })
    expect(useEditorStore.getState().tabs).toMatchObject([
      { transactionMode: 'manual', transactionPhase: 'active' },
      { transactionMode: 'auto', transactionPhase: 'idle' },
    ])

    useEditorStore.getState().syncConsoleTransactionState({
      connectionId: 'connection-1', consoleId: 'manual-tab', mode: 'manual', phase: 'failed',
    })
    expect(useEditorStore.getState().tabs[0]).toMatchObject({
      transactionMode: 'manual', transactionPhase: 'failed',
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

  it('recovers from malformed workspace JSON without overwriting the source value', () => {
    window.localStorage.setItem(storageKey, '{not-json')

    expect(readStoredSqlWorkspace()).toEqual({ tabs: [], activeTabId: null })
    expect(window.localStorage.getItem(storageKey)).toBe('{not-json')
    persistSqlWorkspace([], null)
    expect(window.localStorage.getItem(storageKey)).toBe('{not-json')
  })

  it('preserves a corrupt workspace through the startup debounce until new valid edits', () => {
    vi.useFakeTimers()
    window.localStorage.setItem(storageKey, '{recoverable-source')
    useEditorStore.setState(readStoredSqlWorkspace())
    const unsubscribe = subscribeSqlWorkspacePersistence()
    try {
      vi.advanceTimersByTime(800)
      expect(window.localStorage.getItem(storageKey)).toBe('{recoverable-source')
      useEditorStore.getState().addTab({ id: 'new', title: 'SQL', sql: 'SELECT 1', connectionId: null })
      vi.advanceTimersByTime(800)
      expect(readStoredSqlWorkspace()).toMatchObject({ tabs: [{ id: 'new', sql: 'SELECT 1' }] })
    } finally {
      unsubscribe()
      vi.useRealTimers()
    }
  })

  it.each(['null', '[]', '{"tabs":{}}', '{"tabs":[null]}'])('preserves invalid workspace shape: %s', (value) => {
    window.localStorage.setItem(storageKey, value)
    const restored = readStoredSqlWorkspace()
    expect(restored).toEqual({ tabs: [], activeTabId: null })
    persistSqlWorkspace(restored.tabs, restored.activeTabId)
    expect(window.localStorage.getItem(storageKey)).toBe(value)
  })

  it('filters duplicate ids, blank ids, and non-SQL tabs without rewriting partial recovery', () => {
    const raw = JSON.stringify({ activeTabId: 'tab', tabs: [
      { id: 'tab', title: 'SQL', sql: 'SELECT 1' },
      { id: 'tab', title: 'Duplicate', sql: 'SELECT 2' },
      { id: '', title: 'Blank', sql: '' },
      { id: 'other', title: 'Other', kind: 'settings', sql: '' },
    ] })
    window.localStorage.setItem(storageKey, raw)
    const restored = readStoredSqlWorkspace()
    expect(restored.tabs).toHaveLength(1)
    persistSqlWorkspace(restored.tabs, restored.activeTabId)
    expect(window.localStorage.getItem(storageKey)).toBe(raw)
    persistSqlWorkspace(restored.tabs.map((tab) => ({ ...tab, unavailableConnectionName: 'Unavailable', draftId: 'native-draft' })), restored.activeTabId)
    expect(window.localStorage.getItem(storageKey)).toBe(raw)
  })

  it('filters invalid tabs and safely falls back from a stale active tab id', () => {
    window.localStorage.setItem(storageKey, JSON.stringify({
      activeTabId: 'missing',
      tabs: [
        null,
        { id: 'invalid', title: 'Invalid', sql: 42 },
        { id: 'valid', title: 'Valid', sql: 'SELECT 1', connectionId: 'deleted-connection' },
      ],
    }))

    expect(readStoredSqlWorkspace()).toMatchObject({
      activeTabId: 'valid',
      tabs: [{ id: 'valid', connectionId: 'deleted-connection', sql: 'SELECT 1' }],
    })
  })

  it('keeps the editor usable when workspace persistence fails', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })

    useUiStore.setState({ notifications: [] })
    useEditorStore.setState({ tabs: [{ id: 'tab', title: 'SQL', sql: 'SELECT 1', connectionId: null }], activeTabId: 'tab' })
    expect(() => persistSqlWorkspace(useEditorStore.getState().tabs, 'tab')).not.toThrow()
    useEditorStore.getState().updateTabSql('tab', 'SELECT 2')
    expect(() => persistSqlWorkspace(useEditorStore.getState().tabs, 'tab')).not.toThrow()
    expect(useEditorStore.getState().tabs[0].sql).toBe('SELECT 2')
    expect(useUiStore.getState().notifications).toHaveLength(1)
    setItem.mockRestore()
    persistSqlWorkspace(useEditorStore.getState().tabs, 'tab')
    expect(readStoredSqlWorkspace()).toMatchObject({ tabs: [{ sql: 'SELECT 2' }] })
  })

  it('keeps an empty open workspace tab ahead of a stale native draft and schedules cleanup', () => {
    window.localStorage.setItem(storageKey, JSON.stringify({
      activeTabId: 'cleared-tab',
      tabs: [{
        id: 'cleared-tab',
        kind: 'sql',
        title: 'Cleared SQL',
        sql: '',
        connectionId: 'connection-1',
        draftId: 'stale-native-draft',
        dirty: false,
      }],
    }))

    expect(readStoredSqlWorkspace()).toMatchObject({
      activeTabId: 'cleared-tab',
      tabs: [{
        sql: '',
        draftId: 'stale-native-draft',
        dirty: true,
      }],
    })
  })

  it('persists a completed clear for normal restart without resurrecting old SQL', () => {
    const tabs: EditorTab[] = [{
      id: 'cleared-tab',
      kind: 'sql',
      title: 'Cleared SQL',
      sql: '',
      connectionId: 'connection-1',
      draftId: null,
      dirty: false,
    }]

    persistSqlWorkspace(tabs, 'cleared-tab')

    expect(readStoredSqlWorkspace()).toMatchObject({
      tabs: [{ sql: '', draftId: null, dirty: false }],
    })
  })

  it('preserves a completed clear during pagehide-style abnormal recovery', () => {
    const tabs: EditorTab[] = [{
      id: 'cleared-tab',
      kind: 'sql',
      title: 'Cleared SQL',
      sql: '',
      connectionId: 'connection-1',
      draftId: null,
      dirty: false,
      pinned: true,
    }]

    // App pagehide uses this same synchronous localStorage persistence path.
    persistSqlWorkspace(tabs, 'cleared-tab')

    expect(readStoredSqlWorkspace()).toMatchObject({
      activeTabId: 'cleared-tab',
      tabs: [{ sql: '', draftId: null, dirty: false, pinned: true }],
    })
  })

  it('debounces store-driven persistence without requiring a React subscription', () => {
    vi.useFakeTimers()
    window.localStorage.removeItem(storageKey)
    useEditorStore.setState({
      tabs: [{ id: 'first', title: 'First', sql: 'SELECT 1', connectionId: null }],
      activeTabId: 'first',
    })

    const unsubscribe = subscribeSqlWorkspacePersistence(800)
    vi.advanceTimersByTime(700)
    useEditorStore.getState().updateTabSql('first', 'SELECT 2')
    vi.advanceTimersByTime(799)
    expect(window.localStorage.getItem(storageKey)).toBeNull()

    vi.advanceTimersByTime(1)
    expect(readStoredSqlWorkspace()).toMatchObject({
      activeTabId: 'first',
      tabs: [{ id: 'first', sql: 'SELECT 2' }],
    })

    window.localStorage.removeItem(storageKey)
    useEditorStore.getState().updateTabSql('first', 'SELECT 3')
    unsubscribe()
    vi.advanceTimersByTime(800)
    expect(window.localStorage.getItem(storageKey)).toBeNull()
    vi.useRealTimers()
  })
})
