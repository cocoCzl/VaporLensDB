import type { TFunction } from 'i18next'
import type { AppError } from '@/types/error'
import type { DriverDefinition } from '@/types/driver'

export function driverDisplayName(driver: Pick<DriverDefinition, 'id' | 'name' | 'builtIn'>, t: TFunction) {
  if (!driver.builtIn) return driver.name
  if (driver.id === 'oracle') return t('driverWorkflow.oracleName')
  if (driver.id === 'jdbc') return t('driverWorkflow.genericName')
  return driver.name
}

export function workflowErrorSummary(error: AppError, t: TFunction, context: 'connection' | 'driver' = 'driver') {
  const value = `${error.code} ${error.message}`
  // i18n-hardcoded-ok: classify backend diagnostics in either language.
  const reason = /checksum|sha-?256|digest|校验|摘要/i.test(value) ? 'checksum' // i18n-hardcoded-ok: backend diagnostic parsing
    : /java|jdk|jre/i.test(value) ? 'java'
    : /CONNECTION_FAILED|SSH_TUNNEL_FAILED|AUTH_ERROR|connection refused|no route|authentication|login failed/i.test(value) ? 'connection'
    : /download|https?|network|dns|timed? ?out|TIMEOUT/i.test(value) ? 'network'
    : context
  return t(`driverWorkflow.errors.${reason}`)
}


export function checksumSourceLabel(source: string, t: TFunction) {
  if (source === 'Maven Central publisher SHA-256') return t('jdbcDownload.checksumPublisher')
  if (source.startsWith('Official pgjdbc GitHub release API SHA-256')) return t('jdbcDownload.checksumPgjdbc', { tag: source.match(/\(([^)]+)\)/)?.[1] ?? '' })
  if (source.startsWith('Pinned SHA-256 of reviewed HTTPS artifact')) return t('jdbcDownload.checksumReviewed')
  return source
}
