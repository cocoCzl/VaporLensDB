import type { DriverType } from '@/types/connection'

export interface DriverDefinition {
  /** Draft-only, consumed when creating a product. */
  newProductName?: string
  productId?: string
  defaultInstallationId?: string | null
  nativeImplementationId?: string | null
  id: string
  driverType: DriverType
  driverDialect: string
  name: string
  backend: DriverBackend
  status: DriverStatus
  defaultPort?: number | null
  defaultUsername?: string | null
  defaultDatabase?: string | null
  jdbcDriverClass?: string | null
  urlTemplate?: string | null
  driverArtifact?: string | null
  driverArtifacts: string[]
  userDriverRequired: boolean
  builtIn: boolean
  downloadUrl?: string | null
  notes?: string | null
  connectionVariants: DriverConnectionVariant[]
  metadataDialectSql?: string | null
  capabilities: DriverDefinitionCapabilities
}

export type DriverBackend = 'nativeRust' | 'jdbc'

export type DriverStatus = 'ready' | 'configurable' | 'planned'

export interface DriverDefinitionCapabilities {
  canConnect: boolean
  canQuery: boolean
  canStream: boolean
  canReadMetadata: boolean
  canCancel: boolean
  canGenerateDdl: boolean
}

export interface DriverConnectionVariant {
  id: string
  label: string
  requiredFields: string[]
}

export interface ValidateExternalDriverInput {
  installationId?: string | null
  driverType: DriverType
  connectionUrl?: string | null
  driverClass?: string | null
  driverPaths?: string[]
}

export interface ImportJdbcDriverArtifactsInput {
  driverDefinitionId: string
  paths: string[]
  label?: string
}

export interface RemoveJdbcDriverArtifactInput {
  driverDefinitionId: string
  path: string
}

export interface ExternalDriverValidation {
  valid: boolean
  message: string
}

export interface DatabaseProduct {
  id: string
  name: string
  iconKey: string
  builtIn: boolean
  adapterId: string
  defaultDriverDefinitionId: string
}
export interface DriverInstallation {
  version?: string | null
  source?: { kind: string; urls: string[]; checksumSources: string[]; license: string | null } | null
  id: string
  driverDefinitionId: string
  label: string
  artifacts: { path: string; sha256: string | null; role: string }[]
  javaRequirement: string
  validation?: { fingerprint: string; checkedAt: string; classLoaded: boolean } | null
}

export interface JdbcDownloadRecipe {
  driverDefinitionId: string
  version: string
  license: string
  licenseUrl: string
  scope: string
  files: { file: string; url: string; sha256: string; checksumSource: string; size: number }[]
}
