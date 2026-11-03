import { expect, it } from 'vitest'
import { redactConnectionDiagnostic } from './connectionTestDiagnostics'

it('redacts echoed, encoded, SSH and property secrets while retaining actionable diagnostics', () => {
  const result = redactConnectionDiagnostic('SQLSTATE 28000 host=db.invalid arbitrary=pa ss% / pa%20ss%25 ssh-value property-value jdbc:oracle:thin:user/other@db.invalid password="saved value" jdbc:postgresql://user:legacy@db.invalid/db?token=unknown Authorization: Bearer private-token', {
    name: 'QA', driverType: 'postgres', password: 'pa ss%',
    sshTunnel: { enabled: true, host: 'bastion', port: 22, username: 'qa', authMethod: 'password', password: 'ssh-value' },
    driverProperties: [{ name: 'key', value: 'property-value', sensitive: true }],
  })
  for (const secret of ['pa ss%', 'pa%20ss%25', 'ssh-value', 'property-value', 'user/other', 'saved value', 'user:legacy', 'unknown', 'private-token']) expect(result).not.toContain(secret)
  expect(result).toContain('SQLSTATE 28000 host=db.invalid')
  expect(result).toContain('[REDACTED]')
})
