import { invoke, type InvokeArgs } from '@tauri-apps/api/core'
import i18n from '@/i18n'
import type { AppError } from '@/types/error'
import type { CommandName } from '@/ipc/contracts'

export async function invokeCommand<T>(command: CommandName, args?: InvokeArgs): Promise<T> {
  if (!isTauriRuntime()) {
    throw {
      code: 'TAURI_RUNTIME_UNAVAILABLE',
      message: i18n.t('runtime.tauriUnavailable'),
    } satisfies AppError
  }

  try {
    return await invoke<T>(command, args)
  } catch (error) {
    throw normalizeAppError(error)
  }
}

export function normalizeAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return error
  }

  if (typeof error === 'string') {
    const parsed = parseErrorJson(error)
    if (parsed) return parsed
    return { code: 'UNKNOWN_ERROR', message: error }
  }

  if (error instanceof Error) {
    const parsed = parseErrorJson(error.message)
    if (parsed) return parsed
    return { code: 'UNKNOWN_ERROR', message: error.message }
  }

  return { code: 'UNKNOWN_ERROR', message: 'Unknown error' }
}

function parseErrorJson(value: string): AppError | null {
  try {
    const parsed = JSON.parse(value)
    return isAppError(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isAppError(value: unknown): value is AppError {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<AppError>
  return typeof candidate.code === 'string' && typeof candidate.message === 'string'
}

function isTauriRuntime() {
  if (typeof window === 'undefined') {
    return false
  }

  return '__TAURI_INTERNALS__' in window
}
