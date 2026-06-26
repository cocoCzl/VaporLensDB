import { create } from 'zustand'
import i18n from '@/i18n'
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
      useUiStore.getState().notifyError(appError, i18n.t('notifications.loadDriverCatalogFailed'))
    }
  },
  saveDriver: async (driver) => {
    set({ loading: true, error: null })
    try {
      const saved = await saveCustomDriverDefinition(driver)
      await get().loadDrivers(true)
      useUiStore.getState().notify({ kind: 'success', title: i18n.t('notifications.driverDefinitionSaved') })
      return saved
    } catch (error) {
      const appError = normalizeAppError(error)
      set({ error: appError.message, loading: false })
      useUiStore.getState().notifyError(appError, i18n.t('notifications.saveDriverDefinitionFailed'))
      return null
    }
  },
  deleteDriver: async (id) => {
    set({ loading: true, error: null })
    try {
      await deleteCustomDriverDefinition(id)
      await get().loadDrivers(true)
      useUiStore.getState().notify({ kind: 'success', title: i18n.t('notifications.driverDefinitionDeleted') })
      return true
    } catch (error) {
      const appError = normalizeAppError(error)
      set({ error: appError.message, loading: false })
      useUiStore.getState().notifyError(appError, i18n.t('notifications.deleteDriverDefinitionFailed'))
      return false
    }
  },
  importJdbcArtifacts: async (driverDefinitionId, paths) => {
    set({ loading: true, error: null })
    try {
      const saved = await importJdbcDriverArtifacts({ driverDefinitionId, paths })
      await get().loadDrivers(true)
      useUiStore.getState().notify({ kind: 'success', title: i18n.t('notifications.jdbcJarImported') })
      return saved
    } catch (error) {
      const appError = normalizeAppError(error)
      set({ error: appError.message, loading: false })
      useUiStore.getState().notifyError(appError, i18n.t('notifications.importJdbcJarFailed'))
      return null
    }
  },
  removeJdbcArtifact: async (driverDefinitionId, path) => {
    set({ loading: true, error: null })
    try {
      const saved = await removeJdbcDriverArtifact({ driverDefinitionId, path })
      await get().loadDrivers(true)
      useUiStore.getState().notify({ kind: 'success', title: i18n.t('notifications.jdbcJarRemoved') })
      return saved
    } catch (error) {
      const appError = normalizeAppError(error)
      set({ error: appError.message, loading: false })
      useUiStore.getState().notifyError(appError, i18n.t('notifications.removeJdbcJarFailed'))
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
      useUiStore.getState().notify({ kind: 'success', title: i18n.t('notifications.externalDriverValidated') })
      return result
    } catch (error) {
      const appError = normalizeAppError(error)
      return { valid: false, message: appError.message }
    }
  },
}))
