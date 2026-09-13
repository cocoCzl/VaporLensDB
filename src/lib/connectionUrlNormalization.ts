import type { ConnectionInput } from '@/types/connection'

export type ConnectionUrlVariant = 'hostPort' | 'urlOnly' | 'oracleService' | 'oracleSid' | 'file'

export type ConnectionUrlProfile = {
  usesUrl?: boolean
  defaultUrl: (input: ConnectionInput, variant: ConnectionUrlVariant) => string
}

export function normalizeConnectionUrl(
  input: ConnectionInput,
  variant: ConnectionUrlVariant,
  profile: ConnectionUrlProfile,
) {
  return profile.usesUrl && variant !== 'urlOnly' && variant !== 'file'
    ? emptyToNull(profile.defaultUrl(input, variant))
    : emptyToNull(input.connectionUrl)
}

function emptyToNull(value: string | null | undefined) {
  return value && value.trim() ? value.trim() : null
}
