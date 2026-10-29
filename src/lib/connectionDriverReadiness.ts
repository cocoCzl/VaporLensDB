import i18n from '@/i18n'
import { useDriverStore } from '@/stores/driverStore'
import type { ConnectionConfig } from '@/types/connection'
import type { DriverDefinition, DriverInstallation } from '@/types/driver'

type Registry = { drivers: DriverDefinition[]; installations: DriverInstallation[] }
/** UI readiness checks references only. Rust additionally verifies file bytes and Java. */
export function connectionDriverReadiness(connection: ConnectionConfig, registry: Registry = useDriverStore.getState()): string | null {
  const id = connection.driverDefinitionId ?? connection.driverType
  const definition = registry.drivers.find((d) => d.id === id)
  if (!definition) {
    if (registry.drivers.length || connection.productId) return i18n.t('driverRefactor.missingReference')
    // Legacy unnormalized data while the initial registry is loading.
    if (connection.driverType !== 'oracle' && connection.driverType !== 'jdbc') return null
    if (!connection.driverClass?.trim()) return i18n.t('connectionForm.validation.missingJdbcClassReadiness')
    return connection.driverPaths?.length ? null : i18n.t('connectionForm.validation.missingJarReadiness')
  }
  if (connection.productId && connection.productId !== definition.productId) return i18n.t('driverRefactor.missingReference')
  if (definition.status === 'planned' || !definition.capabilities.canConnect) return i18n.t('connectionForm.statusPlanned')
  if (definition.backend === 'nativeRust') return null
  if (!definition.jdbcDriverClass?.trim()) return i18n.t('connectionForm.validation.missingJdbcClassReadiness')
  const installationId = connection.driverInstallationId ?? (connection.productId ? null : definition.defaultInstallationId)
  if (!installationId) return i18n.t('connectionForm.validation.missingJarReadiness')
  const installation = registry.installations.find((i) => i.id === installationId && i.driverDefinitionId === definition.id)
  return installation?.artifacts.length ? null : i18n.t('driverRefactor.missingReference')
}
