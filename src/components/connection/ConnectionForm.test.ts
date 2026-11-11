import { describe, expect, it } from 'vitest'
import { normalizeConnectionUrl } from '@/lib/connectionUrlNormalization'
import type { ConnectionInput } from '@/types/connection'
import { formatConnectionErrorDetail } from '@/lib/connectionErrorDetail'
import i18n from '@/i18n'

it('does not attach unused host fields to a full URL authentication error', () => {
  const detail = formatConnectionErrorDetail({ code: 'AUTH_ERROR', message: 'ORA-01005: null password given; logon denied' }, { ...baseInput, connectionMode: 'urlOnly', host: 'stale.invalid', port: 1521, connectionUrl: 'jdbc:oracle:thin:@//qa.invalid:1521/fixture_service' }, i18n.t)
  expect(detail).toContain('ORA-01005')
  expect(detail).not.toContain('stale.invalid')
  expect(detail).not.toContain('jdbc:oracle')
})

const baseInput: ConnectionInput = {
  name: 'SQLite QA',
  driverDefinitionId: 'sqlite',
  driverType: 'sqlite',
  driverDialect: 'sqlite',
  host: 'localhost',
  port: 0,
  database: '',
  connectionUrl: null,
  username: null,
  password: null,
  savePassword: false,
}

const generatedUrlProfile = {
  usesUrl: true,
  defaultUrl: (input: ConnectionInput) => `generated://${input.database ?? ''}`,
} as Parameters<typeof normalizeConnectionUrl>[2]

describe('normalizeInput file variants', () => {
  it('preserves a SQLite file path instead of regenerating it from a URL template', () => {
    const normalized = normalizeConnectionUrl(
      { ...baseInput, connectionUrl: '/tmp/example.sqlite' },
      'file',
      generatedUrlProfile,
    )

    expect(normalized).toBe('/tmp/example.sqlite')
  })

  it('preserves spaces and Unicode in a SQLite file path', () => {
    const path = '/tmp/测试路径/test database.sqlite' // i18n-hardcoded-ok: filesystem-path preservation regression input.
    const normalized = normalizeConnectionUrl(
      { ...baseInput, connectionUrl: path },
      'file',
      generatedUrlProfile,
    )

    expect(normalized).toBe(path)
  })

  it('continues generating URLs for non-file variants', () => {
    const normalized = normalizeConnectionUrl(
      { ...baseInput, driverType: 'mysql', database: 'qa_db', connectionUrl: '/ignored.sqlite' },
      'hostPort',
      generatedUrlProfile,
    )

    expect(normalized).toBe('generated://qa_db')
  })
})
