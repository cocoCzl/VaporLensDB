import { create } from 'zustand'
import i18n from '@/i18n'
import {
  getColumns,
  getDatabases,
  getForeignKeys,
  getFunctions,
  getIndexes,
  getSchemaObjects,
  getSchemas,
  getTables,
  getViews,
  searchMetadataIndex,
  startMetadataIndexTask,
} from '@/ipc/metadata'
import { normalizeAppError } from '@/ipc/client'
import { useTaskStore } from '@/stores/taskStore'
import { useUiStore } from '@/stores/uiStore'
import type {
  CatalogSchemaPath,
  ColumnInfo,
  DatabaseInfo,
  DbObjectInfo,
  DbObjectKind,
  ForeignKeyInfo,
  IndexInfo,
  MetadataSearchResult,
  SchemaInfo,
  TableInfo,
} from '@/types/metadata'

export interface MetadataState {
  databases: Record<string, DatabaseInfo[]>
  schemas: Record<string, SchemaInfo[]>
  tables: Record<string, TableInfo[]>
  views: Record<string, TableInfo[]>
  functions: Record<string, string[]>
  schemaObjects: Record<string, DbObjectInfo[]>
  columns: Record<string, ColumnInfo[]>
  indexes: Record<string, IndexInfo[]>
  foreignKeys: Record<string, ForeignKeyInfo[]>
  catalogSchemaPaths: Record<string, CatalogSchemaPath>
  /** Monotonic signal consumed by the object tree after out-of-band metadata changes. */
  connectionRefreshTokens: Record<string, number>
  indexResults: MetadataSearchResult[]
  loading: Record<string, boolean>
  indexLoading: boolean
  loadDatabases: (connectionId: string, force?: boolean) => Promise<DatabaseInfo[]>
  loadSchemas: (
    connectionId: string,
    database?: string | null,
    force?: boolean,
  ) => Promise<SchemaInfo[]>
  loadTables: (connectionId: string, schema: string, force?: boolean) => Promise<TableInfo[]>
  loadViews: (connectionId: string, schema: string, force?: boolean) => Promise<TableInfo[]>
  loadFunctions: (connectionId: string, schema: string, force?: boolean) => Promise<string[]>
  loadSchemaObjects: (
    connectionId: string,
    schema: string,
    kind: DbObjectKind,
    force?: boolean,
  ) => Promise<DbObjectInfo[]>
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
  setCatalogSchemaPath: (path: CatalogSchemaPath) => void
  requestConnectionRefresh: (connectionId: string) => void
  clearSchema: (connectionId: string, schema: string) => void
  clearSchemaObjectKind: (connectionId: string, schema: string, kind: DbObjectKind) => void
  startIndexing: (connectionId: string, force?: boolean) => Promise<void>
  searchIndex: (query: string, connectionId?: string | null) => Promise<MetadataSearchResult[]>
  clearConnection: (connectionId: string) => void
}

type MetadataSet = (
  partial:
    | Partial<MetadataState>
    | ((state: MetadataState) => Partial<MetadataState>),
) => void

interface PendingMetadataLoad {
  token: number
  promise: Promise<unknown>
}

const pendingLoads = new Map<string, PendingMetadataLoad>()
const MAX_FRONTEND_METADATA_KEYS = 256
let latestIndexSearch = 0
let nextLoadToken = 0
const connectionEpochs = new Map<string, number>()
let globalMetadataEpoch = 0

