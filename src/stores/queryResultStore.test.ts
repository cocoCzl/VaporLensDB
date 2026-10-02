import { beforeEach, describe, expect, it } from 'vitest'
import { estimateRetainedRowBytes, MAX_RENDERED_RESULT_BYTES, useQueryResultStore } from '@/stores/queryResultStore'

describe('stream result completion', () => {
  beforeEach(() => {
    useQueryResultStore.setState({ results: {}, explains: {}, sources: {}, retainedBytes: {} })
  })

  it('marks a completed zero-row DDL stream as finished rather than receiving', () => {
    useQueryResultStore.getState().startStreamResult('ddl')
    useQueryResultStore.getState().finishStreamResult({
      queryId: 'ddl', rowCount: 0, affectedRows: 0, elapsedMs: 0,
      truncated: false, maxRows: 1_000, receivedBytes: 0,
    })

    expect(useQueryResultStore.getState().results.ddl[0]).toMatchObject({
      streaming: false, rowCount: 0, affectedRows: 0, elapsedMs: 0,
    })
  })

  it('keeps a newly started stream in receiving state until its terminal event', () => {
    useQueryResultStore.getState().startStreamResult('select')
    expect(useQueryResultStore.getState().results.select[0]?.streaming).toBe(true)
  })

  it('ignores chunks after completion instead of mutating a terminal result', () => {
    const store = useQueryResultStore.getState()
    store.startStreamResult('terminal')
    store.appendResultChunk({ queryId: 'terminal', columns: [], rows: [[1]], rowOffset: 0 })
    store.finishStreamResult({ queryId: 'terminal', rowCount: 1, affectedRows: 0, elapsedMs: 1, truncated: false, receivedBytes: 5 })
    const completed = useQueryResultStore.getState().results.terminal[0]
    store.appendResultChunk({ queryId: 'terminal', columns: [], rows: [[2]], rowOffset: 1 })
    expect(useQueryResultStore.getState().results.terminal[0]).toBe(completed)
    expect(completed.rows).toEqual([[1]])
  })

  it('failure preserves partial data and truncation flags and wins over late DONE', () => {
    const store = useQueryResultStore.getState()
    store.startStreamResult('failed')
    store.appendResultChunk({ queryId: 'failed', columns: [{ name: 'value', dataType: 'INTEGER', nullable: false }], rows: [[1]], rowOffset: 0 })
    const partial = useQueryResultStore.getState().results.failed[0]
    expect(store.failStreamResult('failed')).toBe(true)
    expect(store.failStreamResult('failed')).toBe(false)
    expect(store.finishStreamResult({ queryId: 'failed', rowCount: 99, affectedRows: 99, elapsedMs: 99, truncated: true, receivedBytes: 99 })).toBe(false)
    store.appendResultChunk({ queryId: 'failed', columns: [], rows: [[2]], rowOffset: 1 })
    store.startStreamResult('failed')
    const failed = useQueryResultStore.getState().results.failed[0]
    expect(failed).toMatchObject({ streaming: false, rows: [[1]], rowCount: 1, affectedRows: 0, truncated: false })
    expect(failed.rows).toBe(partial.rows)
    expect(failed.columns).toBe(partial.columns)
    expect(failed.displayTruncated).toBe(partial.displayTruncated)
  })

  it('DONE wins over late failure and repeated DONE', () => {
    const store = useQueryResultStore.getState()
    store.startStreamResult('done')
    const done = { queryId: 'done', rowCount: 0, affectedRows: 3, elapsedMs: 1, truncated: true, receivedBytes: 0 }
    expect(store.finishStreamResult(done)).toBe(true)
    expect(store.failStreamResult('done')).toBe(false)
    expect(store.finishStreamResult({ ...done, affectedRows: 99 })).toBe(false)
    expect(useQueryResultStore.getState().results.done[0]).toMatchObject({ streaming: false, affectedRows: 3, truncated: true })
  })

  it('does not resurrect cleared results through late events', () => {
    const store = useQueryResultStore.getState()
    store.startStreamResult('cleared')
    store.clearResult('cleared')
    store.appendResultChunk({ queryId: 'cleared', columns: [], rows: [[1]], rowOffset: 0 })
    expect(store.failStreamResult('cleared')).toBe(false)
    expect(store.finishStreamResult({ queryId: 'cleared', rowCount: 1, affectedRows: 0, elapsedMs: 1, truncated: false, receivedBytes: 5 })).toBe(false)
    expect(useQueryResultStore.getState().results.cleared).toBeUndefined()
  })

  it('caps retained bytes before the row window and leaves execution streaming', () => {
    const store = useQueryResultStore.getState()
    store.startStreamResult('bytes')
    const columns = [{ name: 'text', dataType: 'TEXT', nullable: false }]
    const rows = Array.from({ length: 100 }, () => ['x'.repeat(256 * 1024)])
    store.appendResultChunk({ queryId: 'bytes', columns, rows, rowOffset: 0 })
    const result = useQueryResultStore.getState().results.bytes[0]
    expect(result.rows.length).toBeLessThan(100)
    expect(result.rows.length).toBeGreaterThan(0)
    expect(result).toMatchObject({ columns, streaming: true, displayTruncated: true, truncated: false })
    store.finishStreamResult({ queryId: 'bytes', rowCount: 100, affectedRows: 0, elapsedMs: 1, receivedBytes: 100, truncated: false })
    expect(useQueryResultStore.getState().results.bytes[0]).toMatchObject({ rowCount: 100, streaming: false, truncated: false, displayTruncated: true })
    expect(useQueryResultStore.getState().retainedBytes.bytes).toBeLessThanOrEqual(MAX_RENDERED_RESULT_BYTES)
  })

  it('keeps small rows unchanged and computes only new incoming data', () => {
    const store = useQueryResultStore.getState()
    store.startStreamResult('small')
    store.appendResultChunk({ queryId: 'small', columns: [], rows: [[null, true, 7, 'ascii', ['\u4e2d'], { text: '😀' }]], rowOffset: 0 })
    const result = useQueryResultStore.getState().results.small[0]
    const original = result.rows
    expect(useQueryResultStore.getState().retainedBytes.small).toBe(estimateRetainedRowBytes(result.rows[0]))
    store.appendResultChunk({ queryId: 'small', columns: [], rows: [[false]], rowOffset: 1 })
    expect(useQueryResultStore.getState().results.small[0].rows).toBe(original)
    expect(useQueryResultStore.getState().retainedBytes.small).toBe(estimateRetainedRowBytes(original[0]) + estimateRetainedRowBytes([false]))
  })

  it('hits the row cap before bytes without claiming backend truncation', () => {
    const store = useQueryResultStore.getState()
    store.startStreamResult('rows')
    store.appendResultChunk({ queryId: 'rows', columns: [], rows: Array.from({ length: 10_001 }, () => [1]), rowOffset: 0 })
    expect(useQueryResultStore.getState().results.rows[0]).toMatchObject({ rowCount: 10_001, displayTruncated: true, truncated: false })
    expect(useQueryResultStore.getState().results.rows[0].rows).toHaveLength(10_000)
    expect(useQueryResultStore.getState().retainedBytes.rows).toBeLessThan(MAX_RENDERED_RESULT_BYTES)
  })

  it('retains columns and final statistics when one row exceeds the entire byte budget', () => {
    const store = useQueryResultStore.getState()
    store.startStreamResult('huge')
    const columns = [{ name: 'huge', dataType: 'TEXT', nullable: false }]
    store.appendResultChunk({ queryId: 'huge', columns, rows: [['x'.repeat(MAX_RENDERED_RESULT_BYTES)]], rowOffset: 0 })
    expect(useQueryResultStore.getState().retainedBytes.huge).toBe(0)
    store.appendResultChunk({ queryId: 'huge', columns: [], rows: [['small']], rowOffset: 1 })
    store.finishStreamResult({ queryId: 'huge', rowCount: 2, affectedRows: 0, elapsedMs: 7, truncated: false, receivedBytes: 100 })
    expect(useQueryResultStore.getState().results.huge[0]).toMatchObject({ columns, rows: [], rowCount: 2, elapsedMs: 7, displayTruncated: true, truncated: false, streaming: false })
    store.appendResultChunk({ queryId: 'huge', columns: [], rows: [['late']], rowOffset: 2 })
    expect(useQueryResultStore.getState().retainedBytes.huge).toBe(0)
  })

  it('accounts for Unicode and JSON structures using deterministic conservative sizes', () => {
    expect(estimateRetainedRowBytes(['A'])).toBe(42)
    expect(estimateRetainedRowBytes(['\u4e2d'])).toBe(43)
    expect(estimateRetainedRowBytes(['😀'])).toBe(44)
    expect(estimateRetainedRowBytes([null, true, 1])).toBe(56)
    expect(estimateRetainedRowBytes([[1, null]])).toBe(68)
    expect(estimateRetainedRowBytes([{ id: 1 }])).toBe(92)
  })

  it('releases byte bookkeeping when clearing or evicting results', () => {
    const store = useQueryResultStore.getState()
    for (let index = 0; index < 21; index += 1) {
      const queryId = `query-${index}`
      store.startStreamResult(queryId)
      store.appendResultChunk({ queryId, columns: [], rows: [[index]], rowOffset: 0 })
    }
    expect(Object.keys(useQueryResultStore.getState().retainedBytes)).toEqual(Object.keys(useQueryResultStore.getState().results))
    expect(useQueryResultStore.getState().retainedBytes['query-0']).toBeUndefined()
    expect(useQueryResultStore.getState().retainedBytes['query-20']).toBe(32)
    store.clearResult('query-20')
    expect(useQueryResultStore.getState().retainedBytes['query-20']).toBeUndefined()
  })

  it('isolates executions while sharing the byte cap across batch results', () => {
    const store = useQueryResultStore.getState()
    const result = { columns: [], rows: [['x'.repeat(1024 * 1024)]], rowCount: 1, affectedRows: 0, elapsedMs: 1, truncated: false }
    store.setResults('batch', [result, result, result])
    expect(useQueryResultStore.getState().results.batch.map((item) => item.rows.length)).toEqual([1, 0, 0])
    expect(useQueryResultStore.getState().results.batch[1]).toMatchObject({ displayTruncated: true, truncated: false, rowCount: 1 })
    store.startStreamResult('other')
    store.appendResultChunk({ queryId: 'other', columns: [], rows: [[1]], rowOffset: 0 })
    expect(useQueryResultStore.getState().retainedBytes.other).toBe(32)
    expect(useQueryResultStore.getState().retainedBytes.batch).toBe(estimateRetainedRowBytes(result.rows[0]))
    store.clearResult('batch')
    expect(useQueryResultStore.getState().retainedBytes.other).toBe(32)
  })
})
