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
  expect(screen.getByLabelText('Execution context')).toHaveTextContent('Database: /local/current.sqlite')
  act(() => useEditorStore.getState().updateTabConnection('sql', 'pg'))
  expect(screen.getByLabelText('Execution context')).toHaveTextContent('Database: actual')
  expect(screen.queryByText(/current.sqlite/)).not.toBeInTheDocument()
  expect(screen.getByLabelText('Execution context')).not.toHaveTextContent('Schema: main')
  act(() => useEditorStore.getState().updateTabConnection('sql', 'file'))
  expect(screen.getByLabelText('Execution context')).toHaveTextContent('Database: /local/current.sqlite')
  expect(screen.getByLabelText('Execution context')).not.toHaveTextContent('Database: actual')
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


it('leaves the connected Auto target to the toolbar, without a duplicate visible context row', () => {
  useConnectionStore.setState({ statuses: { file: { connectionId: 'file', status: 'connected' } }, browsingConnectionId: null })
  render(<ExecutionContextBar />)
  expect(screen.getByLabelText('Execution context')).toHaveClass('sr-only')
  expect(screen.queryByText(/Browsing:/)).not.toBeInTheDocument()
})

it('does not offer a Schema selector for a database without schemas', () => {
  const noop = vi.fn()
  render(<EditorToolbar connections={[{ id: 'mysql', name: 'MySQL', driverType: 'mysql' }]} connectionId="mysql" database="actual" hasSchema={false} maxRows={1000}
    onConnectionChange={noop} onMaxRowsChange={noop} onRun={noop} onCancel={noop} onExplain={noop} onFormat={noop} />)
  expect(screen.queryByRole('combobox', { name: 'Schema' })).not.toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Database' })).toBeInTheDocument()
})

it('keeps the actual database and schema readable while metadata is missing', () => {
  const noop = vi.fn()
  const props = { connections: useConnectionStore.getState().connections, connectionId: 'pg', database: 'actual', schema: 'public', maxRows: 1000,
    onConnectionChange: noop, onMaxRowsChange: noop, onRun: noop, onCancel: noop, onExplain: noop, onFormat: noop }
  const { rerender } = render(<EditorToolbar {...props} />)
  expect(screen.getByRole('combobox', { name: 'Database' })).toHaveTextContent('actual')
  expect(screen.getByRole('combobox', { name: 'Schema' })).toHaveTextContent('public')
  rerender(<EditorToolbar {...props} databases={[{ name: 'another' }]} schemas={[{ name: 'other' }]} />)
  expect(screen.getByRole('combobox', { name: 'Database' })).toHaveTextContent('actual')
  expect(screen.getByRole('combobox', { name: 'Schema' })).toHaveTextContent('public')
  expect(noop).not.toHaveBeenCalled()
})
