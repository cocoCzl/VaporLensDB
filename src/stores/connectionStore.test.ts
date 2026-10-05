import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import zh from '@/locales/zh.json'
import type { ConnectionConfig, ConnectionInput } from '@/types/connection'
import { useMetadataStore } from '@/stores/metadataStore'

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
  renameConnection: vi.fn(),
  renameDataSourceGroup: vi.fn(),
  reorderDataSourceGroups: vi.fn(),
  setConnectionDataSourceGroup: vi.fn(),
  testConnection: vi.fn(),
  updateConnection: vi.fn(),
}))

vi.mock('@/ipc/connection', () => connectionMocks)

import { useConnectionStore } from '@/stores/connectionStore'
import { useUiStore } from '@/stores/uiStore'
import { useEditorStore } from '@/stores/editorStore'

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

  it('filters stale recent and favorite ids using their own storage keys', async () => {
    const saved = connection('known', 'Known')
    connectionMocks.listConnections.mockResolvedValue([saved])
    useConnectionStore.setState({ recentDataSourceIds: ['known', 'deleted'], favoriteDataSourceIds: ['deleted'] })
    useEditorStore.setState({ tabs: [{ id: 'sql', title: 'SQL', sql: 'SELECT 1', connectionId: 'deleted' }], activeTabId: 'sql' })

    await useConnectionStore.getState().loadConnections()

    expect(useConnectionStore.getState().recentDataSourceIds).toEqual(['known'])
    expect(useConnectionStore.getState().favoriteDataSourceIds).toEqual([])
    expect(JSON.parse(window.localStorage.getItem('vaporlensdb.recentDataSources')!)).toEqual(['known'])
    expect(JSON.parse(window.localStorage.getItem('vaporlensdb.favoriteDataSources')!)).toEqual([])
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ sql: 'SELECT 1', connectionId: 'deleted', unavailableConnectionName: expect.any(String) })
    expect(useConnectionStore.getState().browsingConnectionId).toBeNull()
  })

  it('preserves ids and workspace references when the authoritative connection list fails', async () => {
    connectionMocks.listConnections.mockRejectedValue(new Error('unavailable'))
    useConnectionStore.setState({ recentDataSourceIds: ['known'], favoriteDataSourceIds: ['known'] })
    useEditorStore.setState({ tabs: [{ id: 'sql', title: 'SQL', sql: 'SELECT 1', connectionId: 'known' }], activeTabId: 'sql' })

    await useConnectionStore.getState().loadConnections()

    expect(useConnectionStore.getState().recentDataSourceIds).toEqual(['known'])
    expect(useConnectionStore.getState().favoriteDataSourceIds).toEqual(['known'])
    expect(useEditorStore.getState().tabs[0].unavailableConnectionName).toBeUndefined()
  })

  it('keeps favorite and browsing selection usable when preference writes fail', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    try {
      expect(() => useConnectionStore.getState().toggleFavoriteDataSource('known')).not.toThrow()
      expect(() => useConnectionStore.getState().setActiveConnection('known')).not.toThrow()
      expect(useConnectionStore.getState().favoriteDataSourceIds).toEqual(['known'])
      expect(useConnectionStore.getState().recentDataSourceIds).toEqual(['known'])
      expect(useConnectionStore.getState().browsingConnectionId).toBe('known')
    } finally {
      setItem.mockRestore()
    }
  })

  it('persists only datasource ids rather than connection credentials', async () => {
    const saved = connection('known', 'Known')
    connectionMocks.createConnection.mockResolvedValue(saved)
    connectionMocks.listConnections.mockResolvedValue([saved])
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    await useConnectionStore.getState().saveConnection(input('Known'))
    useConnectionStore.getState().setActiveConnection(saved.id)
    useConnectionStore.getState().toggleFavoriteDataSource(saved.id)
    expect(setItem).toHaveBeenCalled()
    for (const [key, value] of setItem.mock.calls) {
      expect(['vaporlensdb.recentDataSources', 'vaporlensdb.favoriteDataSources']).toContain(key)
      expect(JSON.parse(value)).toEqual(['known'])
      expect(value).not.toContain('secret')
    }
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

  it('renames only the datasource display name through the dedicated persistence command', async () => {
    const existing = connection('connection-1', 'Local MySQL')
    const renamed = { ...existing, name: 'QA MySQL' }
    useConnectionStore.setState({ connections: [existing] })
    connectionMocks.renameConnection.mockResolvedValue(renamed)

    await expect(useConnectionStore.getState().renameConnection(existing.id, '  QA MySQL  ')).resolves.toEqual(renamed)

    expect(connectionMocks.renameConnection).toHaveBeenCalledWith(existing.id, 'QA MySQL')
    expect(connectionMocks.updateConnection).not.toHaveBeenCalled()
    expect(useConnectionStore.getState().connections).toEqual([renamed])
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

describe('idle reclaim status ordering', () => {
  const reclaimed = { connectionId: 'connection-1', status: 'disconnected' as const, message: 'reclaimed after 5 minutes of inactivity' }

  beforeEach(() => {
    vi.clearAllMocks()
    useConnectionStore.setState({
      connections: [connection('connection-1', 'mysql')],
      statuses: { 'connection-1': { connectionId: 'connection-1', status: 'connected' } },
      busyConnectionIds: {},
      statusRevisions: {},
      lifecycleEpochs: {},
      reclaimRequestTokens: {},
      favoriteDataSourceIds: ['connection-1'],
      recentDataSourceIds: ['connection-1'],
    })
  })

  it('does not let a late reclaim event overwrite a successful reconnect', async () => {
    connectionMocks.listConnectionStatuses.mockResolvedValue([{ connectionId: 'connection-1', status: 'connected' }])
    const clear = vi.spyOn(useMetadataStore.getState(), 'clearConnection')
    await useConnectionStore.getState().synchronizeIdleReclaim(reclaimed, 2)
    expect(useConnectionStore.getState().statuses['connection-1'].status).toBe('connected')
    expect(clear).not.toHaveBeenCalled()
  })

  it('rejects an old disconnected snapshot if reconnect completes while validation is pending', async () => {
    let resolveSnapshot!: (value: typeof reclaimed[]) => void
    connectionMocks.listConnectionStatuses.mockReturnValue(new Promise<typeof reclaimed[]>((resolve) => { resolveSnapshot = resolve }))
    connectionMocks.connect.mockResolvedValue({ connectionId: 'connection-1', status: 'connected' })
    const pending = useConnectionStore.getState().synchronizeIdleReclaim(reclaimed, 2)
    await useConnectionStore.getState().connectConnection('connection-1')
    const clear = vi.spyOn(useMetadataStore.getState(), 'clearConnection')
    resolveSnapshot([reclaimed])
    await pending
    expect(useConnectionStore.getState().statuses['connection-1'].status).toBe('connected')
    expect(clear).not.toHaveBeenCalled()
  })

  it('does not apply a disconnected snapshot while reconnect is still in flight', async () => {
    let resolveConnect!: (value: { connectionId: string; status: string }) => void
    connectionMocks.connect.mockReturnValue(new Promise((resolve) => { resolveConnect = resolve }))
    connectionMocks.listConnectionStatuses.mockResolvedValue([reclaimed])
    const reconnect = useConnectionStore.getState().connectConnection('connection-1')
    await useConnectionStore.getState().synchronizeIdleReclaim(reclaimed, 2)
    expect(useConnectionStore.getState().statuses['connection-1'].status).toBe('connected')
    resolveConnect({ connectionId: 'connection-1', status: 'connected' })
    await reconnect
  })

  it('applies an authoritative reclaim and preserves the saved datasource and navigation history', async () => {
    connectionMocks.listConnectionStatuses.mockResolvedValue([reclaimed])
    const clear = vi.spyOn(useMetadataStore.getState(), 'clearConnection')
    const configs = useConnectionStore.getState().connections
    await useConnectionStore.getState().synchronizeIdleReclaim(reclaimed, 2)
    expect(useConnectionStore.getState().statuses['connection-1']).toEqual(reclaimed)
    expect(useConnectionStore.getState().connections).toBe(configs)
    expect(useConnectionStore.getState().favoriteDataSourceIds).toEqual(['connection-1'])
    expect(useConnectionStore.getState().recentDataSourceIds).toEqual(['connection-1'])
    expect(clear).toHaveBeenCalledExactlyOnceWith('connection-1')
    await useConnectionStore.getState().synchronizeIdleReclaim(reclaimed, 2)
    expect(clear).toHaveBeenCalledOnce()
  })

  it('keeps the latest event validation and ignores an older pending validation', async () => {
    let resolveOld!: (value: typeof reclaimed[]) => void
    connectionMocks.listConnectionStatuses.mockReturnValueOnce(new Promise<typeof reclaimed[]>((resolve) => { resolveOld = resolve }))
      .mockResolvedValueOnce([reclaimed])
    const oldRequest = useConnectionStore.getState().synchronizeIdleReclaim(reclaimed, 2)
    await useConnectionStore.getState().synchronizeIdleReclaim(reclaimed, 4)
    resolveOld([{ ...reclaimed, message: 'old status' }])
    await oldRequest
    expect(useConnectionStore.getState().statuses['connection-1'].message).toBe(reclaimed.message)
    expect(useConnectionStore.getState().statusRevisions['connection-1']).toBe(4)
  })

  it('does not recreate a deleted datasource status', async () => {
    connectionMocks.listConnectionStatuses.mockResolvedValue([reclaimed])
    useConnectionStore.setState({ connections: [], statuses: {} })
    await useConnectionStore.getState().synchronizeIdleReclaim(reclaimed, 2)
    expect(useConnectionStore.getState().statuses).toEqual({})
  })

  it('snapshot failure is propagated and does not pretend that reclaim was validated', async () => {
    connectionMocks.listConnectionStatuses.mockRejectedValueOnce(new Error('snapshot unavailable'))
    await expect(useConnectionStore.getState().synchronizeIdleReclaim(reclaimed, 2)).rejects.toThrow('snapshot unavailable')
    expect(useConnectionStore.getState().statuses['connection-1'].status).toBe('connected')
  })

  it('does not invalidate another datasource event because of unrelated connection activity', async () => {
    const saved = connection('connection-2', 'mysql')
    useConnectionStore.setState({
      connections: [connection('connection-1', 'mysql'), saved],
      lifecycleEpochs: { 'connection-2': 5 },
    })
    connectionMocks.listConnectionStatuses.mockResolvedValue([reclaimed])
    await useConnectionStore.getState().synchronizeIdleReclaim(reclaimed, 2)
    expect(useConnectionStore.getState().statuses['connection-1'].status).toBe('disconnected')
  })
})
