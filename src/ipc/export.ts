import { invokeCommand } from '@/ipc/client'
import { COMMANDS } from '@/ipc/contracts'
import type { QueryResult } from '@/types/query'
import type { TaskInfo } from '@/types/task'

export interface ExportQueryResultCsvInput {
  result: QueryResult
  path: string
  includeHeader?: boolean
}

export function exportQueryResultCsv(input: ExportQueryResultCsvInput) {
  return invokeCommand<TaskInfo>(COMMANDS.exportQueryResultCsv, { input })
}
