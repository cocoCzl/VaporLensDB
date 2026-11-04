import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkspacePanel } from '@/components/layout/WorkspacePanel'
import { useEditorStore } from '@/stores/editorStore'
import { installNewSqlShortcut, openNewSqlTab } from './newSqlCommand'

vi.mock('@/components/home/WorkbenchHome', () => ({ WorkbenchHome: () => <button>Home</button> }))
vi.mock('@/components/layout/MainPanel', () => new Promise(() => {}))
let dispose: (() => void) | undefined
beforeEach(() => {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
  useEditorStore.setState({ tabs: [], activeTabId: null })
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
