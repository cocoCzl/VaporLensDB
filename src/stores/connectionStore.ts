import { create } from 'zustand'
import i18n from '@/i18n'
import {
  connect,
  createDataSourceGroup,
  createConnection,
  deleteDataSourceGroup,
  deleteConnection,
  disconnect,
  listConnections,
  listConnectionStatuses,
  listDataSourceGroups,
  renameDataSourceGroup,
  reorderDataSourceGroups,
  setConnectionDataSourceGroup,
  testConnection,
  updateConnection,
} from '@/ipc/connection'
import { normalizeAppError } from '@/ipc/client'
import { useMetadataStore } from '@/stores/metadataStore'
import { useEditorStore } from '@/stores/editorStore'
import { useUiStore } from '@/stores/uiStore'
import type { ConnectionConfig, ConnectionInput, ConnectionStatus, DataSourceGroup } from '@/types/connection'

const RECENT_DATA_SOURCES_STORAGE_KEY = 'vaporlensdb.recentDataSources'
const FAVORITE_DATA_SOURCES_STORAGE_KEY = 'vaporlensdb.favoriteDataSources'
const MAX_RECENT_DATA_SOURCES = 6

interface ConnectionState {
  connections: ConnectionConfig[]
  dataSourceGroups: DataSourceGroup[]
  statuses: Record<string, ConnectionStatus>
  /** The Data Source selected for object navigation. */
  browsingConnectionId: string | null
  /** @deprecated use browsingConnectionId; retained while existing panels migrate. */
  activeConnectionId: string | null
  recentDataSourceIds: string[]
  favoriteDataSourceIds: string[]
  busyConnectionIds: Record<string, true>
  loading: boolean
  error: string | null
  loadConnections: () => Promise<void>
  loadDataSourceGroups: () => Promise<void>
  createGroup: (name: string) => Promise<DataSourceGroup>
  renameGroup: (id: string, name: string) => Promise<DataSourceGroup>
  reorderGroups: (ids: string[]) => Promise<void>
  deleteGroup: (id: string) => Promise<void>
  moveConnectionToGroup: (connectionId: string, groupId: string | null) => Promise<void>
  saveConnection: (input: ConnectionInput) => Promise<ConnectionConfig>
  removeConnection: (id: string) => Promise<void>
  testConnectionInput: (input: ConnectionInput) => Promise<void>
  connectConnection: (id: string, options?: { selectForBrowsing?: boolean }) => Promise<void>
  disconnectConnection: (id: string) => Promise<void>
  setConnections: (connections: ConnectionConfig[]) => void
  setActiveConnection: (id: string | null) => void
  toggleFavoriteDataSource: (id: string) => void
}

function errorMessage(error: unknown) {
  return summarizeConnectionError(normalizeAppError(error).message)
}

function notifyError(error: unknown, title: string) {
  useUiStore.getState().notifyError(normalizeAppError(error), title)
}

function indexStatuses(statuses: ConnectionStatus[]) {
  return Object.fromEntries(statuses.map((status) => [status.connectionId, status]))
}

