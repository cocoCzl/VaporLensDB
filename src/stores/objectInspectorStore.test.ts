import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ColumnInfo, ForeignKeyInfo, IndexInfo } from '@/types/metadata'

const getTableDdl = vi.hoisted(() => vi.fn())
vi.mock('@/ipc/metadata', () => ({ getTableDdl }))

import { useMetadataStore } from '@/stores/metadataStore'
import { useObjectInspectorStore } from '@/stores/objectInspectorStore'
import { useUiStore } from '@/stores/uiStore'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function fixture() {
  return {
    columns: deferred<ColumnInfo[]>(),
    indexes: deferred<IndexInfo[]>(),
    foreignKeys: deferred<ForeignKeyInfo[]>(),
    ddl: deferred<string>(),
  }
}

function configure(...fixtures: ReturnType<typeof fixture>[]) {
  const columns = vi.fn()
  const indexes = vi.fn()
  const foreignKeys = vi.fn()
  for (const source of fixtures) {
    columns.mockReturnValueOnce(source.columns.promise)
    indexes.mockReturnValueOnce(source.indexes.promise)
    foreignKeys.mockReturnValueOnce(source.foreignKeys.promise)
    getTableDdl.mockReturnValueOnce(source.ddl.promise)
  }
  useMetadataStore.setState({ loadColumns: columns, loadIndexes: indexes, loadForeignKeys: foreignKeys })
}

function complete(source: ReturnType<typeof fixture>, ddl: string) {
  source.columns.resolve([])
  source.indexes.resolve([])
  source.foreignKeys.resolve([])
  source.ddl.resolve(ddl)
}

const inspect = (table: string) => useObjectInspectorStore.getState().inspectTable('connection-1', 'public', table, 'table')

describe('object inspector request lifecycle', () => {
  beforeEach(() => {
    getTableDdl.mockReset()
    useObjectInspectorStore.getState().clear()
    useUiStore.setState({ notifyError: vi.fn() })
  })

  it('keeps the newest inspection when an older inspection resolves later', async () => {
    const firstFixture = fixture()
    const secondFixture = fixture()
    configure(firstFixture, secondFixture)
    const first = inspect('a')
    const second = inspect('b')
    complete(secondFixture, 'B')
    await second
    complete(firstFixture, 'A')
    await first
    expect(useObjectInspectorStore.getState().selected).toMatchObject({ table: 'b', ddl: 'B', loading: false })
  })

  it('does not notify or mutate the current selection for a stale error', async () => {
    const firstFixture = fixture()
    const secondFixture = fixture()
    configure(firstFixture, secondFixture)
    const first = inspect('a')
    const second = inspect('b')
    secondFixture.columns.reject(new Error('current request failed'))
    secondFixture.indexes.resolve([])
    secondFixture.foreignKeys.resolve([])
    secondFixture.ddl.resolve('B')
    await second
    const notifyError = vi.mocked(useUiStore.getState().notifyError)
    expect(notifyError).toHaveBeenCalledOnce()
    notifyError.mockClear()
    firstFixture.columns.resolve([])
    firstFixture.indexes.resolve([])
    firstFixture.foreignKeys.resolve([])
    firstFixture.ddl.reject(new Error('stale request failed'))
    await first
    expect(notifyError).not.toHaveBeenCalled()
    expect(useObjectInspectorStore.getState().selected).toMatchObject({ table: 'b', error: 'current request failed' })
  })

  it('clear invalidates an inspection that is still loading', async () => {
    const source = fixture()
    configure(source)
    const pending = inspect('a')
    useObjectInspectorStore.getState().clear()
    complete(source, 'A')
    await pending
    expect(useObjectInspectorStore.getState().selected).toBeNull()
  })

  it('same-object double refresh is token-based latest-wins', async () => {
    const firstFixture = fixture()
    const secondFixture = fixture()
    configure(firstFixture, secondFixture)
    const first = inspect('a')
    const second = inspect('a')
    complete(secondFixture, 'fresh DDL')
    await second
    complete(firstFixture, 'stale DDL')
    await first
    expect(useObjectInspectorStore.getState().selected).toMatchObject({ table: 'a', ddl: 'fresh DDL', loading: false })
  })

  it('B success followed by A error leaves B successful and emits no notification', async () => {
    const firstFixture = fixture()
    const secondFixture = fixture()
    configure(firstFixture, secondFixture)
    const first = inspect('a')
    const second = inspect('b')
    complete(secondFixture, 'B')
    await second
    firstFixture.indexes.reject(new Error('old indexes failure'))
    await first
    firstFixture.columns.resolve([])
    firstFixture.foreignKeys.resolve([])
    firstFixture.ddl.resolve('A')
    expect(useUiStore.getState().notifyError).not.toHaveBeenCalled()
    expect(useObjectInspectorStore.getState().selected).toMatchObject({ table: 'b', ddl: 'B', loading: false })
    expect(useObjectInspectorStore.getState().selected?.error).toBeUndefined()
  })

  it('a current Promise.all branch rejection enters error once and later branches do not overwrite it', async () => {
    const source = fixture()
    configure(source)
    const pending = inspect('a')
    source.foreignKeys.reject(new Error('permission denied'))
    await pending
    expect(useObjectInspectorStore.getState().selected).toMatchObject({ table: 'a', loading: false, error: 'permission denied' })
    expect(useUiStore.getState().notifyError).toHaveBeenCalledOnce()
    const failed = useObjectInspectorStore.getState().selected
    source.columns.resolve([])
    source.indexes.resolve([])
    source.ddl.resolve('late DDL')
    await Promise.resolve()
    expect(useObjectInspectorStore.getState().selected).toBe(failed)
  })

  it('an older rejection cannot stop a newer inspection from loading', async () => {
    const firstFixture = fixture()
    const secondFixture = fixture()
    configure(firstFixture, secondFixture)
    const first = inspect('a')
    const second = inspect('b')
    firstFixture.columns.reject(new Error('old columns failure'))
    await first
    expect(useObjectInspectorStore.getState().selected).toMatchObject({ table: 'b', loading: true })
    complete(firstFixture, 'late A')
    await Promise.resolve()
    expect(useObjectInspectorStore.getState().selected).toMatchObject({ table: 'b', loading: true })
    complete(secondFixture, 'B')
    await second
    expect(useUiStore.getState().notifyError).not.toHaveBeenCalled()
  })

  it('clear also suppresses a pending error and notification', async () => {
    const source = fixture()
    configure(source)
    const pending = inspect('a')
    useObjectInspectorStore.getState().clear()
    source.ddl.reject(new Error('closed inspector failure'))
    await pending
    source.columns.resolve([])
    source.indexes.resolve([])
    source.foreignKeys.resolve([])
    expect(useObjectInspectorStore.getState().selected).toBeNull()
    expect(useUiStore.getState().notifyError).not.toHaveBeenCalled()
  })

  it('identity validation prevents commits when selected identity no longer matches', async () => {
    const source = fixture()
    configure(source)
    const pending = inspect('a')
    useObjectInspectorStore.setState((state) => ({ selected: state.selected ? { ...state.selected, kind: 'view' } : null }))
    complete(source, 'table DDL')
    await pending
    expect(useObjectInspectorStore.getState().selected).toMatchObject({ kind: 'view', ddl: null })
  })
})
