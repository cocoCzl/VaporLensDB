import { invokeCommand } from '@/ipc/client'
import { COMMANDS } from '@/ipc/contracts'

export interface HealthCheckResponse {
  status: 'ok'
  app: string
  version: string
  configPath: string
  configSchemaVersion: number
  passwordStorage: string
  keyBackend: string
}

export function healthCheck() {
  return invokeCommand<HealthCheckResponse>(COMMANDS.healthCheck)
}
