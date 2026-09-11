import { describe, expect, it } from 'vitest'
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
