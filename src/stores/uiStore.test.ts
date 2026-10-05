import { describe, expect, it, vi } from 'vitest'
import { readStoredTheme, resolveTheme, useUiStore } from '@/stores/uiStore'

describe('UI workspace persistence', () => {
  it('resolves system preferences without changing persisted explicit choices', () => {
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('defaults fresh preferences to system and preserves valid persisted choices', () => {
    window.localStorage.removeItem('vaporlensdb.theme')
    expect(readStoredTheme()).toBe('system')

    for (const preference of ['light', 'dark', 'system'] as const) {
      window.localStorage.setItem('vaporlensdb.theme', preference)
      expect(readStoredTheme()).toBe(preference)
    }
  })

  it('falls back when persisted theme or settings are corrupted', async () => {
    window.localStorage.setItem('vaporlensdb.theme', 'solarized')
    window.localStorage.setItem('vaporlensdb.settings', '{')

    expect(readStoredTheme()).toBe('system')
    vi.resetModules()
    const { useUiStore: restored } = await import('@/stores/uiStore')
    expect(restored.getState().queryMaxRows).toBe(5_000)
    expect(restored.getState().sidebarWidth).toBe(288)
    expect(window.localStorage.getItem('vaporlensdb.settings')).toBe('{')
  })

  it.each(['null', '[]', '42', '"wrong"'])('rejects non-object settings: %s', async (value) => {
    window.localStorage.setItem('vaporlensdb.settings', value)
    vi.resetModules()
    const { useUiStore: restored } = await import('@/stores/uiStore')
    expect(restored.getState().maxLiveSessions).toBe(5)
    expect(restored.getState().sidebarWidth).toBe(288)
    expect(window.localStorage.getItem('vaporlensdb.settings')).toBe(value)
  })

  it('rejects wrong numeric types and non-finite values while bounding valid numbers', async () => {
    window.localStorage.setItem('vaporlensdb.settings', '{"queryMaxRows":"900","dataPreviewDefaultRows":null,"editorFontSize":{},"sidebarWidth":false,"maxLiveSessions":1e309,"idleReclaimMinutes":-5,"bottomPanelHeight":9999,"resultPanelLayoutVersion":2}')
    vi.resetModules()
    const { useUiStore: restored } = await import('@/stores/uiStore')
    expect(restored.getState()).toMatchObject({
      queryMaxRows: 5_000, dataPreviewDefaultRows: 200, editorFontSize: 13,
      sidebarWidth: 288, maxLiveSessions: 5, idleReclaimMinutes: 5, bottomPanelHeight: 800,
    })
    restored.getState().setConnectionSessionPolicy(NaN, Infinity)
    expect(restored.getState()).toMatchObject({ maxLiveSessions: 5, idleReclaimMinutes: 30 })
  })

  it('keeps the current UI usable when storage writes throw', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })

    useUiStore.getState().setTheme('dark')
    useUiStore.getState().setQueryMaxRows(1_000)

    expect(useUiStore.getState().theme).toBe('dark')
    expect(useUiStore.getState().queryMaxRows).toBe(1_000)
    setItem.mockRestore()
  })

  it('persists a bounded result panel layout without losing existing settings', () => {
    const state = useUiStore.getState()

    state.setBottomPanelHeight(412)
    state.setBottomPanelCollapsed(true)

    const stored = JSON.parse(window.localStorage.getItem('vaporlensdb.settings') ?? '{}')
    expect(stored.bottomPanelHeight).toBe(412)
    expect(stored.bottomPanelCollapsed).toBe(true)
    expect(stored.resultPanelLayoutVersion).toBe(2)
    expect(stored.queryMaxRows).toBeGreaterThanOrEqual(100)
  })

  it('clamps an oversized result panel before persisting it', () => {
    useUiStore.getState().setBottomPanelHeight(10_000)

    const stored = JSON.parse(window.localStorage.getItem('vaporlensdb.settings') ?? '{}')
    expect(stored.bottomPanelHeight).toBe(800)
  })
})
