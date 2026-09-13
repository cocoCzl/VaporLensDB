import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ColumnInfo, ForeignKeyInfo, IndexInfo, MetadataSearchResult } from '@/types/metadata'

const metadataMocks = vi.hoisted(() => ({
  getColumns: vi.fn(),
  getDatabases: vi.fn(),
  getForeignKeys: vi.fn(),
  getIndexes: vi.fn(),
  searchMetadataIndex: vi.fn(),
}))

vi.mock('@/ipc/metadata', () => ({
  getColumns: metadataMocks.getColumns,
  getDatabases: metadataMocks.getDatabases,
  getForeignKeys: metadataMocks.getForeignKeys,
  getFunctions: vi.fn(),
  getIndexes: metadataMocks.getIndexes,
  getSchemaObjects: vi.fn(),
  getSchemas: vi.fn(),
  getTables: vi.fn(),
  getViews: vi.fn(),
  searchMetadataIndex: metadataMocks.searchMetadataIndex,
  startMetadataIndexTask: vi.fn(),
}))

import { useMetadataStore } from '@/stores/metadataStore'

function searchResult(name: string): MetadataSearchResult[] {
  return [{
    entry: {
      connectionId: 'connection-1',
      connectionName: 'Database',
      kind: 'table',
      name,
      path: [name],
    },
    score: 1,
  }]
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

describe('metadata store resource bounds', () => {
  beforeEach(() => {
    metadataMocks.getColumns.mockReset()
    metadataMocks.getDatabases.mockReset()
    metadataMocks.getForeignKeys.mockReset()
    metadataMocks.getIndexes.mockReset()
    metadataMocks.searchMetadataIndex.mockReset()
    useMetadataStore.setState({
      databases: {},
      columns: {},
      foreignKeys: {},
      indexes: {},
      indexResults: [],
      loading: {},
    })
  })

  it('keeps only the latest 256 frontend metadata cache keys', async () => {
    metadataMocks.getDatabases.mockImplementation(async (connectionId: string) => [{ name: connectionId }])

    for (let index = 0; index < 257; index += 1) {
      await useMetadataStore.getState().loadDatabases(`connection-${index}`)
    }

    const cache = useMetadataStore.getState().databases
    expect(Object.keys(cache)).toHaveLength(256)
    expect(cache['connection-0']).toBeUndefined()
    expect(cache['connection-256']).toEqual([{ name: 'connection-256' }])
  })

  it('does not let an older metadata search overwrite newer results', async () => {
    const older = deferred<MetadataSearchResult[]>()
    const newer = deferred<MetadataSearchResult[]>()
    metadataMocks.searchMetadataIndex
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise)

    const olderRequest = useMetadataStore.getState().searchIndex('old')
    const newerRequest = useMetadataStore.getState().searchIndex('new')
    newer.resolve(searchResult('new_table'))
    await newerRequest
    older.resolve(searchResult('old_table'))
    await olderRequest

    expect(useMetadataStore.getState().indexResults).toEqual(searchResult('new_table'))
  })

  it('keeps columns and foreign keys isolated when structure metadata loads concurrently', async () => {
    const childColumns: ColumnInfo[] = [
      { schema: 'main', table: 'child_items', name: 'id', ordinalPosition: 1, dataType: 'INTEGER', nullable: true, isPrimaryKey: true },
      { schema: 'main', table: 'child_items', name: 'parent_id', ordinalPosition: 2, dataType: 'INTEGER', nullable: true, isPrimaryKey: false },
    ]
    const childIndexes: IndexInfo[] = []
    const childForeignKeys: ForeignKeyInfo[] = [{
      schema: 'main',
      table: 'child_items',
      name: 'fk_child_items_0',
      columns: ['parent_id'],
      referencedSchema: 'main',
      referencedTable: 'parent_items',
      referencedColumns: ['id'],
    }]
    const parentColumns: ColumnInfo[] = [
      { schema: 'main', table: 'parent_items', name: 'id', ordinalPosition: 1, dataType: 'INTEGER', nullable: true, isPrimaryKey: true },
    ]

    metadataMocks.getColumns
      .mockResolvedValueOnce(childColumns)
      .mockResolvedValueOnce(parentColumns)
    metadataMocks.getIndexes.mockResolvedValue(childIndexes)
    metadataMocks.getForeignKeys
      .mockResolvedValueOnce(childForeignKeys)
      .mockResolvedValueOnce([])

    const store = useMetadataStore.getState()
    const [columns, indexes, foreignKeys] = await Promise.all([
      store.loadColumns('connection-1', 'main', 'child_items'),
      store.loadIndexes('connection-1', 'main', 'child_items'),
      store.loadForeignKeys('connection-1', 'main', 'child_items'),
    ])
    const [parentMetadata, parentForeignKeys] = await Promise.all([
      store.loadColumns('connection-1', 'main', 'parent_items'),
      store.loadForeignKeys('connection-1', 'main', 'parent_items'),
    ])

    expect(columns).toEqual(childColumns)
    expect(indexes).toEqual(childIndexes)
    expect(foreignKeys).toEqual(childForeignKeys)
    expect(parentMetadata).toEqual(parentColumns)
    expect(parentForeignKeys).toEqual([])
    expect(foreignKeys).not.toEqual(columns)
    expect(metadataMocks.getForeignKeys).toHaveBeenCalledWith('connection-1', 'main', 'child_items')
    expect(metadataMocks.getForeignKeys).toHaveBeenCalledWith('connection-1', 'main', 'parent_items')
  })
})
