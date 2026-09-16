import type { DriverType } from '@/types/connection'

/** Canonical initial display names for built-in datasource types. */
export function defaultConnectionName(driverType: DriverType): string {
  switch (driverType) {
    case 'postgres': return 'Local PostgreSQL'
    case 'mysql': return 'Local MySQL'
    case 'sqlite': return 'Local SQLite'
    case 'mssql': return 'Local SQL Server'
    case 'oracle': return 'Local Oracle'
    case 'jdbc': return 'Custom JDBC'
    case 'mongo': return 'MongoDB'
    case 'redis': return 'Redis'
  }
}

/** Applies a driver switch without replacing a name the user has typed. */
export function nextConnectionName(currentName: string, nameIsGenerated: boolean, driverType: DriverType): string {
  return nameIsGenerated ? defaultConnectionName(driverType) : currentName
}
