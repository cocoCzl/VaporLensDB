import { create } from 'zustand'
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
import { useUiStore } from '@/stores/uiStore'
import type { ConnectionConfig, ConnectionInput, ConnectionStatus } from '@/types/connection'

interface ConnectionState {
  connections: ConnectionConfig[]
  statuses: Record<string, ConnectionStatus>
  activeConnectionId: string | null
  loading: boolean
  error: string | null
  loadConnections: () => Promise<void>
  saveConnection: (input: ConnectionInput) => Promise<void>
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
    return '目标数据库网络不可达，请检查主机、端口、防火墙或 VPN。'
  }
  return normalized.length > 120 ? `${normalized.slice(0, 120)}...` : normalized
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [],
  statuses: {},
  activeConnectionId: null,
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
      notifyError(error, '加载连接失败')
    }
  },
  saveConnection: async (input) => {
    set({ loading: true, error: null })
    try {
      if (input.id) {
        await updateConnection(input)
      } else {
        await createConnection(input)
      }
      await get().loadConnections()
    } catch (error) {
      set({ error: errorMessage(error), loading: false })
      notifyError(error, '保存连接失败')
      throw error
    }
  },
  removeConnection: async (id) => {
    set({ loading: true, error: null })
    try {
      await deleteConnection(id)
      set((state) => ({
        connections: state.connections.filter((connection) => connection.id !== id),
        activeConnectionId: state.activeConnectionId === id ? null : state.activeConnectionId,
        loading: false,
      }))
    } catch (error) {
      set({ error: errorMessage(error), loading: false })
      notifyError(error, '删除连接失败')
      throw error
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
          input.driverType === 'oracle' || input.driverType === 'jdbc' || input.driverType === 'odbc'
            ? '驱动配置校验成功'
            : '连接测试成功',
        message: input.name,
      })
    } catch (error) {
      set({ error: errorMessage(error), loading: false })
      notifyError(error, '连接测试失败')
      throw error
    }
  },
  connectConnection: async (id) => {
    set({ loading: true, error: null })
    try {
      const status = await connect(id)
      set((state) => ({
        statuses: { ...state.statuses, [id]: status },
        activeConnectionId: id,
        loading: false,
      }))
    } catch (error) {
      set({ error: errorMessage(error), loading: false })
      notifyError(error, '连接失败')
      throw error
    }
  },
  disconnectConnection: async (id) => {
    set({ loading: true, error: null })
    try {
      const status = await disconnect(id)
      set((state) => ({
        statuses: { ...state.statuses, [id]: status },
        activeConnectionId: state.activeConnectionId === id ? null : state.activeConnectionId,
        loading: false,
      }))
    } catch (error) {
      set({ error: errorMessage(error), loading: false })
      notifyError(error, '断开连接失败')
      throw error
    }
  },
  setConnections: (connections) => set({ connections }),
  setActiveConnection: (id) => set({ activeConnectionId: id }),
}))
