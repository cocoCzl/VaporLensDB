import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useEditorStore } from '@/stores/editorStore'
import { WorkspacePanel } from './WorkspacePanel'
import { takeDraftSelection } from '@/lib/editorDraftHandoff'

const delayed = vi.hoisted(() => {
  let ready!: () => void
  const gate = new Promise<void>(resolve => { ready = resolve })
  return { gate, ready }
})
vi.mock('./MainPanel', async () => {
  await delayed.gate
  return { MainPanel: () => <p>Workspace ready</p> }
})

it('accepts first-workspace typing and Chinese composition before the execution chunk is available', async () => {
  useEditorStore.setState({ tabs: [{ id: 'first', kind: 'sql', title: 'SQL', sql: '', connectionId: null }], activeTabId: 'first' })
  render(<WorkspacePanel />)
  const input = screen.getByRole('textbox')
  expect(input).toHaveFocus()
  fireEvent.change(input, { target: { value: 'SELECT ' } })
  fireEvent.compositionStart(input)
  fireEvent.change(input, { target: { value: 'SELECT \u4e2d\u6587' } })
  await act(async () => { delayed.ready(); await delayed.gate })
  expect(input).toBeInTheDocument()
  expect(screen.queryByText('Workspace ready')).not.toBeInTheDocument()
  fireEvent.compositionEnd(input, { data: '\u4e2d\u6587' })
  await waitFor(() => expect(screen.getByText('Workspace ready')).toBeVisible())
  expect(useEditorStore.getState().tabs[0].sql).toBe('SELECT \u4e2d\u6587')
  expect(takeDraftSelection('first')?.focused).toBe(true)
})
