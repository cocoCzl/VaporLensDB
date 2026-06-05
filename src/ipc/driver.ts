import { invokeCommand } from '@/ipc/client'
import { COMMANDS } from '@/ipc/contracts'
import type {
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

export function listSystemOdbcDrivers() {
  return invokeCommand<string[]>(COMMANDS.listSystemOdbcDrivers)
}

export function validateExternalDriver(input: ValidateExternalDriverInput) {
  return invokeCommand<ExternalDriverValidation>(COMMANDS.validateExternalDriver, { input })
}
