import { act, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useEditorStore } from '@/stores/editorStore'
import { WorkspacePanel } from './WorkspacePanel'

const lifecycle = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn() }))
vi.mock('@/components/home/WorkbenchHome', () => ({ WorkbenchHome: () => <h1>Home</h1> }))
vi.mock('./MainPanel', () => ({ MainPanel: function Panel() {
  useEffect(() => { lifecycle.mount(); return lifecycle.unmount }, [])
  return <p>Workspace loaded</p>
} }))

beforeEach(() => {
  vi.clearAllMocks()
  useEditorStore.setState({ tabs: [], activeTabId: null })
})

it('leaves the execution module unloaded at Home and keeps its hooks mounted after first use', async () => {
  render(<WorkspacePanel />)
  expect(screen.getByRole('heading', { name: 'Home' })).toBeVisible()
  expect(lifecycle.mount).not.toHaveBeenCalled()
  act(() => useEditorStore.setState({ activeTabId: 'sql-1' }))
  expect(await screen.findByText('Workspace loaded')).toBeVisible()
  expect(lifecycle.mount).toHaveBeenCalledTimes(1)
  act(() => useEditorStore.setState({ activeTabId: null }))
  expect(screen.getByText('Workspace loaded')).toBeVisible()
  act(() => useEditorStore.setState({ activeTabId: 'sql-2' }))
  expect(lifecycle.mount).toHaveBeenCalledTimes(1)
  expect(lifecycle.unmount).not.toHaveBeenCalled()
})
