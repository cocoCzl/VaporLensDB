import { create } from 'zustand'
import i18n from '@/i18n'
import {
  connect,
  createConnection,
  deleteConnection,
  disconnect,
  listConnections,
  listConnectionStatuses,
  testConnection,
  updateConnection,
} from '@/ipc/connection'
import { normalizeAppError } from '@/ipc/client'
import { useMetadataStore } from '@/stores/metadataStore'
import { useUiStore } from '@/stores/uiStore'
import type { ConnectionConfig, ConnectionInput, ConnectionStatus } from '@/types/connection'

const RECENT_DATA_SOURCES_STORAGE_KEY = 'vaporlensdb.recentDataSources'
const MAX_RECENT_DATA_SOURCES = 6

interface ConnectionState {
  connections: ConnectionConfig[]
  statuses: Record<string, ConnectionStatus>
  activeConnectionId: string | null
  recentDataSourceIds: string[]
  busyConnectionIds: Record<string, true>
  loading: boolean
  error: string | null
  loadConnections: () => Promise<void>
  saveConnection: (input: ConnectionInput) => Promise<ConnectionConfig>
  removeConnection: (id: string) => Promise<void>
  testConnectionInput: (input: ConnectionInput) => Promise<void>
  connectConnection: (id: string) => Promise<void>
  disconnectConnection: (id: string) => Promise<void>
  setConnections: (connections: ConnectionConfig[]) => void
  setActiveConnection: (id: string | null) => void
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
  statuses: {},
  activeConnectionId: null,
  recentDataSourceIds: readStoredRecentDataSourceIds(),
  busyConnectionIds: {},
  loading: false,
  error: null,
  loadConnections: async () => {
    set({ loading: true, error: null })
    try {
      const [connections, statuses] = await Promise.all([
        listConnections(),
        listConnectionStatuses(),
      ])
      set({ connections, statuses: indexStatuses(statuses), loading: false })
    } catch (error) {
      set({ error: errorMessage(error), loading: false })
      notifyError(error, i18n.t('notifications.loadConnectionsFailed'))
    }
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
      await deleteConnection(id)
      set((state) => ({
        connections: state.connections.filter((connection) => connection.id !== id),
        statuses: Object.fromEntries(
          Object.entries(state.statuses).filter(([connectionId]) => connectionId !== id),
        ),
        activeConnectionId: state.activeConnectionId === id ? null : state.activeConnectionId,
        recentDataSourceIds: forgetRecentDataSource(state.recentDataSourceIds, id),
      }))
      useMetadataStore.getState().clearConnection(id)
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
  connectConnection: async (id) => {
    set((state) => ({
      busyConnectionIds: markConnectionBusy(state.busyConnectionIds, id),
      error: null,
    }))
    try {
      const status = await connect(id)
      useMetadataStore.getState().clearConnection(id)
      set((state) => ({
        statuses: { ...state.statuses, [id]: status },
        activeConnectionId: id,
        recentDataSourceIds: rememberRecentDataSource(state.recentDataSourceIds, id),
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
        activeConnectionId: id,
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
      recentDataSourceIds: id
        ? rememberRecentDataSource(state.recentDataSourceIds, id)
        : state.recentDataSourceIds,
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
