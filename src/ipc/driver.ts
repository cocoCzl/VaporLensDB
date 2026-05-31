import { invokeCommand } from '@/ipc/client'
import type {
  DriverDefinition,
  ExternalDriverValidation,
  ValidateExternalDriverInput,
} from '@/types/driver'

export function listDriverDefinitions() {
  return invokeCommand<DriverDefinition[]>('list_driver_definitions')
}

export function validateExternalDriver(input: ValidateExternalDriverInput) {
  return invokeCommand<ExternalDriverValidation>('validate_external_driver', { input })
}
