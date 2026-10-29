import { afterEach, describe, expect, it, vi } from 'vitest'
import bootstrap from '../../public/boot-status.js?raw'
import { resolveTheme, useUiStore, type Theme } from '@/stores/uiStore'
import { watchAppTheme } from './appTheme'

const setNativeTheme = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/ipc/settings', () => ({ syncWindowAppearance: setNativeTheme }))

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); setNativeTheme.mockClear() })

function boot(theme: string | null, prefersDark: boolean, language = 'zh', storageBlocked = false, settings: Record<string, unknown> = {}) {
  const doc = document.implementation.createHTMLDocument()
  const native = vi.fn().mockResolvedValue(undefined)
  const win = Object.assign(new EventTarget(), { __TAURI_INTERNALS__: { invoke: native } })
  const storage = { getItem: (key: string) => {
    if (storageBlocked) throw new DOMException('blocked', 'SecurityError')
    return key === 'vaporlensdb.theme' ? theme : key === 'vaporlensdb.language' ? language : JSON.stringify(settings)
  } }
  new Function('window', 'document', 'localStorage', 'matchMedia', 'MutationObserver', bootstrap)(
    win, doc, storage, () => ({ matches: prefersDark }), MutationObserver,
  )
  return { doc, win, native }
}

const priorities: [Theme, boolean, 'light' | 'dark'][] = [
  ['light', true, 'light'], ['light', false, 'light'],
  ['dark', false, 'dark'], ['dark', true, 'dark'],
  ['system', true, 'dark'], ['system', false, 'light'],
]

describe('theme before the module graph', () => {
  it.each(priorities)('%s with system dark=%s resolves to %s before body content exists', (theme, system, expected) => {
    const { doc, native } = boot(theme, system)
    expect(doc.body.children).toHaveLength(0)
    expect(doc.documentElement.dataset.theme).toBe(expected)
    expect(doc.documentElement.classList.contains('dark')).toBe(expected === 'dark')
    expect(doc.documentElement.style.colorScheme).toBe(expected)
    expect(resolveTheme(theme, system)).toBe(expected)
    expect(native).toHaveBeenCalledWith('sync_window_appearance', { theme, dark: expected === 'dark' })
  })

  it.each([null, 'invalid'])('uses System for missing or invalid preference %s', value => {
    expect(boot(value, true).doc.documentElement.dataset.theme).toBe('dark')
    expect(boot(value, false).doc.documentElement.dataset.theme).toBe('light')
  })

  it('still loads with unavailable storage', () => {
    expect(boot('light', true, 'en', true).doc.documentElement.dataset.theme).toBe('dark')
  })

  it.each([['en', 'Loading...', 'Unable to load'], ['zh', '加载中...', '无法加载']] as const)( // i18n-hardcoded-ok: locale fixtures
    'shows only %s and replaces a failed entry with a visible error', async (language, loading, failure) => {
      const { doc, win } = boot('light', true, language)
      doc.body.innerHTML = '<div id="startup-status"><span class="startup-indicator"></span><p id="startup-message"></p></div>'
      await Promise.resolve() // parser mutations, without DOMContentLoaded or app imports
      const status = doc.getElementById('startup-status')!
      expect(doc.documentElement.lang).toBe(language)
      expect(status.textContent).toBe(loading)
      expect(status.getAttribute('role')).toBe('status')
      win.dispatchEvent(new Event('error'))
      expect(status.getAttribute('role')).toBe('alert')
      expect(status.dataset.state).toBe('error')
      expect(status.textContent).toContain(failure)
      expect(status.textContent).not.toContain(loading)
    },
  )

  it.each([[200, '232px'], [360, '360px'], [900, '460px']] as const)(
    'uses saved sidebar width %s with the same workspace bounds', (width, expected) => {
      const { doc } = boot('light', false, 'zh', false, { sidebarWidth: width, sidebarCollapsed: true })
      expect(doc.documentElement.style.getPropertyValue('--startup-sidebar-width')).toBe(expected)
      expect(doc.documentElement.dataset.sidebarCollapsed).toBe('true')
    },
  )

  it.each(['img', 'link'])('does not report an application failure for an optional %s resource', async tag => {
    const { doc, win } = boot('light', true, 'en')
    doc.body.innerHTML = '<div id="startup-status"><p id="startup-message"></p></div>'
    await Promise.resolve()
    const target = doc.createElement(tag)
    if (tag === 'link') target.setAttribute('rel', 'icon')
    const event = new Event('error')
    Object.defineProperty(event, 'target', { value: target })
    win.dispatchEvent(event)
    expect(doc.getElementById('startup-status')!.getAttribute('role')).toBe('status')
    expect(doc.getElementById('startup-message')!.textContent).toBe('Loading...')
  })

  it('keeps loading after a browser ResizeObserver notification', async () => {
    const { doc, win } = boot('dark', false, 'en')
    doc.body.innerHTML = '<div id="startup-status"><p id="startup-message"></p></div>'
    await Promise.resolve()
    win.dispatchEvent(new ErrorEvent('error', { message: 'ResizeObserver loop completed with undelivered notifications.' }))
    expect(doc.getElementById('startup-status')!.getAttribute('role')).toBe('status')
  })

  it.each(['script', 'stylesheet'])('still shows a visible error when the entry %s fails', async kind => {
    const { doc, win } = boot('light', false, 'en')
    doc.body.innerHTML = '<div id="startup-status"><p id="startup-message"></p></div>'
    await Promise.resolve()
    const target = doc.createElement(kind === 'script' ? 'script' : 'link')
    if (kind === 'stylesheet') target.setAttribute('rel', kind)
    const event = new Event('error')
    Object.defineProperty(event, 'target', { value: target })
    win.dispatchEvent(event)
    expect(doc.getElementById('startup-status')!.getAttribute('role')).toBe('alert')
    expect(doc.getElementById('startup-message')!.textContent).toContain('Unable to load')
  })

  it('uses the same saved preference after a settings change and reload', () => {
    useUiStore.getState().setTheme('dark')
    expect(boot(localStorage.getItem('vaporlensdb.theme'), false).doc.documentElement.dataset.theme).toBe('dark')
    useUiStore.getState().setTheme('light')
    expect(boot(localStorage.getItem('vaporlensdb.theme'), true).doc.documentElement.dataset.theme).toBe('light')
  })
})

