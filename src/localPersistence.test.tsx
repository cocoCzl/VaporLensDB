import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriverDefinition } from '@/types/driver'

const driver: DriverDefinition = {
  id: 'postgres', driverType: 'postgres', driverDialect: 'postgresql', name: 'PostgreSQL',
  backend: 'nativeRust', status: 'ready', builtIn: true, userDriverRequired: false,
  driverArtifacts: [], connectionVariants: [{ id: 'hostPort', label: 'Host', requiredFields: ['host', 'username', 'database'] }],
  capabilities: { canConnect: true, canQuery: true, canStream: true, canReadMetadata: true, canCancel: true, canGenerateDdl: true },
}

const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
afterEach(() => {
  if (scrollIntoViewDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoViewDescriptor)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
})

vi.mock('@/ipc/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/ipc/client')>(),
  invokeCommand: vi.fn(async (command: string) => {
    if (command === 'health_check') return { status: 'ok', version: 'test' }
    if (command === 'list_driver_definitions') return [driver]
    return []
  }),
}))

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }))

vi.mock('@monaco-editor/react', () => ({
  loader: { config: vi.fn() },
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="SQL editor" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}))

async function renderWorkbench() {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  const { default: App } = await import('@/App')
  vi.useFakeTimers()
  const view = render(<App />)
  await act(async () => { await vi.advanceTimersByTimeAsync(250) })
  return view
}

describe('workbench local persistence degradation', () => {
  it('starts the real workbench, opens connection UI, and edits SQL with storage unavailable', async () => {
    vi.resetModules()
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    let view: ReturnType<typeof render> | undefined
    try {
      view = await renderWorkbench()
      const { default: i18n } = await import('@/i18n')
      expect(i18n.language).toBe('zh')
      expect(screen.queryByRole('status', { name: i18n.t('app.name') + ' ' + i18n.t('common.loading') })).not.toBeInTheDocument()
      fireEvent.click(screen.getByText(i18n.t('home.newConnection'), { selector: 'span' }).closest('button')!)
      expect(screen.getByRole('dialog', { name: i18n.t('connection.newTitle') })).toBeVisible()
      fireEvent.click(screen.getByRole('button', { name: i18n.t('common.cancel') }))
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      fireEvent.click(screen.getByText(i18n.t('home.newQuery'), { selector: 'span' }).closest('button')!)
      const editor = view.container.querySelector<HTMLTextAreaElement>('.ide-editor-surface textarea')!
      expect(editor).toBeVisible()
      fireEvent.change(editor, { target: { value: 'SELECT 1' } })
      expect(editor).toHaveValue('SELECT 1')
      expect(() => fireEvent(window, new Event('pagehide'))).not.toThrow()
      await act(async () => { await vi.advanceTimersByTimeAsync(800) })
      expect(editor).toHaveValue('SELECT 1')
      expect(getItem).toHaveBeenCalled()
      expect(setItem).toHaveBeenCalled()
    } finally {
      view?.unmount()
      vi.useRealTimers()
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    }
  })

  it('preserves corrupt SQL data on startup and pagehide without resetting other keys', async () => {
    window.localStorage.setItem('vaporlensdb.sqlWorkspace.v1', '{recoverable SQL')
    window.localStorage.setItem('vaporlensdb.theme', 'dark')
    window.localStorage.setItem('vaporlensdb.language', 'unsupported')
    vi.resetModules()
    let view: ReturnType<typeof render> | undefined
    try {
      view = await renderWorkbench()
      const { default: i18n } = await import('@/i18n')
      expect(i18n.language).toBe('zh')
      await act(async () => { await vi.advanceTimersByTimeAsync(800) })
      fireEvent(window, new Event('pagehide'))
      expect(window.localStorage.getItem('vaporlensdb.sqlWorkspace.v1')).toBe('{recoverable SQL')
      expect(window.localStorage.getItem('vaporlensdb.theme')).toBe('dark')
      expect(window.localStorage.getItem('vaporlensdb.language')).toBe('unsupported')
    } finally {
      view?.unmount()
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})
