import { describe, expect, it } from 'vitest'
import { captureResultExport } from '@/lib/resultExport'
import type { QueryResult } from '@/types/query'

describe('result export snapshot', () => {
  it('preserves the selected result while streaming and editor changes continue', () => {
    const result: QueryResult = {
      columns: [{ name: 'id', dataType: 'bigint', nullable: true }],
      rows: [['9007199254740993'], [null]], rowCount: 2,
      elapsedMs: 1, affectedRows: 0, truncated: true, displayTruncated: true,
    }
    const snapshot = captureResultExport(result)
    // The stream store deliberately mutates its backing rows array.
    result.rows.push(['new row'])
    result.rows[0][0] = 'modified'
    result.columns[0].name = 'other column'
    result.rowCount = 3
    expect(snapshot.rows).toEqual([['9007199254740993'], [null]])
    expect(snapshot.columns[0].name).toBe('id')
    expect(snapshot.rowCount).toBe(2)
    expect(snapshot.displayTruncated).toBe(true)
    expect(snapshot).not.toHaveProperty('sql')
    expect(snapshot).not.toHaveProperty('connectionId')
  })
})
