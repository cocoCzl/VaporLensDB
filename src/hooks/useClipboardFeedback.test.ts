import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { copyToClipboard } from '@/lib/clipboard'
import { useClipboardFeedback } from './useClipboardFeedback'

vi.mock('@/lib/clipboard', () => ({ copyToClipboard: vi.fn() }))
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks() })

it('keeps success readable for three seconds and failure for six seconds', async () => {
  vi.useFakeTimers()
  const { result } = renderHook(useClipboardFeedback)
  vi.mocked(copyToClipboard).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
  await act(async () => { await result.current.copy('cell') })
  act(() => { vi.advanceTimersByTime(2999) })
  expect(result.current.feedback).toBe('success')
  act(() => { vi.advanceTimersByTime(1) })
  expect(result.current.feedback).toBeNull()
  await act(async () => { await result.current.copy('cell') })
  act(() => { vi.advanceTimersByTime(5999) })
  expect(result.current.feedback).toBe('failure')
  act(() => { vi.advanceTimersByTime(1) })
  expect(result.current.feedback).toBeNull()
})

it('ignores an older copy completion and clears the prior expiry on retry', async () => {
  vi.useFakeTimers()
  let finishOld!: (success: boolean) => void
  vi.mocked(copyToClipboard)
    .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    .mockResolvedValueOnce(false)
  const { result } = renderHook(useClipboardFeedback)
  let old!: Promise<void>
  act(() => { old = result.current.copy('old') })
  await act(async () => { await result.current.copy('new') })
  await act(async () => { finishOld(true); await old })
  expect(result.current.feedback).toBe('failure')
  act(() => { vi.advanceTimersByTime(3000) })
  expect(result.current.feedback).toBe('failure')
})

it('does not schedule feedback expiry after the result is closed', async () => {
  vi.useFakeTimers()
  let finish!: (success: boolean) => void
  vi.mocked(copyToClipboard).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const { result, unmount } = renderHook(useClipboardFeedback)
  let copy!: Promise<void>
  act(() => { copy = result.current.copy('cell') })
  unmount()
  await act(async () => { finish(true); await copy })
  expect(vi.getTimerCount()).toBe(0)
})
