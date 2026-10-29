import { create } from 'zustand'
import i18n from '@/i18n'
import {
  deleteCustomDriverDefinition,
  listDatabaseProducts, listDriverInstallations, saveDatabaseProduct, deleteDriverInstallation,
  importJdbcDriverArtifacts,
  listDriverDefinitions,
  removeJdbcDriverArtifact,
  saveCustomDriverDefinition,
  validateExternalDriver,
} from '@/ipc/driver'
import { normalizeAppError } from '@/ipc/client'
import { useUiStore } from '@/stores/uiStore'
import type { DatabaseProduct, DriverInstallation, DriverDefinition, ExternalDriverValidation } from '@/types/driver'

interface DriverState {
  drivers: DriverDefinition[]
  products: DatabaseProduct[]
  installations: DriverInstallation[]
  deleteInstallation: (id: string) => Promise<boolean>
  loading: boolean
  error: string | null
  loadDrivers: (force?: boolean) => Promise<void>
  saveDriver: (driver: DriverDefinition) => Promise<DriverDefinition | null>
  deleteDriver: (id: string) => Promise<boolean>
  importJdbcArtifacts: (driverDefinitionId: string, paths: string[], label?: string) => Promise<DriverDefinition | null>
  removeJdbcArtifact: (driverDefinitionId: string, path: string) => Promise<DriverDefinition | null>
  validateDriver: (driver: DriverDefinition) => Promise<ExternalDriverValidation>
}

export const useDriverStore = create<DriverState>((set, get) => ({
  drivers: [],
  products: [],
  installations: [],
  deleteInstallation: async (id) => {
    try { await deleteDriverInstallation(id); await get().loadDrivers(true); return true }
    catch (error) { const appError = normalizeAppError(error); set({ error: appError.message }); useUiStore.getState().notifyError(appError); return false }
  },
  loading: false,
  error: null,
  loadDrivers: async (force = false) => {
    if (!force && (get().drivers.length > 0 || get().loading)) {
      return
    }

    set({ loading: true, error: null })
    try {
      const [drivers, products, installations] = await Promise.all([listDriverDefinitions(), listDatabaseProducts(), listDriverInstallations()])
      set({ drivers, products, installations, loading: false })
    } catch (error) {
      const appError = normalizeAppError(error)
      set({ error: appError.message, loading: false })
      useUiStore.getState().notifyError(appError, i18n.t('notifications.loadDriverCatalogFailed'))
    }
  },
  saveDriver: async (driver) => {
    set({ loading: true, error: null })
    try {
      const { newProductName, ...definition } = driver
      if (!definition.id) definition.id = `custom-${crypto.randomUUID()}`
      if (!definition.productId) {
        const product = await saveDatabaseProduct({ id: `product-${crypto.randomUUID()}`, name: newProductName?.trim() || definition.name, iconKey: 'jdbc', builtIn: false, adapterId: 'genericSql', defaultDriverDefinitionId: definition.id })
        definition.productId = product.id
      } else if (newProductName?.trim()) {
        const product = get().products.find((p) => p.id === definition.productId)
        if (product && !product.builtIn && product.name !== newProductName.trim()) await saveDatabaseProduct({ ...product, name: newProductName.trim() })
      }
      const saved = await saveCustomDriverDefinition(definition)
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
  importJdbcArtifacts: async (driverDefinitionId, paths, label) => {
    set({ loading: true, error: null })
    try {
      const saved = await importJdbcDriverArtifacts({ driverDefinitionId, paths, label })
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
        installationId: driver.defaultInstallationId,
        driverType: driver.driverType,
        connectionUrl: driver.urlTemplate,
        driverClass: driver.jdbcDriverClass,
        driverPaths: driver.driverArtifacts,
      })
      if (driver.defaultInstallationId) await get().loadDrivers(true)
      if (result.valid) useUiStore.getState().notify({ kind: 'success', title: i18n.t('notifications.externalDriverValidated') })
      return result.valid ? { ...result, message: i18n.t('driverRefactor.classValidationSuccess') } : result
    } catch (error) {
      const appError = normalizeAppError(error)
      return { valid: false, message: appError.message }
    }
  },
}))
