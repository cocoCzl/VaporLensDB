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

export interface CredentialCleanupDiagnostic {
  connectionId: string
  status: 'pending' | 'cleaned' | 'retainedShared'
  diagnostic: string | null
  credentialAccount: string | null
  updatedAt: string
}

export function listCredentialCleanup() {
  return invokeCommand<CredentialCleanupDiagnostic[]>(COMMANDS.listCredentialCleanup)
}

export function retryCredentialCleanup(id: string) {
  return invokeCommand<void>(COMMANDS.retryCredentialCleanup, { id })
}