function summarizeConnectionError(message: string) {
  const normalized = message.replace(/\s+/g, ' ').trim()
  const noRoute = normalized.match(/No route to host[^.。]*/i)?.[0]
  if (noRoute) return noRoute
  if (/The Network Adapter could not establish the connection/i.test(normalized)) {
    return i18n.t('notifications.networkUnreachable')
  }
  return normalized.length > 120 ? `${normalized.slice(0, 120)}...` : normalized
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [],
  dataSourceGroups: [],
  statuses: {},
  browsingConnectionId: null,
  activeConnectionId: null,
  recentDataSourceIds: readStoredRecentDataSourceIds(),
  favoriteDataSourceIds: readStoredFavoriteDataSourceIds(),
  busyConnectionIds: {},
  loading: false,
  error: null,
  loadConnections: async () => {
    if (get().loading) return
    set({ loading: true, error: null })
    const [connectionsResult, statusesResult, groupsResult] = await Promise.allSettled([
      listConnections(),
      listConnectionStatuses(),
      listDataSourceGroups(),
    ])
    const failures = [
      connectionsResult.status === 'rejected' ? `connections: ${errorMessage(connectionsResult.reason)}` : null,
      statusesResult.status === 'rejected' ? `statuses: ${errorMessage(statusesResult.reason)}` : null,
      groupsResult.status === 'rejected' ? `groups: ${errorMessage(groupsResult.reason)}` : null,
    ].filter((value): value is string => value !== null)
    const connections = connectionsResult.status === 'fulfilled' ? connectionsResult.value : get().connections
    const statuses = statusesResult.status === 'fulfilled' ? statusesResult.value : Object.values(get().statuses)
    const dataSourceGroups = groupsResult.status === 'fulfilled' ? groupsResult.value : get().dataSourceGroups
    const loadError = failures.join(' · ')

    set((state) => ({
      connections,
      dataSourceGroups,
      statuses: indexStatuses(statuses),
      favoriteDataSourceIds: retainKnownDataSourceIds(state.favoriteDataSourceIds, connections),
      error: loadError || null,
      loading: false,
    }))
    if (loadError) {
      useUiStore.getState().notify({
        kind: 'error',
        title: i18n.t('notifications.loadConnectionsFailed'),
        message: loadError,
      })
    }
    const knownIds = new Set(connections.map((connection) => connection.id))
    for (const tab of useEditorStore.getState().tabs) {
      if ((tab.kind === 'sql' || !tab.kind) && tab.connectionId && !knownIds.has(tab.connectionId)) {
        useEditorStore.getState().markConnectionUnavailable(
          tab.connectionId,
          tab.unavailableConnectionName ?? i18n.t('connection.dataSource'),
        )
      }
    }
  },
  loadDataSourceGroups: async () => {
    try {
      set({ dataSourceGroups: await listDataSourceGroups() })
    } catch (error) {
      notifyError(error, i18n.t('notifications.loadConnectionsFailed'))
      throw error
    }
  },
  createGroup: async (name) => {
    const group = await createDataSourceGroup(name)
    set((state) => ({ dataSourceGroups: [...state.dataSourceGroups, group] }))
    return group
  },
  renameGroup: async (id, name) => {
    const group = await renameDataSourceGroup(id, name)
    set((state) => ({
      dataSourceGroups: state.dataSourceGroups.map((item) => item.id === id ? group : item),
      connections: state.connections.map((connection) =>
        connection.groupId === id ? { ...connection, group: group.name } : connection,
      ),
    }))
    return group
  },
  reorderGroups: async (ids) => {
    const groups = await reorderDataSourceGroups(ids)
    set({ dataSourceGroups: groups })
  },
  deleteGroup: async (id) => {
    await deleteDataSourceGroup(id)
    set((state) => ({
      dataSourceGroups: state.dataSourceGroups.filter((group) => group.id !== id),
      connections: state.connections.map((connection) =>
        connection.groupId === id ? { ...connection, groupId: null, group: null } : connection,
      ),
    }))
  },
  moveConnectionToGroup: async (connectionId, groupId) => {
    await setConnectionDataSourceGroup(connectionId, groupId)
    set((state) => {
      const group = groupId ? state.dataSourceGroups.find((item) => item.id === groupId) : null
      return {
        connections: state.connections.map((connection) => connection.id === connectionId
          ? { ...connection, groupId, group: group?.name ?? null }
          : connection),
      }
    })
  },
  saveConnection: async (input) => {
    set({ loading: true, error: null })
    try {
      const saved = input.id ? await updateConnection(input) : await createConnection(input)
      await get().loadConnections()
      return saved
    } catch (error) {
      set({ error: errorMessage(error), loading: false })
      notifyError(error, i18n.t('notifications.saveConnectionFailed'))
      throw error
    }
  },
  removeConnection: async (id) => {
    set((state) => ({
      busyConnectionIds: markConnectionBusy(state.busyConnectionIds, id),
      error: null,
    }))
    try {
      const removed = get().connections.find((connection) => connection.id === id)
      await deleteConnection(id)
      set((state) => ({
        connections: state.connections.filter((connection) => connection.id !== id),
        statuses: Object.fromEntries(
          Object.entries(state.statuses).filter(([connectionId]) => connectionId !== id),
        ),
        activeConnectionId: state.activeConnectionId === id ? null : state.activeConnectionId,
        browsingConnectionId: state.browsingConnectionId === id ? null : state.browsingConnectionId,
        recentDataSourceIds: forgetRecentDataSource(state.recentDataSourceIds, id),
        favoriteDataSourceIds: forgetFavoriteDataSource(state.favoriteDataSourceIds, id),
      }))
      useMetadataStore.getState().clearConnection(id)
      if (removed) {
        useEditorStore.getState().markConnectionUnavailable(id, removed.name)
      }
    } catch (error) {
      set({ error: errorMessage(error) })
      notifyError(error, i18n.t('notifications.deleteConnectionFailed'))
      throw error
    } finally {
      set((state) => ({ busyConnectionIds: clearConnectionBusy(state.busyConnectionIds, id) }))
    }
  },
  testConnectionInput: async (input) => {
    set({ loading: true, error: null })
    try {
      await testConnection(input)
      set({ loading: false })
      useUiStore.getState().notify({
        kind: 'success',
        title:
          input.driverType === 'oracle' || input.driverType === 'jdbc'
            ? i18n.t('notifications.driverConfigValid')
            : i18n.t('notifications.connectionTestSucceeded'),
        message: input.name,
      })
    } catch (error) {
      set({ error: errorMessage(error), loading: false })
      notifyError(error, i18n.t('notifications.testConnectionFailed'))
      throw error
    }
  },
  connectConnection: async (id, options = {}) => {
    set((state) => ({
      busyConnectionIds: markConnectionBusy(state.busyConnectionIds, id),
      error: null,
    }))
    try {
      const status = await connect(id)
      useMetadataStore.getState().clearConnection(id)
      set((state) => ({
        statuses: { ...state.statuses, [id]: status },
        activeConnectionId: options.selectForBrowsing === false ? state.activeConnectionId : id,
        browsingConnectionId: options.selectForBrowsing === false ? state.browsingConnectionId : id,
        recentDataSourceIds: options.selectForBrowsing === false
          ? state.recentDataSourceIds
          : rememberRecentDataSource(state.recentDataSourceIds, id),
      }))
    } catch (error) {
      const message = errorMessage(error)
      set((state) => ({
        error: message,
        statuses: {
          ...state.statuses,
          [id]: {
            connectionId: id,
            status: 'failed',
            message,
          },
        },
        activeConnectionId: options.selectForBrowsing === false ? state.activeConnectionId : id,
        browsingConnectionId: options.selectForBrowsing === false ? state.browsingConnectionId : id,
      }))
      useMetadataStore.getState().clearConnection(id)
      notifyError(error, i18n.t('notifications.connectFailed'))
      throw error
    } finally {
      set((state) => ({ busyConnectionIds: clearConnectionBusy(state.busyConnectionIds, id) }))
    }
  },
  disconnectConnection: async (id) => {
    set((state) => ({
      busyConnectionIds: markConnectionBusy(state.busyConnectionIds, id),
      error: null,
    }))
    try {
      const status = await disconnect(id)
      set((state) => ({
        statuses: { ...state.statuses, [id]: status },
        activeConnectionId: state.activeConnectionId === id ? null : state.activeConnectionId,
        browsingConnectionId: state.browsingConnectionId === id ? null : state.browsingConnectionId,
      }))
      useMetadataStore.getState().clearConnection(id)
    } catch (error) {
      set({ error: errorMessage(error) })
      notifyError(error, i18n.t('notifications.disconnectFailed'))
      throw error
    } finally {
      set((state) => ({ busyConnectionIds: clearConnectionBusy(state.busyConnectionIds, id) }))
    }
  },
  setConnections: (connections) => set({ connections }),
  setActiveConnection: (id) =>
    set((state) => ({
      activeConnectionId: id,
      browsingConnectionId: id,
      recentDataSourceIds: id
        ? rememberRecentDataSource(state.recentDataSourceIds, id)
        : state.recentDataSourceIds,
    })),
  toggleFavoriteDataSource: (id) =>
    set((state) => ({
      favoriteDataSourceIds: toggleFavoriteDataSource(state.favoriteDataSourceIds, id),
    })),
}))

