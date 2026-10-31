import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { DataSourcesSidebar } from './DataSourcesSidebar'
import { NEW_CONNECTION_EVENT } from '@/lib/workspaceNavigation'
import { Sidebar } from '@/components/layout/Sidebar'
import { useConnectionStore } from '@/stores/connectionStore'
import { useMetadataStore } from '@/stores/metadataStore'
import { useEditorStore } from '@/stores/editorStore'
import { useUiStore } from '@/stores/uiStore'

vi.mock('@/hooks/useQuery', () => ({ useQuery: () => ({ runQuery: vi.fn() }) }))
vi.mock('@/hooks/useDisconnectRequest', () => ({ useDisconnectRequest: () => ({ requestDisconnect: vi.fn(), disconnectDialog: null }) }))

const loadConnections = vi.fn().mockResolvedValue(undefined)
const connectConnection = vi.fn().mockResolvedValue(undefined)
const loadDatabases = vi.fn()
const loadSchemas = vi.fn()
const loadTables = vi.fn()
const requestConnectionRefresh = vi.fn()

function connectionRow(container: HTMLElement, id = 'c0') {
  return container.querySelector<HTMLElement>(`[data-connection-id="${id}"]`)!
}
function expand(row: HTMLElement) {
  fireEvent.click(row.querySelector('[data-tree-toggle]')!)
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.clearAllMocks()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  loadDatabases.mockResolvedValue([{ name: 'business_database_with_a_very_long_name_'.repeat(3) }])
  loadSchemas.mockResolvedValue([{ name: 'public' }])
  loadTables.mockResolvedValue([{ name: 'orders_with_a_very_long_table_name_'.repeat(4) }])
  useConnectionStore.setState({
    connections: Array.from({ length: 50 }, (_, index) => ({
      id: `c${index}`, name: `Connection ${index} ${'long_connection_name_'.repeat(4)}`,
      driverType: 'postgres', database: 'business_database_with_a_very_long_name_'.repeat(3),
      host: 'localhost', port: 5432, groupId: index < 25 ? 'production' : null,
    })),
    dataSourceGroups: [{ id: 'production', name: 'Production', sortOrder: 0, createdAt: '', updatedAt: '' }],
    statuses: { c0: { connectionId: 'c0', status: 'connected' } },
    browsingConnectionId: 'c0', activeConnectionId: 'c0', busyConnectionIds: {}, lifecycleEpochs: {},
    recentDataSourceIds: ['c0', 'c1'], favoriteDataSourceIds: [], loadConnections, connectConnection,
  })
  useMetadataStore.setState({
    loadDatabases, loadSchemas, loadTables, catalogSchemaPaths: {}, connectionRefreshTokens: {},
    requestConnectionRefresh, setCatalogSchemaPath: vi.fn(),
  })
  useEditorStore.setState({ tabs: [], activeTabId: null })
  useUiStore.setState({ showSystemObjects: false, sidebarCollapsed: false, sidebarWidth: 288, notifyError: vi.fn() })
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) })
})

