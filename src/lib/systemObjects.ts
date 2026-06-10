import type { DriverType } from '@/types/connection'

const POSTGRES_SYSTEM_SCHEMAS = ['pg_catalog', 'information_schema']
const MYSQL_SYSTEM_DATABASES = ['information_schema', 'mysql', 'performance_schema', 'sys']
const ORACLE_SYSTEM_SCHEMAS = [
  'SYS',
  'SYSTEM',
  'XDB',
  'MDSYS',
  'CTXSYS',
  'AUDSYS',
  'DBSNMP',
  'DVSYS',
  'GSMADMIN_INTERNAL',
  'LBACSYS',
  'OLAPSYS',
  'ORDDATA',
  'ORDSYS',
  'OUTLN',
  'WMSYS',
]

export function isSystemDatabase(driverType: DriverType, name: string) {
  if (driverType === 'mysql') {
    return MYSQL_SYSTEM_DATABASES.includes(name.toLowerCase())
  }
  return false
}

export function isSystemSchema(driverType: DriverType, name: string) {
  if (driverType === 'postgres') {
    return name.startsWith('pg_toast') || POSTGRES_SYSTEM_SCHEMAS.includes(name)
  }
  if (driverType === 'mysql') {
    return isSystemDatabase(driverType, name)
  }
  if (driverType === 'oracle') {
    return ORACLE_SYSTEM_SCHEMAS.includes(name.toUpperCase())
  }
  return false
}
