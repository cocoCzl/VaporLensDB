import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { TableTriggers } from './TableTriggers'
import i18n from '@/i18n'
import type { DbObjectInfo } from '@/types/metadata'

const load = vi.hoisted(() => vi.fn())
vi.mock('@/ipc/metadata', () => ({ getTableTriggers: load }))
const trigger = (name: string, schema = 'public'): DbObjectInfo => ({ schema, name, kind: 'trigger', objectType: 'TRIGGER', status: 'ENABLED' })
const props = { connectionId: 'connection', schema: 'public', table: 'table_a', refresh: 0, onOpenDefinition: vi.fn() }
function deferred() {
  let resolve!: (rows: DbObjectInfo[]) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<DbObjectInfo[]>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
beforeEach(async () => { vi.resetAllMocks(); await i18n.changeLanguage('en') })

it('shows loading, then successful empty; never empty while pending', async () => {
  const pending = deferred(); load.mockReturnValue(pending.promise)
  render(<TableTriggers {...props} />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading triggers')
  expect(screen.queryByText('No triggers')).not.toBeInTheDocument()
  await act(async () => pending.resolve([]))
  expect(screen.getByText('No triggers')).toBeInTheDocument()
})

it.each([
  ['permission', { code: 'QUERY_FAILED', message: 'permission denied for relation' }],
  ['timeout', { code: 'TIMEOUT', message: 'metadata request timed out' }],
  ['unsupported wording without capability code', { code: 'UNKNOWN_ERROR', message: 'unsupported metadata response' }],
  ['serialization', { code: 'SERIALIZATION_ERROR', message: 'invalid metadata response' }],
])('shows %s failure as error, never empty or unsupported', async (_label, error) => {
  load.mockRejectedValue(JSON.stringify(error))
  render(<TableTriggers {...props} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load triggers.')
  expect(screen.getByRole('alert')).toHaveTextContent(error.message)
  expect(screen.queryByText('No triggers')).not.toBeInTheDocument()
  expect(screen.queryByText(/not supported for this connection/)).not.toBeInTheDocument()
})

it('only maps the explicit unsupported error code to unsupported', async () => {
  load.mockRejectedValue({ code: 'UNSUPPORTED_OPERATION', message: 'Unsupported operation' })
  render(<TableTriggers {...props} />)
  expect(await screen.findByText('Trigger metadata is not supported for this connection.')).toBeInTheDocument()
  expect(screen.queryByText('No triggers')).not.toBeInTheDocument()
})

it.each(['success', 'error'])('ignores stale table A %s after table B completes', async (outcome) => {
  const pending = deferred(); load.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([trigger('trigger_b')])
  const view = render(<TableTriggers {...props} />)
  view.rerender(<TableTriggers {...props} table="table_b" />)
  expect(await screen.findByText('trigger_b')).toBeInTheDocument()
  await act(async () => outcome === 'success' ? pending.resolve([trigger('trigger_a')]) : pending.reject(new Error('late failure')))
  expect(screen.getByText('trigger_b')).toBeInTheDocument()
  expect(screen.queryByText('trigger_a')).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('requests the exact schema even for identical table names and preserves definition action', async () => {
  load.mockImplementation(async (_connection, schema) => [trigger(`${schema}_trigger`, schema)])
  const view = render(<TableTriggers {...props} table="users" />)
  await screen.findByText('public_trigger')
  view.rerender(<TableTriggers {...props} schema="audit" table="users" />)
  expect(screen.queryByText('public_trigger')).not.toBeInTheDocument()
  await screen.findByText('audit_trigger')
  expect(load).toHaveBeenLastCalledWith('connection', 'audit', 'users')
  fireEvent.click(screen.getByRole('button', { name: /Source|DDL/ }))
  expect(props.onOpenDefinition).toHaveBeenCalledWith(trigger('audit_trigger', 'audit'))
})

it('refresh hides previous data, shows failure and permits a subsequent successful retry', async () => {
  const pending = deferred(); load.mockResolvedValueOnce([trigger('old_trigger')]).mockReturnValueOnce(pending.promise).mockResolvedValueOnce([])
  const view = render(<TableTriggers {...props} />)
  await screen.findByText('old_trigger')
  view.rerender(<TableTriggers {...props} refresh={1} />)
  expect(screen.queryByText('old_trigger')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toBeInTheDocument()
  await act(async () => pending.reject(new Error('refresh failed')))
  expect(screen.getByRole('alert')).toHaveTextContent('refresh failed')
  view.rerender(<TableTriggers {...props} refresh={2} />)
  await waitFor(() => expect(screen.getByText('No triggers')).toBeInTheDocument())
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
