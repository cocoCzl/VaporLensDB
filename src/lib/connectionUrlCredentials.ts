export type ExtractedUrlCredentials = {
  connectionUrl: string
  username?: string
  password?: string
}

/**
 * Moves credentials out of common database URL forms before the connection is
 * persisted. Unknown formats are deliberately left untouched rather than
 * risking a broken custom JDBC URL.
 */
export function extractUrlCredentials(value: string): ExtractedUrlCredentials {
  const trimmed = value.trim()
  if (!trimmed) return { connectionUrl: trimmed }

  const sqlServerCredentials = extractSqlServerCredentials(trimmed)
  const sanitized = sqlServerCredentials.connectionUrl

  const jdbcPrefix = sanitized.startsWith('jdbc:') ? 'jdbc:' : ''
  const candidate = jdbcPrefix ? sanitized.slice(jdbcPrefix.length) : sanitized
  try {
    const url = new URL(candidate)
    let username = url.username ? decodeCredential(url.username) : sqlServerCredentials.username
    let password = url.password ? decodeCredential(url.password) : sqlServerCredentials.password
    let hasCredentials = Boolean(url.username || url.password || username !== undefined || password !== undefined)
    for (const [key, value] of [...url.searchParams]) {
      const normalizedKey = key.toLowerCase()
      if (normalizedKey === 'user' || normalizedKey === 'username') {
        username ??= value
      } else if (normalizedKey === 'password') {
        password ??= value
      } else {
        continue
      }
      hasCredentials = true
      url.searchParams.delete(key)
    }
    if (!hasCredentials) return { connectionUrl: sanitized }
    url.username = ''
    url.password = ''
    return { connectionUrl: `${jdbcPrefix}${url.toString()}`, username, password }
  } catch {
    return sqlServerCredentials
  }
}

function decodeCredential(value: string): string {
  return new URLSearchParams(`value=${value.replaceAll('+', '%2B').replaceAll('&', '%26')}`).get('value') ?? value
}

function extractSqlServerCredentials(value: string): ExtractedUrlCredentials {
  if (!/^jdbc:sqlserver:/i.test(value) && !/(?:^|;)\s*(?:user(?:\s*id)?|username|password)\s*=/i.test(value)) {
    return { connectionUrl: value }
  }
  let username: string | undefined
  let password: string | undefined
  const connectionUrl = splitConnectionProperties(value)
    .filter((part) => {
      const match = part.match(/^\s*(user(?:\s*id)?|username|password)\s*=\s*(.*)\s*$/i)
      if (!match) return true
      const value = match[2].trim()
      const credential = value.startsWith('{') && value.endsWith('}')
        ? value.slice(1, -1).replaceAll('}}', '}')
        : value
      if (/^password$/i.test(match[1])) password ??= credential
      else username ??= credential
      return false
    })
    .join(';')
  return { connectionUrl, username, password }
}

function splitConnectionProperties(value: string): string[] {
  const parts: string[] = []
  let braced = false
  let start = 0
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === '{') braced = true
    else if (character === '}' && braced && value[index + 1] === '}') index += 1
    else if (character === '}') braced = false
    else if (character === ';' && !braced) {
      parts.push(value.slice(start, index))
      start = index + 1
    }
  }
  parts.push(value.slice(start))
  return parts
}