export const useMetadataStore = create<MetadataState>()((set, get) => ({
  databases: {},
  schemas: {},
  tables: {},
  views: {},
  functions: {},
  schemaObjects: {},
  columns: {},
  indexes: {},
  foreignKeys: {},
  catalogSchemaPaths: {},
  connectionRefreshTokens: {},
  indexResults: [],
  loading: {},
  indexLoading: false,

  loadDatabases: async (connectionId, force = false) => {
    const cacheKey = connectionId
    const cached = get().databases[cacheKey]
    if (!force && cached) return cached

    return withLoading(
      set,
      databaseLoadingKey(connectionId),
      force,
      () => getDatabases(connectionId),
      (databases) => set((state) => ({ databases: putBounded(state.databases, cacheKey, databases) })),
    )
  },

  loadSchemas: async (connectionId, database = null, force = false) => {
    const cacheKey = schemaKey(connectionId, database)
    const cached = get().schemas[cacheKey]
    if (!force && cached) return cached

    return withLoading(
      set,
      metadataLoadingKey(cacheKey, 'schemas'),
      force,
      () => getSchemas(connectionId, database),
      (schemas) => set((state) => ({ schemas: putBounded(state.schemas, cacheKey, schemas) })),
    )
  },

  loadTables: async (connectionId, schema, force = false) => {
    const cacheKey = schemaObjectKey(connectionId, schema)
    const cached = get().tables[cacheKey]
    if (!force && cached) return cached

    return withLoading(
      set,
      metadataLoadingKey(cacheKey, 'tables'),
      force,
      () => getTables(connectionId, schema),
      (tables) => set((state) => ({ tables: putBounded(state.tables, cacheKey, tables) })),
    )
  },

  loadViews: async (connectionId, schema, force = false) => {
    const cacheKey = schemaObjectKey(connectionId, schema)
    const cached = get().views[cacheKey]
    if (!force && cached) return cached

    return withLoading(
      set,
      metadataLoadingKey(cacheKey, 'views'),
      force,
      () => getViews(connectionId, schema),
      (views) => set((state) => ({ views: putBounded(state.views, cacheKey, views) })),
    )
  },

  loadFunctions: async (connectionId, schema, force = false) => {
    const cacheKey = schemaObjectKey(connectionId, schema)
    const cached = get().functions[cacheKey]
    if (!force && cached) return cached

    return withLoading(
      set,
      metadataLoadingKey(cacheKey, 'functions'),
      force,
      () => getFunctions(connectionId, schema),
      (functions) => set((state) => ({ functions: putBounded(state.functions, cacheKey, functions) })),
    )
  },

  loadSchemaObjects: async (connectionId, schema, kind, force = false) => {
    const cacheKey = schemaObjectKindKey(connectionId, schema, kind)
    const cached = get().schemaObjects[cacheKey]
    if (!force && cached) return cached

    return withLoading(
      set,
      metadataLoadingKey(cacheKey, 'schemaObjects'),
      force,
      () => getSchemaObjects(connectionId, schema, kind),
      (objects) => set((state) => ({ schemaObjects: putBounded(state.schemaObjects, cacheKey, objects) })),
    )
  },

  loadColumns: async (connectionId, schema, table, force = false) => {
    const cacheKey = tableObjectKey(connectionId, schema, table)
    const cached = get().columns[cacheKey]
    if (!force && cached) return cached

    return withLoading(
      set,
      metadataLoadingKey(cacheKey, 'columns'),
      force,
      () => getColumns(connectionId, schema, table),
      (columns) => set((state) => ({ columns: putBounded(state.columns, cacheKey, columns) })),
    )
  },

  loadIndexes: async (connectionId, schema, table, force = false) => {
    const cacheKey = tableObjectKey(connectionId, schema, table)
    const cached = get().indexes[cacheKey]
    if (!force && cached) return cached

    return withLoading(
      set,
      metadataLoadingKey(cacheKey, 'indexes'),
      force,
      () => getIndexes(connectionId, schema, table),
      (indexes) => set((state) => ({ indexes: putBounded(state.indexes, cacheKey, indexes) })),
    )
  },

  loadForeignKeys: async (connectionId, schema, table, force = false) => {
    const cacheKey = tableObjectKey(connectionId, schema, table)
    const cached = get().foreignKeys[cacheKey]
    if (!force && cached) return cached

    return withLoading(
      set,
      metadataLoadingKey(cacheKey, 'foreignKeys'),
      force,
      () => getForeignKeys(connectionId, schema, table),
      (foreignKeys) => set((state) => ({ foreignKeys: putBounded(state.foreignKeys, cacheKey, foreignKeys) })),
    )
  },

  setCatalogSchemaPath: (path) =>
    set((state) => ({
      catalogSchemaPaths: {
        ...state.catalogSchemaPaths,
        [path.connectionId]: path,
      },
    })),

  requestConnectionRefresh: (connectionId) =>
    set((state) => ({
      connectionRefreshTokens: {
        ...state.connectionRefreshTokens,
        [connectionId]: (state.connectionRefreshTokens[connectionId] ?? 0) + 1,
      },
    })),

  clearSchema: (connectionId, schema) => {
    const schemaPrefix = schemaObjectKey(connectionId, schema)
    invalidatePendingLoads(schemaPrefix)
    set((state) => {
      return {
        tables: omitByPrefix(state.tables, schemaPrefix),
        views: omitByPrefix(state.views, schemaPrefix),
        functions: omitByPrefix(state.functions, schemaPrefix),
        schemaObjects: omitByPrefix(state.schemaObjects, schemaPrefix),
        columns: omitByPrefix(state.columns, schemaPrefix),
        indexes: omitByPrefix(state.indexes, schemaPrefix),
        foreignKeys: omitByPrefix(state.foreignKeys, schemaPrefix),
        loading: omitByPrefix(state.loading, schemaPrefix),
      }
    })
  },

  clearSchemaObjectKind: (connectionId, schema, kind) => {
    const loadingKeys = [
      metadataLoadingKey(schemaObjectKindKey(connectionId, schema, kind), 'schemaObjects'),
    ]
    if (kind === 'table') {
      loadingKeys.push(metadataLoadingKey(schemaObjectKey(connectionId, schema), 'tables'))
    }
    if (kind === 'view' || kind === 'materializedView') {
      loadingKeys.push(metadataLoadingKey(schemaObjectKey(connectionId, schema), 'views'))
    }
    if (kind === 'function') {
      loadingKeys.push(metadataLoadingKey(schemaObjectKey(connectionId, schema), 'functions'))
    }
    loadingKeys.forEach(invalidatePendingLoad)
    set((state) => ({
      schemaObjects: omitByPrefix(state.schemaObjects, schemaObjectKindKey(connectionId, schema, kind)),
      tables:
        kind === 'table' ? omitByPrefix(state.tables, schemaObjectKey(connectionId, schema)) : state.tables,
      views:
        kind === 'view' || kind === 'materializedView'
          ? omitByPrefix(state.views, schemaObjectKey(connectionId, schema))
          : state.views,
      functions:
        kind === 'function'
          ? omitByPrefix(state.functions, schemaObjectKey(connectionId, schema))
          : state.functions,
      loading: omitKeys(state.loading, loadingKeys),
    }))
  },

  startIndexing: async (connectionId, force = true) => {
    set({ indexLoading: true })
    try {
      const task = await startMetadataIndexTask({ connectionId, force })
      useTaskStore.getState().upsertTask(task)
      useUiStore.getState().notify({
        kind: 'info',
        title: i18n.t('notifications.metadataIndexStarted'),
        message: task.title,
      })
    } catch (error) {
      useUiStore.getState().notifyError(normalizeAppError(error), i18n.t('notifications.startMetadataIndexFailed'))
      throw error
    } finally {
      set({ indexLoading: false })
    }
  },

  searchIndex: async (query, connectionId = null) => {
    const requestId = ++latestIndexSearch
    const searchEpoch = connectionId
      ? (connectionEpochs.get(connectionId) ?? 0)
      : globalMetadataEpoch
    const normalized = query.trim()
    if (normalized.length < 2) {
      set({ indexResults: [] })
      return []
    }

    try {
      const results = await searchMetadataIndex({ query: normalized, connectionId, limit: 40 })
      if (
        requestId !== latestIndexSearch
        || (connectionId
          ? (connectionEpochs.get(connectionId) ?? 0) !== searchEpoch
          : globalMetadataEpoch !== searchEpoch)
      ) return get().indexResults
      set({ indexResults: results })
      return results
    } catch (error) {
      useUiStore.getState().notifyError(normalizeAppError(error), i18n.t('notifications.searchMetadataIndexFailed'))
      throw error
    }
  },

  clearConnection: (connectionId) => {
    connectionEpochs.set(connectionId, (connectionEpochs.get(connectionId) ?? 0) + 1)
    globalMetadataEpoch += 1
    invalidatePendingLoads(connectionId)
    set((state) => ({
      databases: omitByPrefix(state.databases, connectionId),
      schemas: omitByPrefix(state.schemas, connectionId),
      tables: omitByPrefix(state.tables, connectionId),
      views: omitByPrefix(state.views, connectionId),
      functions: omitByPrefix(state.functions, connectionId),
      schemaObjects: omitByPrefix(state.schemaObjects, connectionId),
      columns: omitByPrefix(state.columns, connectionId),
      indexes: omitByPrefix(state.indexes, connectionId),
      foreignKeys: omitByPrefix(state.foreignKeys, connectionId),
      catalogSchemaPaths: omitByPrefix(state.catalogSchemaPaths, connectionId),
      connectionRefreshTokens: omitByPrefix(state.connectionRefreshTokens, connectionId),
      indexResults: state.indexResults.filter(
        (result) => result.entry.connectionId !== connectionId,
      ),
      loading: omitByPrefix(state.loading, connectionId),
    }))
  },
}))

