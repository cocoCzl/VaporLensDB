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
  sql: string
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
  hasHeader?: boolean
  previewRows?: number
}

export interface ImportTableCsvInput {
  connectionId: string
  driverType: DriverType
  schema: string
  table: string
  path: string
  hasHeader?: boolean
  emptyAsNull?: boolean
}

export interface RowReport {
  rowNumber: number
  message: string
  values: string[]
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
