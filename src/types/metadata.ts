export interface DatabaseInfo {
  name: string
}

export interface SchemaInfo {
  name: string
  database?: string | null
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
