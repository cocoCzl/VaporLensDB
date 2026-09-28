import { describe, expect, it } from 'vitest'
import { supportedSslModes } from './connectionSslModes'

describe('supported SSL modes', () => {
  it('exposes only modes implemented by native drivers', () => {
    expect(supportedSslModes('postgres')).toEqual(['', 'disable', 'prefer', 'require', 'verify-ca', 'verify-full'])
    expect(supportedSslModes('mysql')).toEqual(['', 'disable', 'require', 'verify-ca', 'verify-full'])
    expect(supportedSslModes('mssql')).toEqual(['', 'require'])
    expect(supportedSslModes('oracle')).toEqual([''])
  })

  it('keeps an unsupported legacy value visible until the user clears it', () => {
    expect(supportedSslModes('mysql', 'prefer')).toEqual(['', 'disable', 'require', 'verify-ca', 'verify-full', 'prefer'])
  })
})
