import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import zh from '@/locales/zh.json'
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
    host: '192.0.2.20',
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
    host: '192.0.2.20',
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

describe('connection store disconnect lifecycle', () => {
  beforeEach(() => {
    for (const mock of Object.values(connectionMocks)) mock.mockReset()
    useConnectionStore.setState({
      statuses: { 'connection-1': { connectionId: 'connection-1', status: 'connected' } },
      busyConnectionIds: {},
      browsingConnectionId: 'connection-1',
      activeConnectionId: 'connection-1',
      error: null,
    })
    useUiStore.setState({ notifications: [] })
  })

  it('disconnects an idle connection once and clears its selected context', async () => {
    connectionMocks.disconnect.mockResolvedValue({ connectionId: 'connection-1', status: 'disconnected' })

    await useConnectionStore.getState().disconnectConnection('connection-1')

    expect(connectionMocks.disconnect).toHaveBeenCalledOnce()
    expect(useConnectionStore.getState().statuses['connection-1']?.status).toBe('disconnected')
    expect(useConnectionStore.getState().activeConnectionId).toBeNull()
    expect(useConnectionStore.getState().browsingConnectionId).toBeNull()
  })

  it('does not issue another disconnect for an already disconnected or busy connection', async () => {
    useConnectionStore.setState({
      statuses: { 'connection-1': { connectionId: 'connection-1', status: 'disconnected' } },
    })
    await useConnectionStore.getState().disconnectConnection('connection-1')

    useConnectionStore.setState({
      statuses: { 'connection-1': { connectionId: 'connection-1', status: 'connected' } },
      busyConnectionIds: { 'connection-1': true },
    })
    await useConnectionStore.getState().disconnectConnection('connection-1')

    expect(connectionMocks.disconnect).not.toHaveBeenCalled()
  })

  it('keeps the connection selected when the backend rejects a raced disconnect', async () => {
    connectionMocks.disconnect.mockRejectedValue({
      code: 'DISCONNECT_BLOCKED',
      message: 'Connection cannot be disconnected while operations are running',
    })

    await expect(useConnectionStore.getState().disconnectConnection('connection-1')).rejects.toMatchObject({ code: 'DISCONNECT_BLOCKED' })

    expect(useConnectionStore.getState().statuses['connection-1']?.status).toBe('connected')
    expect(useConnectionStore.getState().activeConnectionId).toBe('connection-1')
    const notification = useUiStore.getState().notifications.at(-1)
    expect(notification).toMatchObject({
      kind: 'error',
      title: expect.any(String),
    })
    expect(notification?.message).toBe(useConnectionStore.getState().error)
    expect(notification?.message).not.toContain('operations are running')
  })
})

describe('saved credential recovery', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    for (const mock of Object.values(connectionMocks)) mock.mockReset()
    const saved = connection('connection-1', 'Saved MySQL')
    useConnectionStore.setState({
      connections: [saved],
      statuses: {},
      browsingConnectionId: null,
      activeConnectionId: null,
      busyConnectionIds: {},
      error: null,
    })
    useUiStore.setState({ notifications: [] })
  })

  it('keeps datasource metadata and gives controlled re-entry guidance when silent credential access fails', async () => {
    connectionMocks.connect.mockRejectedValue({
      code: 'SAVED_CREDENTIAL_UNAVAILABLE',
      message: 'Unable to access the saved database password. Please enter it again.',
    })

    await expect(useConnectionStore.getState().connectConnection('connection-1'))
      .rejects.toMatchObject({ code: 'SAVED_CREDENTIAL_UNAVAILABLE' })

    expect(useConnectionStore.getState().connections).toEqual([connection('connection-1', 'Saved MySQL')])
    expect(useConnectionStore.getState().statuses['connection-1']).toMatchObject({ status: 'failed' })
    expect(useConnectionStore.getState().error).toBe(
      'The previously saved password is unavailable. Please re-enter the database password in the connection settings and save.',
    )
    expect(useUiStore.getState().notifications.at(-1)?.message).toBe(useConnectionStore.getState().error)

    await i18n.changeLanguage('zh')
    expect(i18n.t('connection.savedCredentialUnavailable')).toBe(zh.connection.savedCredentialUnavailable)
  })
})