describe('workspace and native appearance', () => {
  function media(prefersDark: boolean) {
    const target = Object.assign(new EventTarget(), { matches: prefersDark })
    vi.stubGlobal('matchMedia', () => target)
    vi.stubGlobal('__TAURI_INTERNALS__', {})
    return target
  }

  it.each(priorities)('keeps %s consistent with the bootstrap for system dark=%s', (theme, system, expected) => {
    const target = media(system)
    const onResolved = vi.fn()
    const stop = watchAppTheme(theme, onResolved)
    expect(document.documentElement.dataset.theme).toBe(expected)
    expect(setNativeTheme).toHaveBeenLastCalledWith(theme, expected === 'dark')
    target.matches = !system
    target.dispatchEvent(new Event('change'))
    expect(document.documentElement.dataset.theme).toBe(resolveTheme(theme, !system))
    stop()
    onResolved.mockClear()
    target.dispatchEvent(new Event('change'))
    expect(onResolved).not.toHaveBeenCalled()
  })

  it('releases the native override on return to System', () => {
    media(false)
    watchAppTheme('dark', vi.fn())()
    watchAppTheme('system', vi.fn())()
    expect(setNativeTheme.mock.calls.map(args => args[0])).toEqual(['dark', 'system'])
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('does not block the interface if native appearance fails', async () => {
    media(true)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    setNativeTheme.mockRejectedValueOnce(new Error('native unavailable'))
    const stop = watchAppTheme('light', vi.fn())
    expect(document.documentElement.dataset.theme).toBe('light')
    await Promise.resolve()
    expect(console.warn).toHaveBeenCalled()
    stop()
  })
})
