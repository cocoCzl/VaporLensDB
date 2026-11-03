import type { TFunction } from 'i18next'
import type { QueryResult } from '@/types/query'
import { MAX_RENDERED_RESULT_BYTES, MAX_RENDERED_RESULT_ROWS } from '@/stores/queryResultStore'

export function resultLimitNotice(result: QueryResult, t: TFunction): string | null {
  if (!result.displayTruncated && !result.truncated) return null
  const reasons: string[] = []
  if (result.displayTruncated) reasons.push(t(
    result.displayLimitReason === 'bytes' ? 'result.byteLimitReason' : result.displayLimitReason === 'rows' ? 'result.rowLimitReason' : 'result.visualLimitReason',
    { mib: MAX_RENDERED_RESULT_BYTES / (1024 * 1024), count: MAX_RENDERED_RESULT_ROWS },
  ))
  if (result.truncated) reasons.push(result.maxRows == null ? t('result.queryLimitReasonUnknown') : t('result.queryLimitReason', { count: result.maxRows }))
  const retained = t('result.visualResultLimitNotice', { count: result.rows.length, reason: reasons.join(' · ') })
  // rowCount is received rows, never COUNT(*) or the requested maximum.
  const received = t('result.receivedRowCount', { count: result.rowCount })
  return `${retained} · ${received}${result.truncated ? ` · ${t('result.totalUnknown')}` : ''}`
}
