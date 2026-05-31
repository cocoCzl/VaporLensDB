import { invokeCommand } from '@/ipc/client'

export interface HealthCheckResponse {
  status: 'ok'
  app: string
  version: string
}

export function healthCheck() {
  return invokeCommand<HealthCheckResponse>('health_check')
}
