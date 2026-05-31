import type { DriverType } from '@/types/connection'

export interface DriverDefinition {
  id: DriverType
  name: string
  backend: DriverBackend
  status: DriverStatus
  defaultPort?: number | null
  defaultUsername?: string | null
  defaultDatabase?: string | null
  jdbcDriverClass?: string | null
  urlTemplate?: string | null
  driverArtifact?: string | null
  userDriverRequired: boolean
  builtIn: boolean
  notes?: string | null
  capabilities: DriverDefinitionCapabilities
}

export type DriverBackend = 'nativeRust' | 'jdbc' | 'odbc' | 'planned'

export type DriverStatus = 'ready' | 'configurable' | 'planned'

export interface DriverDefinitionCapabilities {
  canConnect: boolean
  canQuery: boolean
  canStream: boolean
  canReadMetadata: boolean
  canCancel: boolean
  canGenerateDdl: boolean
}

export interface ValidateExternalDriverInput {
  driverType: DriverType
  connectionUrl?: string | null
  driverClass?: string | null
  driverPaths?: string[]
}

export interface ExternalDriverValidation {
  valid: boolean
  message: string
}
