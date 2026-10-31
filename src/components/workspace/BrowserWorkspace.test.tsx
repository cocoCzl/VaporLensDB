import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { BrowserWorkspace } from './BrowserWorkspace'
import { ObjectStructurePreview } from './ObjectStructurePreview'
import { openBrowserWorkspace } from './openBrowserWorkspace'
import { WorkbenchHome } from '@/components/home/WorkbenchHome'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import { schemaKey, schemaObjectKey, tableObjectKey, useMetadataStore } from '@/stores/metadataStore'
import { useQueryHistoryStore } from '@/stores/queryHistoryStore'

const ipc = vi.hoisted(() => ({ databases: vi.fn(), schemas: vi.fn(), tables: vi.fn(), views: vi.fn(), columns: vi.fn() }))
vi.mock('@/ipc/metadata', async importOriginal => ({ ...await importOriginal<typeof import('@/ipc/metadata')>(),
  getDatabases: ipc.databases, getSchemas: ipc.schemas, getTables: ipc.tables, getViews: ipc.views, getColumns: ipc.columns,
}))
vi.mock('@/components/connection/ConnectionDialog', () => ({ ConnectionDialog: ({ open }: { open: boolean }) => open ? <div role="dialog">Connection dialog</div> : null }))

const connect = vi.fn().mockResolvedValue(undefined)
const database = 'business_database_with_a_very_long_name.sqlite'
const table = 'orders_with_a_very_long_table_name_'.repeat(4)

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.clearAllMocks()
  ipc.databases.mockResolvedValue([{ name: database }])
  ipc.schemas.mockResolvedValue([{ name: 'main' }])
  ipc.tables.mockResolvedValue([{ name: table, schema: 'main', tableType: 'table' }])
  ipc.views.mockResolvedValue([{ name: 'active_customers', schema: 'main', tableType: 'view' }])
  ipc.columns.mockResolvedValue([{ name: 'id', ordinalPosition: 1, dataType: 'INTEGER', nullable: false, isPrimaryKey: true }])
  useConnectionStore.setState({ connections: [{ id: 'c1', name: 'Local database', driverType: 'sqlite', database }],
    statuses: {}, busyConnectionIds: {}, lifecycleEpochs: {}, browsingConnectionId: null, activeConnectionId: null,
    loadConnections: vi.fn().mockResolvedValue(undefined), recentDataSourceIds: ['c1'], connectConnection: connect })
  useMetadataStore.setState({ databases: {}, schemas: {}, tables: {}, views: {}, columns: {}, schemaObjects: {}, loading: {}, catalogSchemaPaths: {} })
  useEditorStore.setState({ tabs: [], activeTabId: null })
  useQueryHistoryStore.setState({ entries: [], loading: false, loadHistory: vi.fn().mockResolvedValue(undefined) })
})

it('starts with a compact empty home and never connects or reads metadata', () => {
  useConnectionStore.setState({ connections: [] })
  render(<WorkbenchHome />)
  expect(screen.queryByText('Welcome back')).not.toBeInTheDocument()
  expect(screen.queryByText('Recent Connections')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'New Connection' }))
  expect(screen.getByRole('dialog')).toBeVisible()
  expect(connect).not.toHaveBeenCalled()
  expect(ipc.databases).not.toHaveBeenCalled()
})

it('shows resume actions only without an explicit connection, and selecting one opens a summary without connecting', () => {
  render(<WorkbenchHome />)
  expect(screen.getByRole('heading', { name: 'Recent Connections' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /Local database/ }))
  expect(screen.queryByRole('heading', { name: 'Recent Connections' })).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Local database' })).toBeVisible()
  expect(screen.getByText('No live session')).toBeVisible()
  expect(useEditorStore.getState().tabs[0].kind).toBe('browser')
  expect(connect).not.toHaveBeenCalled()
  expect(ipc.databases).not.toHaveBeenCalled()
})

it('renders cached schemas offline without opening a session or fetching', () => {
  useMetadataStore.setState({ schemas: { [schemaKey('c1', database)]: [{ name: 'main' }] } })
  render(<BrowserWorkspace connectionId="c1" context={{ kind: 'database', database }} />)
  expect(screen.getByRole('button', { name: /main/ })).toBeVisible()
  expect(ipc.schemas).not.toHaveBeenCalled()
  expect(connect).not.toHaveBeenCalled()
})

it('loads a selected database from the existing session and opens a schema in the reusable browser tab', async () => {
  useConnectionStore.setState({ statuses: { c1: { connectionId: 'c1', status: 'connected' } } })
  render(<BrowserWorkspace connectionId="c1" context={{ kind: 'database', database }} />)
  fireEvent.click(await screen.findByRole('button', { name: /main/ }))
  expect(ipc.schemas).toHaveBeenCalledWith('c1', database)
  expect(useEditorStore.getState().tabs[0].browserContext).toMatchObject({ kind: 'schema', schema: 'main', database })
  expect(connect).not.toHaveBeenCalled()
})

