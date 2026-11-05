import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EditorToolbar } from './EditorToolbar'
import { openNewSqlTab } from '@/lib/newSqlCommand'
import { useEditorStore } from '@/stores/editorStore'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const originalAnimations = Object.getOwnPropertyDescriptor(Element.prototype, 'getAnimations')

beforeEach(() => {
  useEditorStore.setState({ tabs: [{ id: 'old', kind: 'sql', title: 'SQL', sql: 'select 1', connectionId: null }], activeTabId: 'old' })
  // Reproduce a popup whose animation never completes; no frame-based recovery.
  Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [
    { finished: new Promise(() => {}), playState: 'running' } as Animation,
  ] })
})
afterEach(() => {
  if (originalAnimations) Object.defineProperty(Element.prototype, 'getAnimations', originalAnimations)
  else Reflect.deleteProperty(Element.prototype, 'getAnimations')
  vi.restoreAllMocks()
})

function toolbar() {
  const onConnectionChange = vi.fn()
  render(<EditorToolbar connections={[{ id: 'local', name: 'Local QA', driverType: 'sqlite' }]}
    connectionId={null} maxRows={200} onConnectionChange={onConnectionChange}
    onMaxRowsChange={vi.fn()} onRun={vi.fn()} onCancel={vi.fn()} onExplain={vi.fn()} onFormat={vi.fn()} />)
  return onConnectionChange
}

it.each(['choose', 'escape'] as const)('removes the closed picker and permits New SQL without waiting for animation (%s)', async close => {
  const onConnectionChange = toolbar()
  const trigger = screen.getByRole('button', { name: 'connection.select' })
  fireEvent.click(trigger)
  const popup = await screen.findByRole('dialog')
  expect(popup).toHaveStyle({ animation: 'none' })
  const search = screen.getByPlaceholderText('connection.searchDataSources')
  await waitFor(() => expect(search).toHaveFocus())
  if (close === 'choose') {
    fireEvent.click(screen.getByRole('button', { name: /Local QA/ }))
    expect(onConnectionChange).toHaveBeenCalledExactlyOnceWith('local')
  } else {
    fireEvent.keyDown(search, { key: 'Escape', code: 'Escape' })
    expect(onConnectionChange).not.toHaveBeenCalled()
  }
  expect(screen.queryByRole('dialog', { hidden: true })).not.toBeInTheDocument()
  openNewSqlTab(1)
  const state = useEditorStore.getState()
  expect(state.tabs).toHaveLength(2)
  expect(state.activeTabId).toBe(state.tabs[1].id)
  expect(state.tabs[0].sql).toBe('select 1')
})
