import { describe, expect, it } from 'vitest'
import { normalizeConnectionEndpoint } from '@/lib/connectionEndpoint'

describe('normalizeConnectionEndpoint', () => {
  it('splits a pasted IPv4 endpoint into the native host and port fields', () => {
    expect(normalizeConnectionEndpoint('192.0.2.20:3306', 3306)).toEqual({
      host: '192.0.2.20',
      port: 3306,
    })
  })

  it('does not mistake an IPv6 literal for a host-port pair', () => {
    expect(normalizeConnectionEndpoint('2001:db8::1', 3306)).toEqual({
      host: '2001:db8::1',
      port: 3306,
    })
  })

  it('leaves an invalid embedded port for normal field validation', () => {
    expect(normalizeConnectionEndpoint('db.internal:70000', 3306)).toEqual({
      host: 'db.internal:70000',
      port: 3306,
    })
  })
})
