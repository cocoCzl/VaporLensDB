import { invokeCommand } from '@/ipc/client'
import type {
  ColumnInfo,
  DatabaseInfo,
  ForeignKeyInfo,
  IndexInfo,
  SchemaInfo,
  TableInfo,
} from '@/types/metadata'

export function getDatabases(connectionId: string) {
  return invokeCommand<DatabaseInfo[]>('get_databases', { connectionId })
}

export function getSchemas(connectionId: string, database?: string | null) {
  return invokeCommand<SchemaInfo[]>('get_schemas', { connectionId, database })
}

export function getTables(connectionId: string, schema: string) {
  return invokeCommand<TableInfo[]>('get_tables', { connectionId, schema })
}

export function getColumns(connectionId: string, schema: string, table: string) {
  return invokeCommand<ColumnInfo[]>('get_columns', { connectionId, schema, table })
}

export function getIndexes(connectionId: string, schema: string, table: string) {
  return invokeCommand<IndexInfo[]>('get_indexes', { connectionId, schema, table })
}

export function getForeignKeys(connectionId: string, schema: string, table: string) {
  return invokeCommand<ForeignKeyInfo[]>('get_foreign_keys', { connectionId, schema, table })
}

export function getViews(connectionId: string, schema: string) {
  return invokeCommand<TableInfo[]>('get_views', { connectionId, schema })
}

export function getFunctions(connectionId: string, schema: string) {
  return invokeCommand<string[]>('get_functions', { connectionId, schema })
}

export function getTableDdl(connectionId: string, schema: string, table: string) {
  return invokeCommand<string>('get_table_ddl', { connectionId, schema, table })
}
