import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkspacePanel } from '@/components/layout/WorkspacePanel'
import { useEditorStore } from '@/stores/editorStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { installNewSqlShortcut, openNewSqlTab } from './newSqlCommand'

vi.mock('@/components/home/WorkbenchHome', () => ({ WorkbenchHome: () => <button>Home</button> }))
vi.mock('@/components/layout/MainPanel', () => new Promise(() => {}))
let dispose: (() => void) | undefined
beforeEach(() => {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
  useEditorStore.setState({ tabs: [], activeTabId: null })
  useConnectionStore.setState({ connections: [], browsingConnectionId: null })
  dispose = installNewSqlShortcut()
})
afterEach(() => { dispose?.(); vi.restoreAllMocks() })

it('commits/focuses the first draft before the next input and cancels native accelerator dispatch', () => {
  render(<WorkspacePanel />)
  const event = new KeyboardEvent('keydown', { key: 'n', metaKey: true, bubbles: true, cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  const input = screen.getByRole('textbox')
  expect(input).toHaveFocus()
  fireEvent.change(input, { target: { value: 'abc' } })
  expect(useEditorStore.getState().tabs).toHaveLength(1)
  expect(useEditorStore.getState().tabs[0].sql).toBe('abc')
})

it('routes immediately typed content to the new Tab, preserving the old Tab', () => {
  useEditorStore.setState({ tabs: [{ id: 'old', kind: 'sql', title: 'Old', sql: 'old text', connectionId: null }], activeTabId: 'old' })
  render(<WorkspacePanel />)
  fireEvent.keyDown(window, { key: 'n', metaKey: true })
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new text' } })
  expect(useEditorStore.getState().tabs.map(tab => tab.sql)).toEqual(['old text', 'new text'])
})

it('does not collect ordinary keys, repeat, IME commands or alternate modifiers', () => {
  render(<WorkspacePanel />)
  for (const event of [{ key: 'a' }, { key: 'n', metaKey: true, repeat: true },
    { key: 'n', metaKey: true, isComposing: true }, { key: 'n', metaKey: true, shiftKey: true },
    { key: 'n', ctrlKey: true }, { key: 'n', metaKey: true, altKey: true }]) fireEvent.keyDown(window, event)
  expect(useEditorStore.getState().tabs).toHaveLength(0)
})

it('keeps modal form input and focus untouched for both command entrances', () => {
  render(<div role="dialog"><input aria-label="Name" defaultValue="draft name" /></div>)
  const input = screen.getByRole('textbox'); input.focus()
  fireEvent.keyDown(input, { key: 'n', metaKey: true })
  openNewSqlTab(1)
  fireEvent.change(input, { target: { value: 'draft name a' } })
  expect(useEditorStore.getState().tabs).toHaveLength(0)
  expect(input).toHaveFocus()
  expect(input).toHaveValue('draft name a')
})

it('cleans up the accelerator listener on unmount', () => {
  dispose?.()
  fireEvent.keyDown(window, { key: 'n', metaKey: true })
  expect(useEditorStore.getState().tabs).toHaveLength(0)
})

it.each(['sql', undefined] as const)('inherits the complete execution target from a %s tab, independently of Explorer', kind => {
  useConnectionStore.setState({ connections: [
    { id: 'A', name: 'Execution A', driverType: 'mysql', database: 'configured_database' },
    { id: 'B', name: 'Explorer B', driverType: 'mysql', database: 'browsing_database' },
  ], browsingConnectionId: 'B' })
  const original = { id: 'old', kind, title: 'Old', sql: 'SELECT 1', connectionId: 'A', database: 'selected_database', schema: 'selected_schema', lastQueryId: 'old-result', transactionMode: 'manual' as const }
  useEditorStore.setState({ tabs: [original], activeTabId: 'old' })
  fireEvent.keyDown(window, { key: 'n', metaKey: true })
  const { tabs, activeTabId } = useEditorStore.getState()
  expect(tabs).toHaveLength(2)
  expect(tabs[1]).toMatchObject({ kind: 'sql', sql: '', connectionId: 'A', database: 'selected_database', schema: 'selected_schema' })
  expect(activeTabId).toBe(tabs[1].id)
  expect(tabs[1].lastQueryId).toBeUndefined()
  expect(tabs[1].transactionMode).toBeUndefined()
  expect(tabs[0]).toEqual(original)
})

it('keeps an explicitly unbound SQL tab unbound instead of adopting Explorer on New SQL', () => {
  useConnectionStore.setState({ connections: [{ id: 'B', name: 'Explorer B', driverType: 'sqlite' }], browsingConnectionId: 'B' })
  useEditorStore.setState({ tabs: [{ id: 'old', kind: 'sql', title: 'SQL', sql: '', connectionId: null }], activeTabId: 'old' })
  openNewSqlTab(1)
  expect(useEditorStore.getState().tabs[1].connectionId).toBeNull()
})

it('uses the browsing connection for New SQL outside a SQL tab without inheriting its metadata path', () => {
  useConnectionStore.setState({ connections: [{ id: 'B', name: 'Explorer B', driverType: 'mysql' }], browsingConnectionId: 'B' })
  useEditorStore.setState({ tabs: [{ id: 'other', kind: 'settings', title: 'Settings', sql: '', connectionId: null }], activeTabId: 'other' })
  openNewSqlTab(1)
  expect(useEditorStore.getState().tabs[1]).toMatchObject({ connectionId: 'B', title: 'SQL · Explorer B' })
})
