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

  const jdbcPrefix = trimmed.startsWith('jdbc:') ? 'jdbc:' : ''
  const candidate = jdbcPrefix ? trimmed.slice(jdbcPrefix.length) : trimmed
  try {
    const url = new URL(candidate)
    const username = url.username ? decodeURIComponent(url.username) : undefined
    const password = url.password ? decodeURIComponent(url.password) : undefined
    if (!username && !password) {
      const queryCredentials = extractQueryCredentials(trimmed, jdbcPrefix, url)
      return queryCredentials.connectionUrl === trimmed
        ? extractSqlServerCredentials(trimmed)
        : queryCredentials
    }
    url.username = ''
    url.password = ''
    return { connectionUrl: `${jdbcPrefix}${url.toString()}`, username, password }
  } catch {
    return extractSqlServerCredentials(trimmed)
  }
}

function extractQueryCredentials(original: string, jdbcPrefix: string, url: URL): ExtractedUrlCredentials {
  const username = url.searchParams.get('user') ?? url.searchParams.get('username') ?? undefined
  const password = url.searchParams.get('password') ?? undefined
  if (!username && !password) return { connectionUrl: original }
  url.searchParams.delete('user')
  url.searchParams.delete('username')
  url.searchParams.delete('password')
  return { connectionUrl: `${jdbcPrefix}${url.toString()}`, username, password }
}

function extractSqlServerCredentials(value: string): ExtractedUrlCredentials {
  if (!/^jdbc:sqlserver:/i.test(value) && !/(?:^|;)\s*(?:user(?:\s*id)?|password)\s*=/i.test(value)) {
    return { connectionUrl: value }
  }
  let username: string | undefined
  let password: string | undefined
  const connectionUrl = value
    .split(';')
    .filter((part) => {
      const match = part.match(/^\s*(user(?:\s*id)?|password)\s*=\s*(.*)\s*$/i)
      if (!match) return true
      if (/^password$/i.test(match[1])) password = match[2]
      else username = match[2]
      return false
    })
    .join(';')
  return { connectionUrl, username, password }
}
