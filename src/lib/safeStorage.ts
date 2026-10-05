export type StorageReadStatus = 'ok' | 'missing' | 'malformed' | 'invalid' | 'unavailable'

export interface StorageReadResult<T> {
  status: StorageReadStatus
  value?: T
}

const reportedWriteFailures = new Set<string>()

export function readStorageString<T extends string = string>(
  key: string,
  validate?: (value: string) => value is T,
): StorageReadResult<T> {
  const storage = getStorage()
  if (!storage) return { status: 'unavailable' }

  let raw: string | null
  try {
    raw = storage.getItem(key)
  } catch {
    return { status: 'unavailable' }
  }

  if (raw === null) return { status: 'missing' }
  if (validate && !validate(raw)) return { status: 'invalid' }
  return { status: 'ok', value: raw as T }
}

export function readStorageJson<T>(
  key: string,
  validate: (value: unknown) => value is T,
): StorageReadResult<T> {
  const raw = readStorageString(key)
  if (raw.status !== 'ok') return { status: raw.status }

  try {
    const parsed: unknown = JSON.parse(raw.value as string)
    return validate(parsed)
      ? { status: 'ok', value: parsed }
      : { status: 'invalid' }
  } catch {
    return { status: 'malformed' }
  }
}

export function writeStorageString(
  key: string,
  value: string,
  onFailure?: () => void,
): boolean {
  const storage = getStorage()
  if (!storage) {
    reportWriteFailure(key, onFailure)
    return false
  }

  try {
    storage.setItem(key, value)
    reportedWriteFailures.delete(key)
    return true
  } catch {
    reportWriteFailure(key, onFailure)
    return false
  }
}

export function writeStorageJson(
  key: string,
  value: unknown,
  onFailure?: () => void,
): boolean {
  try {
    return writeStorageString(key, JSON.stringify(value), onFailure)
  } catch {
    reportWriteFailure(key, onFailure)
    return false
  }
}

export function removeStorageValue(key: string, onFailure?: () => void): boolean {
  const storage = getStorage()
  if (!storage) {
    reportWriteFailure(key, onFailure)
    return false
  }

  try {
    storage.removeItem(key)
    reportedWriteFailures.delete(key)
    return true
  } catch {
    reportWriteFailure(key, onFailure)
    return false
  }
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function reportWriteFailure(key: string, onFailure?: () => void) {
  if (reportedWriteFailures.has(key)) return
  reportedWriteFailures.add(key)
  onFailure?.()
}
