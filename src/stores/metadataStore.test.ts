import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MetadataSearchResult } from '@/types/metadata'

const metadataMocks = vi.hoisted(() => ({
  getDatabases: vi.fn(),
  searchMetadataIndex: vi.fn(),
}))

vi.mock('@/ipc/metadata', () => ({
  getColumns: vi.fn(),
  getDatabases: metadataMocks.getDatabases,
  getForeignKeys: vi.fn(),
  getFunctions: vi.fn(),
  getIndexes: vi.fn(),
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
    metadataMocks.getDatabases.mockReset()
    metadataMocks.searchMetadataIndex.mockReset()
    useMetadataStore.setState({ databases: {}, indexResults: [], loading: {} })
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
})
