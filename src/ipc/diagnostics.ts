import { invokeCommand } from '@/ipc/client'
import { COMMANDS } from '@/ipc/contracts'

export interface ExportDiagnosticsPackageInput {
  outputPath: string
  includeSqlText?: boolean
}

export interface ExportDiagnosticsPackageResponse {
  path: string
  generatedAt: string
  includedSqlText: boolean
  connectionCount: number
  failedQueryCount: number
  taskCount: number
}

export function exportDiagnosticsPackage(input: ExportDiagnosticsPackageInput) {
  return invokeCommand<ExportDiagnosticsPackageResponse>(COMMANDS.exportDiagnosticsPackage, {
    input,
  })
}
