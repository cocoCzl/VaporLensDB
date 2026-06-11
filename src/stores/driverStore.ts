import { create } from 'zustand'
import {
  deleteCustomDriverDefinition,
  importJdbcDriverArtifacts,
  listDriverDefinitions,
  removeJdbcDriverArtifact,
  saveCustomDriverDefinition,
  validateExternalDriver,
} from '@/ipc/driver'
import { normalizeAppError } from '@/ipc/client'
import { useUiStore } from '@/stores/uiStore'
import type { DriverDefinition, ExternalDriverValidation } from '@/types/driver'

interface DriverState {
  drivers: DriverDefinition[]
  loading: boolean
  error: string | null
  loadDrivers: (force?: boolean) => Promise<void>
  saveDriver: (driver: DriverDefinition) => Promise<DriverDefinition | null>
  deleteDriver: (id: string) => Promise<boolean>
  importJdbcArtifacts: (driverDefinitionId: string, paths: string[]) => Promise<DriverDefinition | null>
  removeJdbcArtifact: (driverDefinitionId: string, path: string) => Promise<DriverDefinition | null>
  validateDriver: (driver: DriverDefinition) => Promise<ExternalDriverValidation>
}

export const useDriverStore = create<DriverState>((set, get) => ({
  drivers: [],
  loading: false,
  error: null,
  loadDrivers: async (force = false) => {
    if (!force && (get().drivers.length > 0 || get().loading)) {
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
  saveDriver: async (driver) => {
    set({ loading: true, error: null })
    try {
      const saved = await saveCustomDriverDefinition(driver)
      await get().loadDrivers(true)
      useUiStore.getState().notify({ kind: 'success', title: '驱动定义已保存' })
      return saved
    } catch (error) {
      const appError = normalizeAppError(error)
      set({ error: appError.message, loading: false })
      useUiStore.getState().notifyError(appError, '保存驱动定义失败')
      return null
    }
  },
  deleteDriver: async (id) => {
    set({ loading: true, error: null })
    try {
      await deleteCustomDriverDefinition(id)
      await get().loadDrivers(true)
      useUiStore.getState().notify({ kind: 'success', title: '驱动定义已删除' })
      return true
    } catch (error) {
      const appError = normalizeAppError(error)
      set({ error: appError.message, loading: false })
      useUiStore.getState().notifyError(appError, '删除驱动定义失败')
      return false
    }
  },
  importJdbcArtifacts: async (driverDefinitionId, paths) => {
    set({ loading: true, error: null })
    try {
      const saved = await importJdbcDriverArtifacts({ driverDefinitionId, paths })
      await get().loadDrivers(true)
      useUiStore.getState().notify({ kind: 'success', title: 'JDBC JAR 已导入' })
      return saved
    } catch (error) {
      const appError = normalizeAppError(error)
      set({ error: appError.message, loading: false })
      useUiStore.getState().notifyError(appError, '导入 JDBC JAR 失败')
      return null
    }
  },
  removeJdbcArtifact: async (driverDefinitionId, path) => {
    set({ loading: true, error: null })
    try {
      const saved = await removeJdbcDriverArtifact({ driverDefinitionId, path })
      await get().loadDrivers(true)
      useUiStore.getState().notify({ kind: 'success', title: 'JDBC JAR 已移除' })
      return saved
    } catch (error) {
      const appError = normalizeAppError(error)
      set({ error: appError.message, loading: false })
      useUiStore.getState().notifyError(appError, '移除 JDBC JAR 失败')
      return null
    }
  },
  validateDriver: async (driver) => {
    try {
      const result = await validateExternalDriver({
        driverType: driver.driverType,
        connectionUrl: driver.urlTemplate,
        driverClass: driver.jdbcDriverClass,
        driverPaths: driver.driverArtifacts,
      })
      useUiStore.getState().notify({ kind: 'success', title: '外部驱动校验通过' })
      return result
    } catch (error) {
      const appError = normalizeAppError(error)
      return { valid: false, message: appError.message }
    }
  },
}))
