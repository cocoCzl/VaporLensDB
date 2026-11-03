import type { ConnectionInput } from '@/types/connection'

/** Untrusted driver text may echo credentials even when the IPC error is redacted. */
export function redactConnectionDiagnostic(value: string, input: ConnectionInput): string {
  const secrets = [
    input.password, input.sshTunnel?.password, input.sshTunnel?.privateKeyPassphrase,
    ...(input.driverProperties ?? []).filter(property => property.sensitive).map(property => property.value),
  ].filter((secret): secret is string => Boolean(secret))
  let redacted = value
  for (const secret of [...new Set(secrets.flatMap(secret => [secret, encodeURIComponent(secret)]))].sort((a, b) => b.length - a.length)) {
    redacted = redacted.split(secret).join('[REDACTED]')
  }
  return redacted
    .replace(/(\b[a-z][a-z\d+.-]*:\/\/)[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/(\bjdbc:oracle:thin:)[^\s/@]+\/[^\s@]+@/gi, '$1[REDACTED]@')
    .replace(/(["']?\b(?:password|passwd|pwd|pass|token|access_token|api_key|secret|sslpassword|passphrase)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s&;,\r\n]+)/gi, '$1[REDACTED]')
    .replace(/(\bauthorization\s*:\s*)(?:bearer\s+)?[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/\bbearer\s+[a-z\d._~+/=-]+/gi, 'Bearer [REDACTED]')
}
