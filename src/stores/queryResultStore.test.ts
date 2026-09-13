import { beforeEach, describe, expect, it } from 'vitest'
import { useQueryResultStore } from '@/stores/queryResultStore'

describe('stream result completion', () => {
  beforeEach(() => {
    useQueryResultStore.setState({ results: {}, explains: {}, sources: {} })
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
})
