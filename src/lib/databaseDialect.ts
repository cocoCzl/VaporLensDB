import descriptors from '@/shared/database-dialects.json'
import type { ConnectionConfig, DriverType } from '@/types/connection'

/** Shared with Rust. Unknown dialects cannot authorize generated SQL. */
export function resolveSqlDialect(value: string | null | undefined): DriverType | null {
  const normalized = value?.toLowerCase()
  return (Object.entries(descriptors).find(([, d]) => d.aliases.includes(normalized ?? ''))?.[0] as DriverType | undefined) ?? null
}
export function connectionSqlDialect(connection: Pick<ConnectionConfig, 'driverDialect' | 'driverType'>): DriverType {
  return resolveSqlDialect(connection.driverDialect || connection.driverType) ?? 'jdbc'
}
export function sqlDialectDescriptor(driverType: DriverType) {
  if (!(driverType in descriptors)) throw new Error('Automatic SQL is unavailable for an unknown dialect. Use the SQL editor.')
  return descriptors[driverType as keyof typeof descriptors]
}
