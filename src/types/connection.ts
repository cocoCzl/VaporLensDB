export interface ConnectionConfig {
  id: string
  name: string
  driverDefinitionId?: string | null
  driverType: DriverType
  driverDialect?: string | null
  host?: string | null
  port?: number | null
  database?: string | null
  connectionUrl?: string | null
  username?: string | null
  driverClass?: string | null
  driverPaths?: string[]
  sslMode?: string | null
  groupId?: string | null
  group?: string | null
  colorTag?: string | null
  sshTunnel?: SshTunnelConfig | null
  /** Non-sensitive state for rendering the password toggle. */
  hasSavedPassword?: boolean
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
  driverDialect?: string | null
  host?: string | null
  port?: number | null
  database?: string | null
  connectionUrl?: string | null
  username?: string | null
  password?: string | null
  /** Persist the supplied password in encrypted system storage. Defaults to true. */
  savePassword?: boolean
  driverClass?: string | null
  driverPaths?: string[]
  sslMode?: string | null
  groupId?: string | null
  group?: string | null
  colorTag?: string | null
  sshTunnel?: SshTunnelInput | null
}

export interface DataSourceGroup {
  id: string
  name: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type SshAuthMethod = 'password' | 'privateKey'

export interface SshTunnelConfig {
  enabled: boolean
  host: string
  port: number
  username: string
  authMethod: SshAuthMethod
  privateKeyPath?: string | null
  remoteHost?: string | null
  remotePort?: number | null
  localHost?: string | null
}

export interface SshTunnelInput extends SshTunnelConfig {
  password?: string | null
  privateKeyPassphrase?: string | null
}
