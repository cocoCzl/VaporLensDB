import { invokeCommand } from '@/ipc/client'
import { COMMANDS } from '@/ipc/contracts'
import type { QueryResult } from '@/types/query'

export interface ExportQueryResultCsvInput {
  result: QueryResult
  path: string
  includeHeader?: boolean
}

export interface ExportReport {
  path: string
  rowCount: number
  bytesWritten: number
}

export function exportQueryResultCsv(input: ExportQueryResultCsvInput) {
  return invokeCommand<ExportReport>(COMMANDS.exportQueryResultCsv, { input })
}
