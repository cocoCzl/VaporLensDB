import { describe, expect, it } from 'vitest'
import { resolveContextMenuPlacement } from '@/components/explorer/contextMenuPlacement'

describe('resolveContextMenuPlacement', () => {
  it('flips a bottom-edge menu upward while preserving every action', () => {
    const placement = resolveContextMenuPlacement({
      x: 230,
      y: 860,
      menuWidth: 176,
      menuHeight: 252,
      viewportWidth: 1200,
      viewportHeight: 900,
    })

    expect(placement.top).toBe(608)
    expect(placement.maxHeight).toBe(252)
    expect(placement.top + placement.maxHeight).toBeLessThanOrEqual(892)
  })

  it('constrains an over-height menu to its usable viewport space', () => {
    const placement = resolveContextMenuPlacement({
      x: 1180,
      y: 40,
      menuWidth: 176,
      menuHeight: 1_000,
      viewportWidth: 1200,
      viewportHeight: 640,
    })

    expect(placement.left).toBe(1_016)
    expect(placement.top).toBe(40)
    expect(placement.maxHeight).toBe(592)
  })
})
