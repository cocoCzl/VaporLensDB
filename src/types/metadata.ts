export interface DatabaseInfo {
  name: string
}

export interface SchemaInfo {
  name: string
  database?: string | null
}

export interface CatalogSchemaPath {
  connectionId: string
  database: string | null
  schema: string | null
  schemaListAvailable: boolean
}

export type TableType =
  | 'table'
  | 'view'
  | 'materializedView'
  | 'systemTable'
  | { other: string }

export interface TableInfo {
  schema?: string | null
  name: string
  tableType: TableType
  rowCount?: number | null
}

export type DbObjectKind =
  | 'table'
  | 'view'
  | 'materializedView'
  | 'index'
  | 'procedure'
  | 'function'
  | 'package'
  | 'sequence'
  | 'trigger'
  | 'synonym'
  | 'event'

export interface DbObjectInfo {
  schema?: string | null
  name: string
  kind: DbObjectKind
  objectType?: string | null
  status?: string | null
}

export interface ColumnInfo {
  schema?: string | null
  table: string
  name: string
  ordinalPosition: number
  dataType: string
  nullable: boolean
  defaultValue?: string | null
  characterMaximumLength?: number | null
  numericPrecision?: number | null
  numericScale?: number | null
  isPrimaryKey: boolean
}

export interface IndexInfo {
  schema?: string | null
  table: string
  name: string
  columns: string[]
  unique: boolean
  definition?: string | null
}

export interface ForeignKeyInfo {
  schema?: string | null
  table: string
  name: string
  columns: string[]
  referencedSchema?: string | null
  referencedTable: string
  referencedColumns: string[]
}

export type MetadataIndexKind =
  | 'connection'
  | 'database'
  | 'schema'
  | 'table'
  | 'view'
  | 'function'
  | 'column'

export interface MetadataIndexEntry {
  connectionId: string
  connectionName: string
  kind: MetadataIndexKind
  name: string
  database?: string | null
  schema?: string | null
  table?: string | null
  path: string[]
}

export interface MetadataSearchResult {
  entry: MetadataIndexEntry
  score: number
}

export interface StartMetadataIndexInput {
  connectionId: string
  force?: boolean
}

export interface SearchMetadataIndexInput {
  query: string
  connectionId?: string | null
  limit?: number
}

export interface ClearMetadataIndexInput {
  connectionId?: string | null
}
