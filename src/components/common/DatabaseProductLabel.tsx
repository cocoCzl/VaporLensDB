import { productDisplayName } from '@/lib/productPresentation'
import { useDriverStore } from '@/stores/driverStore'
import type { ConnectionConfig } from '@/types/connection'
export function DatabaseProductLabel({ connection }: { connection: ConnectionConfig }) {
  const name = useDriverStore((s) => s.products.find((p) => p.id === (connection.productId ?? connection.driverType))?.name)
  return <>{name ?? productDisplayName(connection)}</>
}
