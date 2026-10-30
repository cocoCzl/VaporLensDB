import { invokeCommand } from '@/ipc/client'
import { COMMANDS } from '@/ipc/contracts'
import type {
  DatabaseProduct,
  DriverInstallation,
  DriverDefinition,
  ExternalDriverValidation,
  ImportJdbcDriverArtifactsInput,
  RemoveJdbcDriverArtifactInput,
  ValidateExternalDriverInput,
} from '@/types/driver'

export function listDriverDefinitions() {
  return invokeCommand<DriverDefinition[]>(COMMANDS.listDriverDefinitions)
}

export function saveCustomDriverDefinition(input: DriverDefinition) {
  return invokeCommand<DriverDefinition>(COMMANDS.saveCustomDriverDefinition, { input })
}

export function deleteCustomDriverDefinition(id: string) {
  return invokeCommand<void>(COMMANDS.deleteCustomDriverDefinition, { id })
}

export function importJdbcDriverArtifacts(input: ImportJdbcDriverArtifactsInput) {
  return invokeCommand<DriverDefinition>(COMMANDS.importJdbcDriverArtifacts, { input })
}

export function removeJdbcDriverArtifact(input: RemoveJdbcDriverArtifactInput) {
  return invokeCommand<DriverDefinition>(COMMANDS.removeJdbcDriverArtifact, { input })
}

export function validateExternalDriver(input: ValidateExternalDriverInput) {
  return invokeCommand<ExternalDriverValidation>(COMMANDS.validateExternalDriver, { input })
}

export function listDatabaseProducts() { return invokeCommand<DatabaseProduct[]>(COMMANDS.listDatabaseProducts) }
export function saveDatabaseProduct(input: DatabaseProduct) { return invokeCommand<DatabaseProduct>(COMMANDS.saveDatabaseProduct, { input }) }
export function listDriverInstallations() { return invokeCommand<DriverInstallation[]>(COMMANDS.listDriverInstallations) }
export function deleteDriverInstallation(id: string) { return invokeCommand<void>(COMMANDS.deleteDriverInstallation, { id }) }

export function exportDriverConfiguration() { return invokeCommand<unknown>(COMMANDS.exportDriverConfiguration) }
export function importDriverConfiguration(input: unknown) { return invokeCommand<number>(COMMANDS.importDriverConfiguration, { input }) }

export function listJdbcDownloads() { return invokeCommand<import('@/types/driver').JdbcDownloadRecipe[]>(COMMANDS.listJdbcDownloads) }
export function downloadJdbcDriver(driverDefinitionId: string) { return invokeCommand<import('@/types/task').TaskInfo>(COMMANDS.downloadJdbcDriver, { driverDefinitionId }) }

export function checkJdbcRuntime() { return invokeCommand<void>(COMMANDS.checkJdbcRuntime) }
