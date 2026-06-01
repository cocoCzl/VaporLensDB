import { create } from 'zustand'
import {
  getColumns,
  getDatabases,
  getForeignKeys,
  getFunctions,
  getIndexes,
  getSchemas,
  getTables,
  getViews,
} from '@/ipc/metadata'
import type {
  ColumnInfo,
  DatabaseInfo,
  ForeignKeyInfo,
  IndexInfo,
  SchemaInfo,
  TableInfo,
} from '@/types/metadata'

export interface MetadataState {
  databases: Record<string, DatabaseInfo[]>
  schemas: Record<string, SchemaInfo[]>
  tables: Record<string, TableInfo[]>
  views: Record<string, TableInfo[]>
  functions: Record<string, string[]>
  columns: Record<string, ColumnInfo[]>
  indexes: Record<string, IndexInfo[]>
  foreignKeys: Record<string, ForeignKeyInfo[]>
  loading: Record<string, boolean>
  loadDatabases: (connectionId: string, force?: boolean) => Promise<DatabaseInfo[]>
  loadSchemas: (
    connectionId: string,
    database?: string | null,
    force?: boolean,
  ) => Promise<SchemaInfo[]>
  loadTables: (connectionId: string, schema: string, force?: boolean) => Promise<TableInfo[]>
  loadViews: (connectionId: string, schema: string, force?: boolean) => Promise<TableInfo[]>
  loadFunctions: (connectionId: string, schema: string, force?: boolean) => Promise<string[]>
  loadColumns: (
    connectionId: string,
    schema: string,
    table: string,
    force?: boolean,
  ) => Promise<ColumnInfo[]>
  loadIndexes: (
    connectionId: string,
    schema: string,
    table: string,
    force?: boolean,
  ) => Promise<IndexInfo[]>
  loadForeignKeys: (
    connectionId: string,
    schema: string,
    table: string,
    force?: boolean,
  ) => Promise<ForeignKeyInfo[]>
  clearConnection: (connectionId: string) => void
}

type MetadataSet = (
  partial:
    | Partial<MetadataState>
    | ((state: MetadataState) => Partial<MetadataState>),
) => void

const pendingLoads = new Map<string, Promise<unknown>>()

export const useMetadataStore = create<MetadataState>()((set, get) => ({
  databases: {},
  schemas: {},
  tables: {},
  views: {},
  functions: {},
  columns: {},
  indexes: {},
  foreignKeys: {},
  loading: {},

  loadDatabases: async (connectionId, force = false) => {
    const cacheKey = connectionId
    const cached = get().databases[cacheKey]
    if (!force && cached) return cached

    return withLoading(set, databaseLoadingKey(connectionId), async () => {
      const databases = await getDatabases(connectionId)
      set((state) => ({ databases: { ...state.databases, [cacheKey]: databases } }))
      return databases
    })
  },

  loadSchemas: async (connectionId, database = null, force = false) => {
    const cacheKey = schemaKey(connectionId, database)
    const cached = get().schemas[cacheKey]
    if (!force && cached) return cached

    return withLoading(set, cacheKey, async () => {
      const schemas = await getSchemas(connectionId, database)
      set((state) => ({ schemas: { ...state.schemas, [cacheKey]: schemas } }))
      return schemas
    })
  },

  loadTables: async (connectionId, schema, force = false) => {
    const cacheKey = schemaObjectKey(connectionId, schema)
    const cached = get().tables[cacheKey]
    if (!force && cached) return cached

    return withLoading(set, cacheKey, async () => {
      const tables = await getTables(connectionId, schema)
      set((state) => ({ tables: { ...state.tables, [cacheKey]: tables } }))
      return tables
    })
  },

  loadViews: async (connectionId, schema, force = false) => {
    const cacheKey = schemaObjectKey(connectionId, schema)
    const cached = get().views[cacheKey]
    if (!force && cached) return cached

    return withLoading(set, cacheKey, async () => {
      const views = await getViews(connectionId, schema)
      set((state) => ({ views: { ...state.views, [cacheKey]: views } }))
      return views
    })
  },

  loadFunctions: async (connectionId, schema, force = false) => {
    const cacheKey = schemaObjectKey(connectionId, schema)
    const cached = get().functions[cacheKey]
    if (!force && cached) return cached

    return withLoading(set, cacheKey, async () => {
      const functions = await getFunctions(connectionId, schema)
      set((state) => ({ functions: { ...state.functions, [cacheKey]: functions } }))
      return functions
    })
  },

  loadColumns: async (connectionId, schema, table, force = false) => {
    const cacheKey = tableObjectKey(connectionId, schema, table)
    const cached = get().columns[cacheKey]
    if (!force && cached) return cached

    return withLoading(set, cacheKey, async () => {
      const columns = await getColumns(connectionId, schema, table)
      set((state) => ({ columns: { ...state.columns, [cacheKey]: columns } }))
      return columns
    })
  },

  loadIndexes: async (connectionId, schema, table, force = false) => {
    const cacheKey = tableObjectKey(connectionId, schema, table)
    const cached = get().indexes[cacheKey]
    if (!force && cached) return cached

    return withLoading(set, cacheKey, async () => {
      const indexes = await getIndexes(connectionId, schema, table)
      set((state) => ({ indexes: { ...state.indexes, [cacheKey]: indexes } }))
      return indexes
    })
  },

  loadForeignKeys: async (connectionId, schema, table, force = false) => {
    const cacheKey = tableObjectKey(connectionId, schema, table)
    const cached = get().foreignKeys[cacheKey]
    if (!force && cached) return cached

    return withLoading(set, cacheKey, async () => {
      const foreignKeys = await getForeignKeys(connectionId, schema, table)
      set((state) => ({ foreignKeys: { ...state.foreignKeys, [cacheKey]: foreignKeys } }))
      return foreignKeys
    })
  },

  clearConnection: (connectionId) =>
    set((state) => ({
      databases: omitByPrefix(state.databases, connectionId),
      schemas: omitByPrefix(state.schemas, connectionId),
      tables: omitByPrefix(state.tables, connectionId),
      views: omitByPrefix(state.views, connectionId),
      functions: omitByPrefix(state.functions, connectionId),
      columns: omitByPrefix(state.columns, connectionId),
      indexes: omitByPrefix(state.indexes, connectionId),
      foreignKeys: omitByPrefix(state.foreignKeys, connectionId),
      loading: omitByPrefix(state.loading, connectionId),
    })),
}))

export function schemaKey(connectionId: string, database?: string | null) {
  return `${connectionId}::database::${database ?? ''}::schemas`
}

export function schemaObjectKey(connectionId: string, schema: string) {
  return `${connectionId}::schema::${schema}`
}

export function tableObjectKey(connectionId: string, schema: string, table: string) {
  return `${connectionId}::schema::${schema}::table::${table}`
}

function databaseLoadingKey(connectionId: string) {
  return `${connectionId}::databases`
}

async function withLoading<T>(
  set: MetadataSet,
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  const pending = pendingLoads.get(key) as Promise<T> | undefined
  if (pending) return pending

  set((state) => ({ loading: { ...state.loading, [key]: true } }))
  const promise = task().finally(() => {
    pendingLoads.delete(key)
    set((state) => ({ loading: { ...state.loading, [key]: false } }))
  })
  pendingLoads.set(key, promise)
  return promise
}

function omitByPrefix<T>(record: Record<string, T>, prefix: string) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !key.startsWith(prefix)))
}
