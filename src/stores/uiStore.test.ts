import { describe, expect, it } from 'vitest'
import { useUiStore } from '@/stores/uiStore'

describe('UI workspace persistence', () => {
  it('persists a bounded result panel layout without losing existing settings', () => {
    const state = useUiStore.getState()

    state.setBottomPanelHeight(412)
    state.setBottomPanelCollapsed(true)

    const stored = JSON.parse(window.localStorage.getItem('vaporlensdb.settings') ?? '{}')
    expect(stored.bottomPanelHeight).toBe(412)
    expect(stored.bottomPanelCollapsed).toBe(true)
    expect(stored.queryMaxRows).toBeGreaterThanOrEqual(100)
  })

  it('clamps an oversized result panel before persisting it', () => {
    useUiStore.getState().setBottomPanelHeight(10_000)

    const stored = JSON.parse(window.localStorage.getItem('vaporlensdb.settings') ?? '{}')
    expect(stored.bottomPanelHeight).toBe(800)
  })
})
