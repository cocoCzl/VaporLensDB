export type ConnectionEndpoint = {
  host: string
  port: number | null | undefined
}

/**
 * Host and port are separate native-driver fields. Accept the common
 * paste form `host:port` without treating IPv6 literals as host/port pairs.
 */
export function normalizeConnectionEndpoint(
  host: string | null | undefined,
  port: number | null | undefined,
): ConnectionEndpoint {
  const normalizedHost = host?.trim() ?? ''
  const match = /^([^:\s]+):(\d{1,5})$/.exec(normalizedHost)
  if (!match) return { host: normalizedHost, port }

  const embeddedPort = Number(match[2])
  if (!Number.isInteger(embeddedPort) || embeddedPort < 1 || embeddedPort > 65_535) {
    return { host: normalizedHost, port }
  }

  return { host: match[1], port: embeddedPort }
}
