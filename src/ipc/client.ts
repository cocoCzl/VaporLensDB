import { invoke, type InvokeArgs } from '@tauri-apps/api/core'
import type { AppError } from '@/types/error'

export async function invokeCommand<T>(command: string, args?: InvokeArgs): Promise<T> {
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
