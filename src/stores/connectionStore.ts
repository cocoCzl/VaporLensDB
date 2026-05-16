import { create } from 'zustand'
import type { ConnectionConfig } from '@/types/connection'

interface ConnectionState {
  connections: ConnectionConfig[]
  activeConnectionId: string | null
  setConnections: (connections: ConnectionConfig[]) => void
  setActiveConnection: (id: string | null) => void
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  connections: [],
  activeConnectionId: null,
  setConnections: (connections) => set({ connections }),
  setActiveConnection: (id) => set({ activeConnectionId: id }),
}))