import type { FocusEvent, KeyboardEvent } from 'react'

function visibleRows(tree: HTMLElement) {
  return Array.from(tree.querySelectorAll<HTMLElement>('[data-tree-row]'))
    .filter((row) => !row.closest('[hidden]'))
}

export function syncTreeTabStop(tree: HTMLElement) {
  const rows = visibleRows(tree)
  const active = rows.find((row) => row === document.activeElement)
    ?? rows.find((row) => row.tabIndex === 0)
    ?? rows.find((row) => row.getAttribute('aria-selected') === 'true')
    ?? rows[0]
  for (const row of rows) row.tabIndex = row === active ? 0 : -1
}

/** One focus path through groups, connections and their lazy object children. */
export function roveTreeFocus(event: FocusEvent<HTMLDivElement>) {
  const focused = event.target as HTMLElement
  if (!focused.matches('[data-tree-row]')) return
  for (const row of visibleRows(event.currentTarget)) row.tabIndex = row === focused ? 0 : -1
}

export function handleTreeNavigation(event: KeyboardEvent<HTMLDivElement>) {
  const row = event.target as HTMLElement
  if (!row.matches('[data-tree-row]') || event.altKey || event.metaKey || event.ctrlKey) return
  const rows = visibleRows(event.currentTarget)
  const index = rows.indexOf(row)
  let next: HTMLElement | undefined
  const expanded = row.getAttribute('aria-expanded')
  const toggle = () => {
    const control = row.matches('[data-tree-toggle]') ? row : row.querySelector<HTMLElement>('[data-tree-toggle]')
    control?.click()
  }
  switch (event.key) {
    case 'ArrowDown': next = rows[Math.min(index + 1, rows.length - 1)]; break
    case 'ArrowUp': next = rows[Math.max(index - 1, 0)]; break
    case 'Home': next = rows[0]; break
    case 'End': next = rows.at(-1); break
    case 'ArrowRight':
      if (expanded === 'false') toggle()
      else if (rows[index + 1]?.dataset.treeParent === row.dataset.treeRow) next = rows[index + 1]
      break
    case 'ArrowLeft':
      if (expanded === 'true') toggle()
      else next = rows.find((item) => item.dataset.treeRow === row.dataset.treeParent)
      break
    default: return
  }
  event.preventDefault()
  event.stopPropagation()
  next?.focus()
  next?.scrollIntoView?.({ block: 'nearest' })
}