export function schemaKey(connectionId: string, database?: string | null) {
  return `${connectionId}::database::${database ?? ''}::schemas`
}

export function schemaObjectKey(connectionId: string, schema: string) {
  return `${connectionId}::schema::${schema}`
}

export function schemaObjectKindKey(connectionId: string, schema: string, kind: DbObjectKind) {
  return `${connectionId}::schema::${schema}::objects::${kind}`
}

export function tableObjectKey(connectionId: string, schema: string, table: string) {
  return `${connectionId}::schema::${schema}::table::${table}`
}

function databaseLoadingKey(connectionId: string) {
  return `${connectionId}::databases`
}

function metadataLoadingKey(cacheKey: string, category: string) {
  return `${cacheKey}::${category}`
}

async function withLoading<T>(
  set: MetadataSet,
  key: string,
  force: boolean,
  task: () => Promise<T>,
  commit: (value: T) => void,
): Promise<T> {
  const pending = pendingLoads.get(key)
  if (!force && pending) return pending.promise as Promise<T>

  const token = ++nextLoadToken
  set((state) => ({ loading: { ...state.loading, [key]: true } }))
  const promise = Promise.resolve()
    .then(task)
    .then((value) => {
      if (pendingLoads.get(key)?.token !== token) {
        throw new MetadataLoadInvalidatedError()
      }
      commit(value)
      return value
    })
    .finally(() => {
      if (pendingLoads.get(key)?.token !== token) return
      pendingLoads.delete(key)
      set((state) => ({ loading: { ...state.loading, [key]: false } }))
    })
  pendingLoads.set(key, { token, promise })
  return promise
}

class MetadataLoadInvalidatedError extends Error {
  constructor() {
    super('metadata request was invalidated; retry the load')
    this.name = 'MetadataLoadInvalidatedError'
  }
}

function invalidatePendingLoad(key: string) {
  pendingLoads.delete(key)
}

function invalidatePendingLoads(prefix: string) {
  for (const key of pendingLoads.keys()) {
    if (key.startsWith(prefix)) pendingLoads.delete(key)
  }
}

function omitByPrefix<T>(record: Record<string, T>, prefix: string) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !key.startsWith(prefix)))
}

function omitKeys<T>(record: Record<string, T>, keys: string[]) {
  const omitted = new Set(keys)
  return Object.fromEntries(Object.entries(record).filter(([key]) => !omitted.has(key)))
}

function putBounded<T>(record: Record<string, T>, key: string, value: T) {
  const next = { ...record }
  delete next[key]
  next[key] = value
  const keys = Object.keys(next)
  for (const staleKey of keys.slice(0, Math.max(0, keys.length - MAX_FRONTEND_METADATA_KEYS))) {
    delete next[staleKey]
  }
  return next
}
