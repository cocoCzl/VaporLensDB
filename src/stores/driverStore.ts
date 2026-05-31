import { create } from 'zustand'
import { listDriverDefinitions } from '@/ipc/driver'
import { normalizeAppError } from '@/ipc/client'
import { useUiStore } from '@/stores/uiStore'
import type { DriverDefinition } from '@/types/driver'

interface DriverState {
  drivers: DriverDefinition[]
  loading: boolean
  error: string | null
  loadDrivers: () => Promise<void>
}

export const useDriverStore = create<DriverState>((set, get) => ({
  drivers: [],
  loading: false,
  error: null,
  loadDrivers: async () => {
    if (get().drivers.length > 0 || get().loading) {
      return
    }

    set({ loading: true, error: null })
    try {
      const drivers = await listDriverDefinitions()
      set({ drivers, loading: false })
    } catch (error) {
      const appError = normalizeAppError(error)
      set({ error: appError.message, loading: false })
      useUiStore.getState().notifyError(appError, '加载驱动目录失败')
    }
  },
}))