it('filters long table names and opens table summaries without executing data queries', async () => {
  useConnectionStore.setState({ statuses: { c1: { connectionId: 'c1', status: 'connected' } } })
  render(<BrowserWorkspace connectionId="c1" context={{ kind: 'schema', database, schema: 'main' }} />)
  await screen.findByRole('button', { name: new RegExp(table) })
  fireEvent.change(screen.getByRole('textbox', { name: 'Filter objects…' }), { target: { value: 'orders_' } })
  expect(screen.queryByRole('button', { name: /active_customers/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: new RegExp(table) }))
  expect(useEditorStore.getState().tabs[0]).toMatchObject({ kind: 'objectSummary', connectionId: 'c1', sql: '', objectSummaryContext: { object: table, schema: 'main', database } })
  expect(connect).not.toHaveBeenCalled()
})

it('reuses one browse tab and leaves a running SQL tab and its binding intact', () => {
  const sql = { id: 'sql', kind: 'sql' as const, title: 'Draft', sql: 'SELECT 42', connectionId: 'other', runningQueryId: 'q1', dirty: true }
  useEditorStore.setState({ tabs: [sql], activeTabId: sql.id })
  openBrowserWorkspace('c1', 'Connection')
  openBrowserWorkspace('c1', database, { kind: 'database', database })
  expect(useEditorStore.getState().tabs).toHaveLength(2)
  expect(useEditorStore.getState().tabs[0]).toBe(sql)
  expect(useEditorStore.getState().tabs[1].browserContext?.kind).toBe('database')
})

it('shows connecting explicitly and waits for the existing connection attempt before reading metadata', async () => {
  useConnectionStore.setState({ busyConnectionIds: { c1: true } })
  render(<BrowserWorkspace connectionId="c1" context={{ kind: 'connection' }} />)
  expect(screen.getByText('Connecting')).toBeVisible()
  expect(ipc.databases).not.toHaveBeenCalled()
  act(() => useConnectionStore.setState({ busyConnectionIds: {}, statuses: { c1: { connectionId: 'c1', status: 'connected' } } }))
  await screen.findByRole('button', { name: new RegExp(database) })
  expect(connect).not.toHaveBeenCalled()
})

it('renders inline structure on table selection using metadata only', async () => {
  useConnectionStore.setState({ statuses: { c1: { connectionId: 'c1', status: 'connected' } } })
  render(<ObjectStructurePreview connectionId="c1" schema="main" object={table} />)
  expect(await screen.findByText('INTEGER')).toBeVisible()
  expect(ipc.columns).toHaveBeenCalledWith('c1', 'main', table)
  expect(useEditorStore.getState().tabs).toHaveLength(0)
  expect(connect).not.toHaveBeenCalled()
})

it('reads cached table structure while disconnected and does not fetch', () => {
  useMetadataStore.setState({ columns: { [tableObjectKey('c1', 'main', table)]: [{ table, name: 'cached', ordinalPosition: 1, dataType: 'TEXT', nullable: true, isPrimaryKey: false, isIdentity: false, isGenerated: false, isAutoIncrement: false }] } })
  render(<ObjectStructurePreview connectionId="c1" schema="main" object={table} />)
  expect(screen.getByText('cached')).toBeVisible()
  expect(ipc.columns).not.toHaveBeenCalled()
})

it('does not load PostgreSQL schemas from a catalog outside the configured connection', async () => {
  useConnectionStore.setState({ connections: [{ id: 'c1', name: 'Postgres', driverType: 'postgres', database: 'configured' }], statuses: { c1: { connectionId: 'c1', status: 'connected' } } })
  render(<BrowserWorkspace connectionId="c1" context={{ kind: 'database', database: 'other' }} />)
  await waitFor(() => expect(screen.getByText(/queries still run against/)).toBeVisible())
  expect(ipc.schemas).not.toHaveBeenCalled()
  expect(connect).not.toHaveBeenCalled()
})

it('uses the same schema cache as the tree and preserves object filtering on language changes', async () => {
  useMetadataStore.setState({ tables: { [schemaObjectKey('c1', 'main')]: [{ name: table, tableType: 'table' }] } })
  render(<BrowserWorkspace connectionId="c1" context={{ kind: 'schema', database, schema: 'main' }} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'orders_' } })
  await act(() => i18n.changeLanguage('zh'))
  expect(screen.getByRole('textbox')).toHaveValue('orders_')
  expect(screen.getByRole('button', { name: new RegExp(table) })).toBeVisible()
  expect(ipc.tables).not.toHaveBeenCalled()
})
