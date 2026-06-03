import { invokeCommand } from '@/ipc/client'
import { COMMANDS } from '@/ipc/contracts'
import type {
  DriverDefinition,
  ExternalDriverValidation,
  ValidateExternalDriverInput,
} from '@/types/driver'

export function listDriverDefinitions() {
  return invokeCommand<DriverDefinition[]>(COMMANDS.listDriverDefinitions)
}

export function validateExternalDriver(input: ValidateExternalDriverInput) {
  return invokeCommand<ExternalDriverValidation>(COMMANDS.validateExternalDriver, { input })
}
