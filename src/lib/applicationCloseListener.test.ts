import { beforeEach, describe, expect, it, vi } from 'vitest'
import { subscribeApplicationCloseRequests } from '@/lib/applicationCloseListener'

const mocks = vi.hoisted(() => ({ listen: vi.fn(), ready: vi.fn(), finished: vi.fn(), close: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }))
vi.mock('@/ipc/lifecycle', () => ({ applicationCloseListenerReady: mocks.ready, applicationCloseRequestFinished: mocks.finished }))
vi.mock('@/lib/applicationClose', () => ({ requestApplicationClose: mocks.close }))

describe('application close listener handshake', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.ready.mockResolvedValue(undefined)
    mocks.finished.mockResolvedValue(undefined)
    mocks.close.mockResolvedValue(false)
  })

  it('signals ready only after native listener registration resolves', async () => {
    let registered: ((dispose: () => void) => void) | undefined
    mocks.listen.mockImplementation(() => new Promise((resolve) => { registered = resolve }))
    const dispose = vi.fn()
    const unsubscribe = subscribeApplicationCloseRequests()
    expect(mocks.listen).toHaveBeenCalledWith('vaporlensdb:request-application-close', expect.any(Function))
    expect(mocks.ready).not.toHaveBeenCalled()
    registered?.(dispose)
    await vi.waitFor(() => expect(mocks.ready).toHaveBeenCalledOnce())
    unsubscribe()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('does not signal ready for a listener disposed before registration finishes', async () => {
    let registered: ((dispose: () => void) => void) | undefined
    mocks.listen.mockImplementation(() => new Promise((resolve) => { registered = resolve }))
    const dispose = vi.fn()
    subscribeApplicationCloseRequests()()
    registered?.(dispose)
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce())
    expect(mocks.ready).not.toHaveBeenCalled()
  })

  it('handles pending replay during the ready handshake and acknowledges cancelled close', async () => {
    let callback: (() => void) | undefined
    mocks.listen.mockImplementation((_event, listener) => {
      callback = listener
      return Promise.resolve(vi.fn())
    })
    mocks.ready.mockImplementation(async () => { callback?.() })
    const unsubscribe = subscribeApplicationCloseRequests()
    await vi.waitFor(() => expect(mocks.finished).toHaveBeenCalledOnce())
    expect(mocks.close).toHaveBeenCalledOnce()
    unsubscribe()
  })

  it('acknowledges a failed workflow so a later Quit can retry', async () => {
    let callback: (() => void) | undefined
    mocks.listen.mockImplementation((_event, listener) => {
      callback = listener
      return Promise.resolve(vi.fn())
    })
    mocks.close.mockRejectedValueOnce(new Error('close failed'))
    const unsubscribe = subscribeApplicationCloseRequests()
    await vi.waitFor(() => expect(mocks.ready).toHaveBeenCalledOnce())
    callback?.()
    await vi.waitFor(() => expect(mocks.finished).toHaveBeenCalledOnce())
    callback?.()
    await vi.waitFor(() => expect(mocks.finished).toHaveBeenCalledTimes(2))
    expect(mocks.close).toHaveBeenCalledTimes(2)
    unsubscribe()
  })
})
