import { invokeCommand } from '@/ipc/client'
import { COMMANDS } from '@/ipc/contracts'
import type { DriverType } from '@/types/connection'
import type { QueryResult } from '@/types/query'
import type { TaskInfo } from '@/types/task'

export interface ExportQueryResultCsvInput {
  result: QueryResult
  path: string
  includeHeader?: boolean
}

export interface ExportQueryCsvInput {
  connectionId: string
  connectionGeneration: number
  sql: string
  database?: string | null
  schema?: string | null
  consoleId?: string | null
  path: string
  includeHeader?: boolean
}

export interface ExportTableCsvInput {
  connectionId: string
  driverType: DriverType
  schema: string
  table: string
  path: string
  includeHeader?: boolean
  maxRows?: number | null
}

export interface PreviewTableCsvImportInput {
  connectionId: string
  schema: string
  table: string
  path: string
  delimiter?: string
  mapping?: (string | null)[]
  hasHeader?: boolean
  emptyAsNull?: boolean
  sampleOnly?: boolean
  previewRows?: number
  taskId?: string
}

export interface ImportTableCsvInput {
  connectionId: string
  driverType: DriverType
  schema: string
  table: string
  path: string
  delimiter?: string
  mapping?: (string | null)[]
  hasHeader?: boolean
  emptyAsNull?: boolean
}

export interface RowReport {
  rowNumber: number
  message: string
}

export interface ImportPreview {
  path: string
  headers: string[]
  targetColumns: string[]
  rows: string[][]
  totalRows: number
  validRows: number
  invalidRows: RowReport[]
  canImport: boolean
  cancelled: boolean
  hasMore?: boolean
}

export function exportQueryResultCsv(input: ExportQueryResultCsvInput) {
  return invokeCommand<TaskInfo>(COMMANDS.exportQueryResultCsv, { input })
}

export function exportQueryCsv(input: ExportQueryCsvInput) {
  return invokeCommand<TaskInfo>(COMMANDS.exportQueryCsv, { input })
}

export function exportTableCsv(input: ExportTableCsvInput) {
  return invokeCommand<TaskInfo>(COMMANDS.exportTableCsv, { input })
}

export function previewTableCsvImport(input: PreviewTableCsvImportInput) {
  return invokeCommand<ImportPreview>(COMMANDS.previewTableCsvImport, { input })
}

export function importTableCsv(input: ImportTableCsvInput) {
  return invokeCommand<TaskInfo>(COMMANDS.importTableCsv, { input })
}

export interface CsvImportResult {
  insertedRows: number
  failedRows: number
  failures: RowReport[]
}

export function getCsvImportResult(taskId: string) {
  return invokeCommand<CsvImportResult | null>(COMMANDS.getCsvImportResult, { taskId })
}