describe('continuous data-source tree', () => {
  it('renders 50 saved connections once, without connecting or loading metadata', () => {
    const { container } = render(<DataSourcesSidebar />)
    expect(container.querySelectorAll('[data-connection-id]')).toHaveLength(50)
    expect(screen.queryByText('Recent')).not.toBeInTheDocument()
    expect(screen.queryByText('Object Browser')).not.toBeInTheDocument()
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(connectConnection).not.toHaveBeenCalled()
    expect(loadDatabases).not.toHaveBeenCalled()
  })

  it('filters connections and groups, exposes collapsed matches, and clears back to 50', () => {
    const { container } = render(<DataSourcesSidebar />)
    fireEvent.click(screen.getByRole('treeitem', { name: /Production/ }))
    expect(container.querySelectorAll('[data-connection-id]')).toHaveLength(25)
    const search = screen.getByRole('textbox')
    fireEvent.change(search, { target: { value: 'Production' } })
    expect(container.querySelectorAll('[data-connection-id]')).toHaveLength(25)
    expect(connectionRow(container)).toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'Connection 49 ' } })
    expect(container.querySelectorAll('[data-connection-id]')).toHaveLength(1)
    fireEvent.change(search, { target: { value: 'unmatched' } })
    expect(screen.getByRole('status')).toHaveTextContent('No matching')
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    // Clearing respects the user's collapsed group.
    expect(container.querySelectorAll('[data-connection-id]')).toHaveLength(25)
    fireEvent.click(screen.getByRole('treeitem', { name: /Production/ }))
    expect(container.querySelectorAll('[data-connection-id]')).toHaveLength(50)
    expect(connectConnection).not.toHaveBeenCalled()
  })

  it('loads object categories only after expansion and tables only on demand', async () => {
    const { container } = render(<DataSourcesSidebar />)
    expand(connectionRow(container))
    const tables = await screen.findByText('Tables')
    expect(loadDatabases).toHaveBeenCalledWith('c0', false)
    expect(loadTables).not.toHaveBeenCalled()
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.getAllByRole('tree')).toHaveLength(1)
    expand(tables.closest('[role="treeitem"]')! as HTMLElement)
    await screen.findByText('orders_with_a_very_long_table_name_'.repeat(4))
    expect(loadTables).toHaveBeenCalledWith('c0', 'public', false)
    fireEvent.click(screen.getByRole('button', { name: 'Filter loaded objects' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'orders_with' } })
    expect(screen.getByText('orders_with_a_very_long_table_name_'.repeat(4))).toBeInTheDocument()
    expect(loadTables).toHaveBeenCalledOnce()
    expect(connectConnection).not.toHaveBeenCalled()
  })

  it('moves actual keyboard focus across groups, connections, database and schema', async () => {
    const { container } = render(<DataSourcesSidebar />)
    const group = screen.getByRole('treeitem', { name: /Production/ })
    act(() => group.focus())
    fireEvent.keyDown(group, { key: 'ArrowDown' })
    const connection = connectionRow(container)
    expect(connection).toHaveFocus()
    fireEvent.keyDown(connection, { key: 'ArrowRight' })
    await screen.findByText('public')
    fireEvent.keyDown(connection, { key: 'ArrowRight' })
    const database = screen.getByText('business_database_with_a_very_long_name_'.repeat(3)).closest('[role="treeitem"]')!
    expect(database).toHaveFocus()
    fireEvent.keyDown(database, { key: 'ArrowRight' })
    const schema = screen.getByText('public').closest('[role="treeitem"]')!
    expect(schema).toHaveFocus()
    fireEvent.keyDown(schema, { key: 'ArrowLeft' })
    expect(schema).toHaveAttribute('aria-expanded', 'false')
    fireEvent.keyDown(schema, { key: 'ArrowLeft' })
    expect(database).toHaveFocus()
    fireEvent.keyDown(database, { key: 'End' })
    expect(connectionRow(container, 'c49')).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    expect(group).toHaveFocus()
    expect(connectConnection).not.toHaveBeenCalled()
  })

  it('refresh and locate do not open a disconnected session', async () => {
    useConnectionStore.setState({ browsingConnectionId: 'c49', activeConnectionId: 'c49' })
    const { container } = render(<DataSourcesSidebar />)
    fireEvent.click(screen.getByRole('treeitem', { name: /Ungrouped/ }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Production' } })
    fireEvent.click(screen.getByRole('button', { name: 'Locate current connection' }))
    await waitFor(() => expect(connectionRow(container, 'c49')).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: 'Refresh connections' }))
    expect(connectConnection).not.toHaveBeenCalled()
    expect(requestConnectionRefresh).not.toHaveBeenCalled()
  })

  it('uses a compact empty state and requests the shared connection workflow', () => {
    const open = vi.fn()
    window.addEventListener(NEW_CONNECTION_EVENT, open)
    useConnectionStore.setState({ connections: [] })
    render(<DataSourcesSidebar />)
    expect(screen.getByText('No data sources')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('treeitem')).not.toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('tree')).getByRole('button', { name: 'New Connection' }))
    expect(open).toHaveBeenCalledOnce()
    window.removeEventListener(NEW_CONNECTION_EVENT, open)
    expect(connectConnection).not.toHaveBeenCalled()
  })

  it('preserves the loaded object tree across sidebar collapse and reopening', async () => {
    const { container } = render(<Sidebar />)
    expand(connectionRow(container))
    await screen.findByText('Tables')
    fireEvent.click(screen.getByRole('button', { name: 'Database Explorer' }))
    expect(screen.queryByText('Tables')).not.toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Database Explorer' }))
    expect(screen.getByText('Tables')).toBeVisible()
    expect(loadDatabases).toHaveBeenCalledOnce()
    expect(connectConnection).not.toHaveBeenCalled()
  })

  it('updates the loaded category labels on a language change without fetching again', async () => {
    const { container } = render(<DataSourcesSidebar />)
    expand(connectionRow(container))
    await screen.findByText('Tables')
    await act(() => i18n.changeLanguage('zh'))
    expect(screen.getByText(i18n.t('explorer.folders.tables'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: i18n.t('connection.locateCurrent') })).toBeInTheDocument()
    expect(loadDatabases).toHaveBeenCalledOnce()
  })
})
