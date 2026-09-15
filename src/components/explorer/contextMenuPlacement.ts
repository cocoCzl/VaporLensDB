const VIEWPORT_PADDING = 8

export interface ContextMenuPlacement {
  left: number
  top: number
  maxHeight: number
}

/**
 * Keeps an application context menu inside the current desktop viewport.
 * The component renders the menu in a portal so layout overflow cannot clip it.
 */
export function resolveContextMenuPlacement({
  x,
  y,
  menuWidth,
  menuHeight,
  viewportWidth,
  viewportHeight,
}: {
  x: number
  y: number
  menuWidth: number
  menuHeight: number
  viewportWidth: number
  viewportHeight: number
}): ContextMenuPlacement {
  const left = clampNumber(x, VIEWPORT_PADDING, Math.max(VIEWPORT_PADDING, viewportWidth - menuWidth - VIEWPORT_PADDING))
  const availableBelow = Math.max(1, viewportHeight - y - VIEWPORT_PADDING)
  const availableAbove = Math.max(1, y - VIEWPORT_PADDING)
  const openUpward = menuHeight > availableBelow && availableAbove > availableBelow
  const maxHeight = Math.min(menuHeight, openUpward ? availableAbove : availableBelow)
  const top = openUpward
    ? Math.max(VIEWPORT_PADDING, y - maxHeight)
    : Math.min(y, Math.max(VIEWPORT_PADDING, viewportHeight - maxHeight - VIEWPORT_PADDING))

  return { left, top, maxHeight }
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
