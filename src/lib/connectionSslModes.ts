import type { DriverType } from '@/types/connection'

export function supportedSslModes(driverType: DriverType, currentMode?: string | null) {
  const supported = (() => {
    switch (driverType) {
      case 'postgres': return ['', 'disable', 'prefer', 'require', 'verify-ca', 'verify-full']
      case 'mysql': return ['', 'disable', 'require', 'verify-ca', 'verify-full']
      case 'mssql': return ['', 'require']
      default: return ['']
    }
  })()
  // Preserve a legacy value while editing so the user can see and clear it;
  // changing to a new driver never carries an unsupported mode forward.
  return currentMode && !supported.includes(currentMode) ? [...supported, currentMode] : supported
}
