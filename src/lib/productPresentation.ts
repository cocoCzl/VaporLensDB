import { resolveSqlDialect } from '@/lib/databaseDialect'
import { useDriverStore } from '@/stores/driverStore'
import type { DatabaseProduct } from '@/types/driver'
import type { ConnectionConfig, DriverType } from '@/types/connection'
export function productDisplayName(connection: Pick<ConnectionConfig, 'productId' | 'driverType'>) {
  const product = useDriverStore.getState().products.find((p) => p.id === (connection.productId ?? connection.driverType))
  return product?.name ?? ({ postgres: 'PostgreSQL', mysql: 'MySQL', sqlite: 'SQLite', mssql: 'SQL Server', oracle: 'Oracle', jdbc: 'JDBC' } as Record<string, string>)[connection.driverType] ?? connection.driverType
}

/** Registered product semantics, never inferred from a compatibility dialect. */
export function connectionProductType(connection: Pick<ConnectionConfig, 'productId' | 'driverType'>, products: DatabaseProduct[] = useDriverStore.getState().products): DriverType {
  const product = products.find((p) => p.id === connection.productId)
  if (!product) return connection.driverType
  return resolveSqlDialect(product.adapterId) ?? 'jdbc'
}
