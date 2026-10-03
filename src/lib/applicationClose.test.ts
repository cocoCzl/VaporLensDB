import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requestApplicationClose } from '@/lib/applicationClose'
import { useEditorStore, type EditorTab } from '@/stores/editorStore'

const mocks = vi.hoisted(() => ({ closeTabs: vi.fn(), shutdown: vi.fn(), notifyError: vi.fn() }))
vi.mock('@/lib/closeEditorTab', () => ({ closeEditorTabs: mocks.closeTabs }))
vi.mock('@/ipc/lifecycle', () => ({ shutdownApplication: mocks.shutdown }))
vi.mock('@/stores/uiStore', () => ({ useUiStore: { getState: () => ({ notifyError: mocks.notifyError }) } }))

function tab(overrides: Partial<EditorTab> = {}): EditorTab {
  return { id: 'tab', kind: 'sql', title: 'SQL', sql: 'SELECT 1', connectionId: 'source', dirty: true, ...overrides }
}

describe('application close', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mocks.closeTabs.mockResolvedValue(true)
    mocks.shutdown.mockResolvedValue(undefined)
    useEditorStore.setState({ tabs: [tab()], activeTabId: 'tab' })
  })

  it('confirms dirty drafts and transactions before closing every tab and shutting down', async () => {
    useEditorStore.setState({ tabs: [
      tab(),
      tab({ id: 'failed', dirty: false, transactionMode: 'manual', transactionPhase: 'failed' }),
    ] })

    expect(await requestApplicationClose()).toBe(true)
    expect(window.confirm).toHaveBeenCalledOnce()
    expect(mocks.closeTabs).toHaveBeenCalledWith(['tab', 'failed'], { confirmTransaction: false })
    expect(mocks.shutdown).toHaveBeenCalledOnce()
  })

  it('keeps the application open when confirmation or tab cleanup is cancelled', async () => {
    vi.mocked(window.confirm).mockReturnValueOnce(false)
    expect(await requestApplicationClose()).toBe(false)
    expect(mocks.closeTabs).not.toHaveBeenCalled()
    expect(mocks.shutdown).not.toHaveBeenCalled()

    vi.mocked(window.confirm).mockReturnValueOnce(true)
    mocks.closeTabs.mockResolvedValueOnce(false)
    expect(await requestApplicationClose()).toBe(false)
    expect(mocks.shutdown).not.toHaveBeenCalled()
  })

  it('shares one in-flight shutdown request', async () => {
    let resolveShutdown: (() => void) | undefined
    mocks.shutdown.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveShutdown = resolve
    }))

    const first = requestApplicationClose()
    const second = requestApplicationClose()

    expect(second).toBe(first)
    await Promise.resolve()
    expect(mocks.shutdown).toHaveBeenCalledOnce()
    expect(window.confirm).toHaveBeenCalledOnce()

    resolveShutdown?.()
    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(true)
  })

  it('surfaces shutdown failure and allows a later close request to retry', async () => {
    mocks.shutdown.mockRejectedValueOnce(new Error('cleanup failed'))

    await expect(requestApplicationClose()).resolves.toBe(false)
    expect(mocks.notifyError).toHaveBeenCalledOnce()
    expect(mocks.shutdown).toHaveBeenCalledOnce()

    await expect(requestApplicationClose()).resolves.toBe(true)
    expect(mocks.shutdown).toHaveBeenCalledTimes(2)
  })
})
