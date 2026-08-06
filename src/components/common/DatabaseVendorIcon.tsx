import { Database } from 'lucide-react'
import type { ComponentPropsWithoutRef } from 'react'
import type { DriverType } from '@/types/connection'
import mysqlIconUrl from '@/assets/database/mysql.svg'
import postgresqlIconUrl from '@/assets/database/postgresql.svg'
import sqliteIconUrl from '@/assets/database/sqlite.svg'

type DatabaseVendorIconProps = Omit<ComponentPropsWithoutRef<'svg'>, 'children'> & {
  driverType: DriverType | string | null | undefined
}

/** A compact, brand-coloured database mark with a neutral fallback for custom drivers. */
export function DatabaseVendorIcon({ driverType, className, ...props }: DatabaseVendorIconProps) {
  const sharedProps = {
    viewBox: '0 0 24 24',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    className,
    ...props,
  }

  switch (driverType) {
    case 'postgres':
      return <svg {...sharedProps}><image href={postgresqlIconUrl} width="24" height="24" /></svg>
    case 'mysql':
      return <svg {...sharedProps}><image href={mysqlIconUrl} width="24" height="24" /></svg>
    case 'oracle':
      return <svg {...sharedProps}><path stroke="#C74634" strokeWidth="4.1" d="M5 12a7 7 0 1 0 14 0 7 7 0 0 0-14 0Z" /></svg>
    case 'sqlite':
      return <svg {...sharedProps}><image href={sqliteIconUrl} width="24" height="24" /></svg>
    case 'mssql':
      return <svg {...sharedProps}><path fill="#F25022" d="M3 3h8v8H3z" /><path fill="#7FBA00" d="M13 3h8v8h-8z" /><path fill="#00A4EF" d="M3 13h8v8H3z" /><path fill="#FFB900" d="M13 13h8v8h-8z" /></svg>
    default:
      return <Database className={className} {...props} />
  }
}
