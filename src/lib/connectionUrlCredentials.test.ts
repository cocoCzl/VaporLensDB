import { describe, expect, it } from 'vitest'
import { extractUrlCredentials } from '@/lib/connectionUrlCredentials'
import fixtures from '@/lib/__fixtures__/connectionUrlCredentials.json'

describe('URL input credentials', () => {
  it('prefers authority credentials while stripping every query credential', () => {
    expect(extractUrlCredentials('postgres://alice:authorityDummy@host/db?password=queryDummy&user=bob&sslmode=require')).toEqual({
      connectionUrl: 'postgres://host/db?sslmode=require',
      username: 'alice',
      password: 'authorityDummy',
    })
  })

  it.each(fixtures)('$name', ({ input, connectionUrl, username, password }) => {
    const extracted = extractUrlCredentials(input)
    expect(extracted.connectionUrl).toBe(connectionUrl)
    expect(extracted.username).toBe(username)
    expect(extracted.password).toBe(password)
  })
})
