import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionConfig, ConnectionInput } from '@/types/connection'

const connectionMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  createConnection: vi.fn(),
  createDataSourceGroup: vi.fn(),
  deleteConnection: vi.fn(),
  deleteDataSourceGroup: vi.fn(),
  disconnect: vi.fn(),
  listConnections: vi.fn(),
  listConnectionStatuses: vi.fn(),
  listDataSourceGroups: vi.fn(),
  renameDataSourceGroup: vi.fn(),
  reorderDataSourceGroups: vi.fn(),
  setConnectionDataSourceGroup: vi.fn(),
  testConnection: vi.fn(),
  updateConnection: vi.fn(),
}))

vi.mock('@/ipc/connection', () => connectionMocks)

import { useConnectionStore } from '@/stores/connectionStore'
import { useUiStore } from '@/stores/uiStore'

function connection(id: string, name: string): ConnectionConfig {
  return {
    id,
    name,
    driverDefinitionId: 'mysql',
    driverType: 'mysql',
    driverDialect: 'mysql',
    host: '192.168.0.20',
    port: 3306,
    database: 'ops_dev',
    username: 'root',
    groupId: null,
    group: null,
    hasSavedPassword: true,
  }
}

function input(name: string, id?: string): ConnectionInput {
  return {
    id,
    name,
    driverDefinitionId: 'mysql',
    driverType: 'mysql',
    driverDialect: 'mysql',
    host: '192.168.0.20',
    port: 3306,
    database: 'ops_dev',
    username: 'root',
    password: 'secret',
    savePassword: true,
  }
}

describe('connection store save lifecycle', () => {
  beforeEach(() => {
    for (const mock of Object.values(connectionMocks)) mock.mockReset()
    connectionMocks.listConnectionStatuses.mockResolvedValue([])
    connectionMocks.listDataSourceGroups.mockResolvedValue([])
    useConnectionStore.setState({
      connections: [],
      dataSourceGroups: [],
      statuses: {},
      browsingConnectionId: null,
      activeConnectionId: null,
      recentDataSourceIds: [],
      favoriteDataSourceIds: [],
      busyConnectionIds: {},
      loading: false,
      error: null,
    })
    useUiStore.setState({ notifications: [] })
  })

  it('adds a created connection, refreshes saved data, and releases loading', async () => {
    const saved = connection('connection-1', 'mysql')
    connectionMocks.createConnection.mockResolvedValue(saved)
    connectionMocks.listConnections.mockResolvedValue([saved])

    await expect(useConnectionStore.getState().saveConnection(input('mysql'))).resolves.toEqual(saved)

    expect(connectionMocks.listConnections).toHaveBeenCalledOnce()
    expect(useConnectionStore.getState().connections).toEqual([saved])
    expect(useConnectionStore.getState().loading).toBe(false)
  })

  it('replaces an updated connection without duplicating it', async () => {
    const existing = connection('connection-1', 'mysql')
    const updated = connection('connection-1', 'mysql production')
    useConnectionStore.setState({ connections: [existing] })
    connectionMocks.updateConnection.mockResolvedValue(updated)
    connectionMocks.listConnections.mockResolvedValue([updated])

    await useConnectionStore.getState().saveConnection(input(updated.name, updated.id))

    expect(useConnectionStore.getState().connections).toEqual([updated])
    expect(useConnectionStore.getState().loading).toBe(false)
  })

  it('retains the saved connection when the follow-up list refresh fails', async () => {
    const saved = connection('connection-1', 'mysql')
    connectionMocks.createConnection.mockResolvedValue(saved)
    connectionMocks.listConnections.mockRejectedValue(new Error('refresh unavailable'))

    await useConnectionStore.getState().saveConnection(input(saved.name))

    expect(useConnectionStore.getState().connections).toEqual([saved])
    expect(useConnectionStore.getState().loading).toBe(false)
    expect(useConnectionStore.getState().error).toContain('refresh unavailable')
    expect(useUiStore.getState().notifications.at(-1)).toMatchObject({ kind: 'error' })
  })

  it('allows consecutive connection saves', async () => {
    const first = connection('connection-1', 'mysql one')
    const second = connection('connection-2', 'mysql two')
    connectionMocks.createConnection.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    connectionMocks.listConnections.mockResolvedValueOnce([first]).mockResolvedValueOnce([first, second])

    await useConnectionStore.getState().saveConnection(input(first.name))
    await useConnectionStore.getState().saveConnection(input(second.name))

    expect(connectionMocks.createConnection).toHaveBeenCalledTimes(2)
    expect(connectionMocks.listConnections).toHaveBeenCalledTimes(2)
    expect(useConnectionStore.getState().connections).toEqual([first, second])
    expect(useConnectionStore.getState().loading).toBe(false)
  })

  it('releases loading and notifies when persistence fails', async () => {
    connectionMocks.createConnection.mockRejectedValue(new Error('disk full'))

    await expect(useConnectionStore.getState().saveConnection(input('mysql'))).rejects.toThrow('disk full')

    expect(useConnectionStore.getState().loading).toBe(false)
    expect(useConnectionStore.getState().error).toContain('disk full')
    expect(useUiStore.getState().notifications.at(-1)).toMatchObject({ kind: 'error' })
  })
})
