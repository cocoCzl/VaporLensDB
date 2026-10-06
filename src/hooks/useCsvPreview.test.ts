import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCsvPreview } from '@/hooks/useCsvPreview'
import type { ImportPreview } from '@/ipc/export'

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  cancel: vi.fn(),
}))

vi.mock('@/ipc/export', () => ({ previewTableCsvImport: mocks.preview }))
vi.mock('@/ipc/task', () => ({ cancelTask: mocks.cancel }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function preview(path: string, cancelled = false): ImportPreview {
  return {
    path,
    headers: cancelled ? [] : ['id'],
    targetColumns: cancelled ? [] : ['id'],
    rows: cancelled ? [] : [['1']],
    totalRows: cancelled ? 0 : 1,
    validRows: cancelled ? 0 : 1,
    invalidRows: [],
    canImport: !cancelled,
    cancelled,
  }
}

const input = {
  connectionId: 'connection',
  schema: 'public',
  table: 'items',
  path: '/tmp/items.csv',
}

describe('useCsvPreview', () => {
  beforeEach(() => {
    mocks.preview.mockReset()
    mocks.cancel.mockReset()
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
  })

  it('sends a task id, cancels through cancel_task, and treats cancellation as a terminal result', async () => {
    const pendingPreview = deferred<ImportPreview>()
    const pendingCancel = deferred<unknown>()
    mocks.preview.mockReturnValue(pendingPreview.promise)
    mocks.cancel.mockReturnValue(pendingCancel.promise)
    const completed = vi.fn()
    const failed = vi.fn()
    const { result } = renderHook(() => useCsvPreview({ onCompleted: completed, onError: failed }))

    let request!: Promise<void>
    act(() => { request = result.current.start(input) })
    expect(result.current.status).toBe('loading')
    expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({
      taskId: '00000000-0000-4000-8000-000000000001',
    }))

    let cancellation!: Promise<void>
    act(() => { cancellation = result.current.cancel() })
    expect(result.current.status).toBe('cancelling')
    expect(mocks.cancel).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001')
    await act(async () => {
      pendingCancel.resolve(undefined)
      pendingPreview.resolve(preview(input.path, true))
      await Promise.all([request, cancellation])
    })
    expect(result.current.status).toBe('idle')
    expect(result.current.preview).toBeNull()
    expect(completed).not.toHaveBeenCalled()
    expect(failed).not.toHaveBeenCalled()
  })

  it('does not let an older preview completion overwrite a newer request', async () => {
    const first = deferred<ImportPreview>()
    const second = deferred<ImportPreview>()
    mocks.preview.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const completed = vi.fn()
    const { result } = renderHook(() => useCsvPreview({ onCompleted: completed, onError: vi.fn() }))

    let firstRequest!: Promise<void>
    let secondRequest!: Promise<void>
    act(() => { firstRequest = result.current.start({ ...input, path: 'first.csv' }) })
    act(() => { secondRequest = result.current.start({ ...input, path: 'second.csv' }) })
    await act(async () => {
      second.resolve(preview('second.csv'))
      await secondRequest
    })
    await act(async () => {
      first.resolve(preview('first.csv'))
      await firstRequest
    })
    expect(result.current.preview?.path).toBe('second.csv')
    expect(completed).toHaveBeenCalledTimes(1)
  })

  it('can start a new preview after a cancelled request', async () => {
    mocks.preview
      .mockResolvedValueOnce(preview('first.csv', true))
      .mockResolvedValueOnce(preview('second.csv'))
    const { result } = renderHook(() => useCsvPreview({ onCompleted: vi.fn(), onError: vi.fn() }))
    await act(() => result.current.start({ ...input, path: 'first.csv' }))
    await act(() => result.current.start({ ...input, path: 'second.csv' }))
    expect(result.current.preview?.path).toBe('second.csv')
    expect(mocks.preview).toHaveBeenCalledTimes(2)
  })

  it('returns to loading when the cancellation request fails so the task can be retried', async () => {
    const pendingPreview = deferred<ImportPreview>()
    mocks.preview.mockReturnValueOnce(pendingPreview.promise)
    mocks.cancel.mockRejectedValueOnce(new Error('cancel unavailable'))
    const failed = vi.fn()
    const { result } = renderHook(() => useCsvPreview({ onCompleted: vi.fn(), onError: failed }))

    let request!: Promise<void>
    act(() => { request = result.current.start(input) })
    await act(async () => { await result.current.cancel() })

    expect(result.current.status).toBe('loading')
    expect(failed).toHaveBeenCalledOnce()
    pendingPreview.resolve(preview(input.path, true))
    await act(async () => { await request })
    expect(result.current.status).toBe('idle')
  })
  it('invalidates an in-flight preview when options or file selection clear it', async () => {
    const pending = deferred<ImportPreview>()
    mocks.preview.mockReturnValueOnce(pending.promise)
    mocks.cancel.mockResolvedValue(undefined)
    const completed = vi.fn()
    const { result } = renderHook(() => useCsvPreview({ onCompleted: completed, onError: vi.fn() }))
    let request!: Promise<void>
    act(() => { request = result.current.start(input) })
    act(() => result.current.clear())
    await act(async () => { pending.resolve(preview(input.path)); await request })
    expect(result.current.preview).toBeNull()
    expect(result.current.status).toBe('idle')
    expect(completed).not.toHaveBeenCalled()
    expect(mocks.cancel).toHaveBeenCalledOnce()
  })

  it('removes previous successful preview while reparsing and after failure', async () => {
    mocks.preview.mockResolvedValueOnce(preview(input.path))
    const { result } = renderHook(() => useCsvPreview({ onCompleted: vi.fn(), onError: vi.fn() }))
    await act(() => result.current.start(input))
    const pending = deferred<ImportPreview>()
    mocks.preview.mockReturnValueOnce(pending.promise)
    let request!: Promise<void>
    act(() => { request = result.current.start({ ...input, delimiter: ';', hasHeader: false, emptyAsNull: false }) })
    expect(result.current.preview).toBeNull()
    await act(async () => { pending.reject(new Error('invalid UTF-8')); await request })
    expect(result.current.preview).toBeNull()
  })

})