function markConnectionBusy(current: Record<string, true>, id: string): Record<string, true> {
  return { ...current, [id]: true }
}

function clearConnectionBusy(current: Record<string, true>, id: string): Record<string, true> {
  return Object.fromEntries(
    Object.entries(current).filter(([connectionId]) => connectionId !== id),
  )
}

function readStoredRecentDataSourceIds() {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_DATA_SOURCES_STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : []
  } catch {
    return []
  }
}

function readStoredFavoriteDataSourceIds() {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(FAVORITE_DATA_SOURCES_STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : []
  } catch {
    return []
  }
}

function rememberRecentDataSource(currentIds: string[], id: string) {
  const next = [id, ...currentIds.filter((currentId) => currentId !== id)].slice(
    0,
    MAX_RECENT_DATA_SOURCES,
  )
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(RECENT_DATA_SOURCES_STORAGE_KEY, JSON.stringify(next))
  }
  return next
}

function forgetRecentDataSource(currentIds: string[], id: string) {
  const next = currentIds.filter((currentId) => currentId !== id)
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(RECENT_DATA_SOURCES_STORAGE_KEY, JSON.stringify(next))
  }
  return next
}

function toggleFavoriteDataSource(currentIds: string[], id: string) {
  const next = currentIds.includes(id)
    ? currentIds.filter((currentId) => currentId !== id)
    : [id, ...currentIds]
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(FAVORITE_DATA_SOURCES_STORAGE_KEY, JSON.stringify(next))
  }
  return next
}

function forgetFavoriteDataSource(currentIds: string[], id: string) {
  const next = currentIds.filter((currentId) => currentId !== id)
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(FAVORITE_DATA_SOURCES_STORAGE_KEY, JSON.stringify(next))
  }
  return next
}

function retainKnownDataSourceIds(ids: string[], connections: ConnectionConfig[]) {
  const knownIds = new Set(connections.map((connection) => connection.id))
  const next = ids.filter((id) => knownIds.has(id))
  if (next.length !== ids.length && typeof window !== 'undefined') {
    window.localStorage.setItem(FAVORITE_DATA_SOURCES_STORAGE_KEY, JSON.stringify(next))
  }
  return next
}
