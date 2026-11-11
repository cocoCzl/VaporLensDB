import type { TFunction } from 'i18next'
import type { AppError } from '@/types/error'
import type { ConnectionInput } from '@/types/connection'

export function formatConnectionErrorDetail(error: AppError, input: ConnectionInput, t: TFunction) {
  const lines = [error.message, ...(error.detail?.split(/\r?\n|;\s*/).filter(Boolean) ?? [])]
  if (input.connectionMode !== 'urlOnly' && input.connectionMode !== 'file' && input.host?.trim()) {
    const endpoint = input.port ? `${input.host.trim()}:${input.port}` : input.host.trim()
    const driverIndex = lines.findIndex((line) => line.startsWith('driver='))
    lines.splice(driverIndex >= 0 ? driverIndex + 1 : 0, 0, `endpoint=${endpoint}`)
  }

  if (/no route to host/i.test(error.message)) {
    if (!lines.includes('phase=tcp_connect')) lines.push('phase=tcp_connect')
    if (!lines.includes('cause=no_route_to_host')) lines.push('cause=no_route_to_host')
    lines.push('', t('connectionForm.noRouteToHostHint'))
  }

  return lines.length ? lines.join('\n') : null
}
