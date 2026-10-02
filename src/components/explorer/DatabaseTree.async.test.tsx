import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { useConnectionStore } from '@/stores/connectionStore'
import { MetadataLoadInvalidatedError, useMetadataStore } from '@/stores/metadataStore'
import { useUiStore } from '@/stores/uiStore'
import { DatabaseTree } from '@/components/explorer/DatabaseTree'

vi.mock('@/hooks/useQuery', () => ({ useQuery: () => ({ runQuery: vi.fn() }) }))
vi.mock('@/components/connection/ConnectionDialog', () => ({ ConnectionDialog: () => null }))
vi.mock('@/components/explorer/TreeNode', () => ({
  TreeNode: ({ node, onToggle, onNodeContextMenu }: Parameters<typeof import('./TreeNode').TreeNode>[0]) => (
    <div data-testid={`node-${node.label}`} data-expanded={node.expanded === true} data-loading={node.loading === true}>
      <button onClick={() => onToggle(node.id)}>{node.label}</button>
      <button aria-label={`menu-${node.label}`} onClick={() => onNodeContextMenu?.(node, { x: 0, y: 0 })}>menu</button>
    </div>
  ),
}))
vi.mock('@/components/explorer/ContextMenu', () => ({
  ContextMenu: ({ actions, onClose }: Parameters<typeof import('./ContextMenu').ContextMenu>[0]) => (
    <div>{actions.map((action) => <button key={action.id} data-testid={`action-${action.id}`} onClick={() => { action.onSelect(); onClose() }}>{action.label}</button>)}</div>
  ),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const rootLoads = vi.fn()
const schemaLoads = vi.fn()
const tableLoads = vi.fn()
const viewLoads = vi.fn()
const notifyError = vi.fn()
const setPath = vi.fn()

async function settle(operation: () => void) {
  await act(async () => { operation(); await Promise.resolve() })
}

function refreshRoot() {
  fireEvent.click(screen.getByTitle(i18n.t('explorer.refreshObjects')))
}

function refreshTables() {
  fireEvent.click(screen.getByRole('button', { name: 'menu-Tables' }))
  fireEvent.click(screen.getByTestId('action-refresh'))
}

describe('DatabaseTree async commit boundaries', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    vi.clearAllMocks()
    rootLoads.mockReset().mockResolvedValue([{ name: 'app' }])
    schemaLoads.mockReset().mockResolvedValue([{ name: 'public' }])
    tableLoads.mockReset().mockResolvedValue([])
    viewLoads.mockReset().mockResolvedValue([])
    useConnectionStore.setState({
      connections: ['a', 'b'].map((id) => ({ id, name: id, database: 'app', driverType: 'postgres' })),
      activeConnectionId: 'a',
      browsingConnectionId: 'a',
      lifecycleEpochs: {},
      busyConnectionIds: {},
      statuses: { a: { connectionId: 'a', status: 'connected' }, b: { connectionId: 'b', status: 'connected' } },
    })
    useMetadataStore.setState({
      catalogSchemaPaths: {},
      connectionRefreshTokens: {},
      loadDatabases: rootLoads,
      loadSchemas: schemaLoads,
      loadTables: tableLoads,
      loadViews: viewLoads,
      setCatalogSchemaPath: setPath,
    })
    useUiStore.setState({ showSystemObjects: false, notifyError })
  })

  it('keeps B after a slow A root success and never writes the stale catalog path', async () => {
    const oldRoot = deferred<Array<{ name: string }>>()
    rootLoads.mockImplementation((id: string) => id === 'a' ? oldRoot.promise : Promise.resolve([{ name: 'bdb' }]))
    useConnectionStore.setState((state) => ({ connections: state.connections.map((connection) => connection.id === 'b' ? { ...connection, database: 'bdb' } : connection) }))
    render(<DatabaseTree />)
    await waitFor(() => expect(rootLoads).toHaveBeenCalledWith('a', false))
    await settle(() => useConnectionStore.getState().setActiveConnection('b'))
    await screen.findByTestId('node-bdb')
    await settle(() => oldRoot.resolve([{ name: 'app' }]))
    expect(screen.queryByTestId('node-app')).not.toBeInTheDocument()
    expect(setPath.mock.calls.every(([path]) => path.connectionId === 'b')).toBe(true)
  })

  it('does not toast a stale A root error', async () => {
    const oldRoot = deferred<Array<{ name: string }>>()
    rootLoads.mockReturnValueOnce(oldRoot.promise)
    render(<DatabaseTree />)
    await waitFor(() => expect(rootLoads).toHaveBeenCalledOnce())
    await settle(() => useConnectionStore.getState().setActiveConnection('b'))
    await screen.findByTestId('node-app')
    await settle(() => oldRoot.reject(new Error('old connection failed')))
    expect(notifyError).not.toHaveBeenCalled()
  })

  it('loads B after switching away from an already populated A tree', async () => {
    rootLoads.mockImplementation((id: string) => Promise.resolve([{ name: id === 'a' ? 'app' : 'bdb' }]))
    useConnectionStore.setState((state) => ({ connections: state.connections.map((connection) => connection.id === 'b' ? { ...connection, database: 'bdb' } : connection) }))
    render(<DatabaseTree />)
    await screen.findByTestId('node-app')
    await settle(() => useConnectionStore.getState().setActiveConnection('b'))
    await screen.findByTestId('node-bdb')
    expect(screen.queryByTestId('node-app')).not.toBeInTheDocument()
    expect(rootLoads).toHaveBeenCalledWith('b', false)
  })

  it('root refresh is latest-wins even if an older schema request resolves last', async () => {
    const oldSchemas = deferred<Array<{ name: string }>>()
    schemaLoads.mockReturnValueOnce(oldSchemas.promise).mockResolvedValue([{ name: 'fresh' }])
    render(<DatabaseTree />)
    await waitFor(() => expect(schemaLoads).toHaveBeenCalledOnce())
    refreshRoot()
    await screen.findByTestId('node-fresh')
    await settle(() => oldSchemas.resolve([{ name: 'stale' }]))
    expect(screen.queryByTestId('node-stale')).not.toBeInTheDocument()
    expect(setPath).toHaveBeenCalledOnce()
  })

  it('same node double refresh keeps the newer response', async () => {
    const first = deferred<Array<{ name: string }>>()
    const second = deferred<Array<{ name: string }>>()
    tableLoads.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    render(<DatabaseTree />)
    await screen.findByTestId('node-Tables')
    fireEvent.click(screen.getByRole('button', { name: 'Tables' }))
    refreshTables()
    await settle(() => second.resolve([{ name: 'fresh_table' }]))
    await settle(() => first.resolve([{ name: 'stale_table' }]))
    expect(screen.getByTestId('node-fresh_table')).toBeInTheDocument()
    expect(screen.queryByTestId('node-stale_table')).not.toBeInTheDocument()
  })

  it('different nodes can load concurrently', async () => {
    const tables = deferred<Array<{ name: string }>>()
    const views = deferred<Array<{ name: string }>>()
    tableLoads.mockReturnValue(tables.promise)
    viewLoads.mockReturnValue(views.promise)
    render(<DatabaseTree />)
    await screen.findByTestId('node-Tables')
    fireEvent.click(screen.getByRole('button', { name: 'Tables' }))
    fireEvent.click(screen.getByRole('button', { name: 'Views' }))
    await settle(() => views.resolve([{ name: 'view_result' }]))
    await settle(() => tables.resolve([{ name: 'table_result' }]))
    expect(screen.getByTestId('node-view_result')).toBeInTheDocument()
    expect(screen.getByTestId('node-table_result')).toBeInTheDocument()
  })

  it('collapse while loading stays collapsed and finishes loading', async () => {
    const tables = deferred<Array<{ name: string }>>()
    tableLoads.mockReturnValue(tables.promise)
    render(<DatabaseTree />)
    await screen.findByTestId('node-Tables')
    fireEvent.click(screen.getByRole('button', { name: 'Tables' }))
    fireEvent.click(screen.getByRole('button', { name: 'Tables' }))
    await settle(() => tables.resolve([{ name: 'loaded_table' }]))
    expect(screen.getByTestId('node-Tables')).toHaveAttribute('data-expanded', 'false')
    expect(screen.getByTestId('node-Tables')).toHaveAttribute('data-loading', 'false')
  })

  it('old child response cannot reappear after a root refresh', async () => {
    const tables = deferred<Array<{ name: string }>>()
    tableLoads.mockReturnValueOnce(tables.promise)
    render(<DatabaseTree />)
    await screen.findByTestId('node-Tables')
    fireEvent.click(screen.getByRole('button', { name: 'Tables' }))
    refreshRoot()
    await waitFor(() => expect(rootLoads).toHaveBeenCalledTimes(2))
    await screen.findByTestId('node-Tables')
    await settle(() => tables.resolve([{ name: 'stale_table' }]))
    expect(screen.queryByTestId('node-stale_table')).not.toBeInTheDocument()
    expect(screen.getByTestId('node-Tables')).toHaveAttribute('data-expanded', 'false')
  })

  it('stale error/finally does not stop a newer node from loading', async () => {
    const first = deferred<Array<{ name: string }>>()
    const second = deferred<Array<{ name: string }>>()
    tableLoads.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    render(<DatabaseTree />)
    await screen.findByTestId('node-Tables')
    fireEvent.click(screen.getByRole('button', { name: 'Tables' }))
    refreshTables()
    await settle(() => first.reject(new Error('stale metadata failure')))
    expect(screen.getByTestId('node-Tables')).toHaveAttribute('data-loading', 'true')
    expect(notifyError).not.toHaveBeenCalled()
    await settle(() => second.resolve([{ name: 'fresh_table' }]))
    expect(screen.getByTestId('node-Tables')).toHaveAttribute('data-loading', 'false')
  })

  it('invalidated metadata is silent but a current real error is notified', async () => {
    tableLoads.mockRejectedValueOnce(new MetadataLoadInvalidatedError()).mockRejectedValueOnce(new Error('permission denied'))
    render(<DatabaseTree />)
    await screen.findByTestId('node-Tables')
    await settle(() => fireEvent.click(screen.getByRole('button', { name: 'Tables' })))
    expect(notifyError).not.toHaveBeenCalled()
    refreshTables()
    await waitFor(() => expect(notifyError).toHaveBeenCalledOnce())
  })

  it('disconnect invalidates a pending child without toast or catalog commits', async () => {
    const tables = deferred<Array<{ name: string }>>()
    tableLoads.mockReturnValueOnce(tables.promise)
    render(<DatabaseTree />)
    await screen.findByTestId('node-Tables')
    fireEvent.click(screen.getByRole('button', { name: 'Tables' }))
    await settle(() => useConnectionStore.setState({ statuses: { a: { connectionId: 'a', status: 'disconnected' } } }))
    await settle(() => tables.reject(new Error('old session failure')))
    expect(notifyError).not.toHaveBeenCalled()
  })
})
