export interface ConnectionConfig {
  id: string
  name: string
  driverDefinitionId?: string | null
  driverType: DriverType
  host?: string | null
  port?: number | null
  database?: string | null
  connectionUrl?: string | null
  username?: string | null
  driverClass?: string | null
  driverPaths?: string[]
  sslMode?: string | null
  group?: string | null
  colorTag?: string | null
  createdAt?: string
  updatedAt?: string
}

export type DriverType =
  | 'postgres'
  | 'mysql'
  | 'oracle'
  | 'sqlite'
  | 'mssql'
  | 'mongo'
  | 'redis'
  | 'odbc'
  | 'jdbc'

export type ConnectionRuntimeStatus = 'disconnected' | 'connecting' | 'connected' | 'failed'

export interface ConnectionStatus {
  connectionId: string
  status: ConnectionRuntimeStatus
  message?: string | null
}

export interface ConnectionInput {
  id?: string
  name: string
  driverDefinitionId?: string | null
  driverType: DriverType
  host?: string | null
  port?: number | null
  database?: string | null
  connectionUrl?: string | null
  username?: string | null
  password?: string | null
  driverClass?: string | null
  driverPaths?: string[]
  sslMode?: string | null
  group?: string | null
  colorTag?: string | null
}
