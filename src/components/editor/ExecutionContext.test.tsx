import { act, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { useEditorStore } from '@/stores/editorStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { ExecutionContextBar } from './ExecutionContextBar'
import { EditorToolbar } from './EditorToolbar'

beforeEach(async () => {
  await i18n.changeLanguage('en')
  useConnectionStore.setState({ connections: [
    { id: 'file', name: 'Local file', driverType: 'sqlite', connectionUrl: '/local/current.sqlite' },
    { id: 'pg', name: 'Postgres', driverType: 'postgres', database: 'actual' },
  ], statuses: {} })
  useEditorStore.setState({ activeTabId: 'sql', tabs: [{ id: 'sql', kind: 'sql', title: 'SQL', sql: '', connectionId: 'file', database: 'stale', schema: 'main' }] })
})

it('updates the same tab atomically and cannot retain a previous file/database/schema', () => {
  render(<ExecutionContextBar />)
  expect(screen.getByText('Database: /local/current.sqlite')).toBeVisible()
  act(() => useEditorStore.getState().updateTabConnection('sql', 'pg'))
  expect(screen.getByText('Database: actual')).toBeVisible()
  expect(screen.queryByText(/current.sqlite/)).not.toBeInTheDocument()
  expect(screen.queryByText('Schema: main')).not.toBeInTheDocument()
  act(() => useEditorStore.getState().updateTabConnection('sql', 'file'))
  expect(screen.getByText('Database: /local/current.sqlite')).toBeVisible()
  expect(screen.queryByText('Database: actual')).not.toBeInTheDocument()
})

it('limits the reconnect explanation to PostgreSQL and labels the SQLite file', () => {
  const noop = vi.fn()
  const props = { connections: useConnectionStore.getState().connections, connectionId: 'file', database: '/local/current.sqlite', maxRows: 1000,
    onConnectionChange: noop, onMaxRowsChange: noop, onRun: noop, onCancel: noop, onExplain: noop, onFormat: noop }
  const { rerender } = render(<EditorToolbar {...props} />)
  expect(screen.getByTitle('/local/current.sqlite')).toHaveTextContent('current.sqlite')
  expect(screen.queryByTitle(i18n.t('editor.databaseSelectHint'))).not.toBeInTheDocument()
  rerender(<EditorToolbar {...props} connectionId="pg" database="actual" />)
  expect(screen.getByTitle(i18n.t('editor.databaseSelectHint'))).toBeVisible()
})
