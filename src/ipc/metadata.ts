import { invokeCommand } from '@/ipc/client'
import { COMMANDS } from '@/ipc/contracts'
import type {
  ColumnInfo,
  ClearMetadataIndexInput,
  DatabaseInfo,
  DbObjectInfo,
  DbObjectKind,
  ForeignKeyInfo,
  IndexInfo,
  MetadataSearchResult,
  SearchMetadataIndexInput,
  SchemaInfo,
  StartMetadataIndexInput,
  TableInfo,
} from '@/types/metadata'
import type { TaskInfo } from '@/types/task'

export function getDatabases(connectionId: string) {
  return invokeCommand<DatabaseInfo[]>(COMMANDS.getDatabases, { connectionId })
}

export function getSchemas(connectionId: string, database?: string | null) {
  return invokeCommand<SchemaInfo[]>(COMMANDS.getSchemas, { connectionId, database })
}

export function getTables(connectionId: string, schema: string) {
  return invokeCommand<TableInfo[]>(COMMANDS.getTables, { connectionId, schema })
}

export function getColumns(connectionId: string, schema: string, table: string) {
  return invokeCommand<ColumnInfo[]>(COMMANDS.getColumns, { connectionId, schema, table })
}

export function getIndexes(connectionId: string, schema: string, table: string) {
  return invokeCommand<IndexInfo[]>(COMMANDS.getIndexes, { connectionId, schema, table })
}

export function getForeignKeys(connectionId: string, schema: string, table: string) {
  return invokeCommand<ForeignKeyInfo[]>(COMMANDS.getForeignKeys, { connectionId, schema, table })
}

export function getViews(connectionId: string, schema: string) {
  return invokeCommand<TableInfo[]>(COMMANDS.getViews, { connectionId, schema })
}

export function getFunctions(connectionId: string, schema: string) {
  return invokeCommand<string[]>(COMMANDS.getFunctions, { connectionId, schema })
}

export function getTableDdl(connectionId: string, schema: string, table: string) {
  return invokeCommand<string>(COMMANDS.getTableDdl, { connectionId, schema, table })
}

export function getSchemaObjects(connectionId: string, schema: string, kind: DbObjectKind) {
  return invokeCommand<DbObjectInfo[]>(COMMANDS.getSchemaObjects, { connectionId, schema, kind })
}

export function getObjectDdl(
  connectionId: string,
  schema: string,
  name: string,
  kind: DbObjectKind,
) {
  return invokeCommand<string>(COMMANDS.getObjectDdl, { connectionId, schema, name, kind })
}

export function startMetadataIndexTask(input: StartMetadataIndexInput) {
  return invokeCommand<TaskInfo>(COMMANDS.startMetadataIndexTask, { input })
}

export function searchMetadataIndex(input: SearchMetadataIndexInput) {
  return invokeCommand<MetadataSearchResult[]>(COMMANDS.searchMetadataIndex, { input })
}

export function clearMetadataIndex(input?: ClearMetadataIndexInput) {
  return invokeCommand<void>(COMMANDS.clearMetadataIndex, { input })
}
