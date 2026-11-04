import { useLayoutEffect, useState, type SetStateAction } from 'react'
import type { SqlWorkspaceView } from '@/components/workspace/SqlWorkspace'

interface PaneLayout {
  height?: number
  preferredHeight: number
  collapsed: boolean
  view: SqlWorkspaceView
}

/** Tab-local choices, constrained by the actual split area without overwriting them on resize. */
export function useSqlPaneLayout(tabId: string | null, tabs: { id: string }[], hasOutput: boolean, preferredHeight: number, initiallyCollapsed: boolean) {
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const [availableHeight, setAvailableHeight] = useState(0)
  const [layouts, setLayouts] = useState<Record<string, PaneLayout>>({})
  const initial: PaneLayout = { preferredHeight, collapsed: initiallyCollapsed, view: 'split' }
  const layout = (tabId && layouts[tabId]) || initial
  // Register before mounting a new draft: a previous Tab's results-only view
  // must never give the new editor a hidden/zero-size first mount.
  const open = new Set(tabs.map(tab => tab.id))
  const closed = Object.keys(layouts).filter(id => !open.has(id))
  if ((tabId && !layouts[tabId]) || closed.length) {
    const next = Object.fromEntries(Object.entries(layouts).filter(([id]) => open.has(id)))
    if (tabId && !next[tabId]) next[tabId] = initial
    setLayouts(next)
  }

  useLayoutEffect(() => {
    if (!host) return
    const measure = () => {
      const height = host.getBoundingClientRect().height
      if (height > 0) setAvailableHeight(height)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => observer.disconnect()
  }, [host])

  // Reserve a usable editor viewport, including when the window becomes smaller.
  // The stored manual height remains intact and returns when space is available.
  const maxHeight = Math.max(44, (availableHeight || 360) - 160 - 4)
  const minHeight = Math.min(88, maxHeight)
  const constrain = (height: number) => Math.min(maxHeight, Math.max(minHeight, height))
  const height = constrain(layout.height ?? (hasOutput ? Math.min(layout.preferredHeight, (availableHeight || 360) * 0.45) : 88))
  function update(patch: Partial<PaneLayout>) {
    if (tabId) setLayouts(current => ({ ...current, [tabId]: { ...(current[tabId] ?? initial), ...patch } }))
  }
  return {
    setHost, height, minHeight, maxHeight, collapsed: layout.collapsed, view: layout.view,
    setHeight: (value: number) => update({ height: constrain(value) }),
    setCollapsed: (value: boolean) => update({ collapsed: value }),
    setView: (value: SetStateAction<SqlWorkspaceView>) => update({ view: typeof value === 'function' ? value(layout.view) : value }),
    revealResults: () => update({ collapsed: false, view: layout.view === 'editor' ? 'split' : layout.view }),
  }
}
