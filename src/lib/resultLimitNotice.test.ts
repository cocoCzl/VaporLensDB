import { describe, expect, it } from 'vitest'
import i18n from '@/i18n'
import { resultLimitNotice } from './resultLimitNotice'
import type { QueryResult } from '@/types/query'

const result: QueryResult = { columns: [], rows: [[1], [2]], rowCount: 1000, elapsedMs: 1, affectedRows: 0, truncated: false, maxRows: 5000, displayTruncated: true, displayLimitReason: 'bytes' }
describe('result retention explanation', () => {
  it.each(['en', 'zh'])('uses %s result translations and distinguishes retained, received and query limit', async language => {
    await i18n.changeLanguage(language)
    const text = resultLimitNotice(result, i18n.t.bind(i18n))!
    expect(text).toContain('2')
    expect(text).toContain('1000')
    expect(text).toContain('4 MiB')
    expect(text).not.toContain('5000')
    expect(text).not.toMatch(/workbench\.|result\./)
    const capped = resultLimitNotice({ ...result, truncated: true }, i18n.t.bind(i18n))!
    expect(capped).toContain('5000')
    expect(capped).toContain(i18n.t('result.totalUnknown'))
  })
  it('does not infer bytes from a legacy boolean, invent a max, or warn for a complete normal table', () => {
    const unknown = resultLimitNotice({ ...result, displayTruncated: false, truncated: true, maxRows: null }, i18n.t.bind(i18n))!
    expect(unknown).toContain(i18n.t('result.queryLimitReasonUnknown'))
    expect(unknown).not.toContain('4 MiB')
    expect(resultLimitNotice({ ...result, displayTruncated: false }, i18n.t.bind(i18n))).toBeNull()
  })
})
