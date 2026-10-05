import { describe, expect, it, vi } from 'vitest'
import {
  readStorageJson,
  readStorageString,
  removeStorageValue,
  writeStorageJson,
  writeStorageString,
} from '@/lib/safeStorage'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

describe('safe browser storage', () => {
  it('distinguishes missing, valid, malformed, and invalid JSON', () => {
    expect(readStorageJson('missing', isRecord).status).toBe('missing')

    window.localStorage.setItem('valid', JSON.stringify({ value: 1 }))
    expect(readStorageJson('valid', isRecord)).toEqual({ status: 'ok', value: { value: 1 } })

    window.localStorage.setItem('malformed', '{')
    expect(readStorageJson('malformed', isRecord).status).toBe('malformed')

    window.localStorage.setItem('invalid', JSON.stringify(['not', 'an', 'object']))
    expect(readStorageJson('invalid', isRecord).status).toBe('invalid')
  })

  it('validates raw strings without exposing unsupported values', () => {
    window.localStorage.setItem('language', 'fr')
    expect(readStorageString('language', (value): value is 'zh' | 'en' => value === 'zh' || value === 'en').status)
      .toBe('invalid')
  })

  it('handles getItem SecurityError as unavailable', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })

    expect(readStorageString('blocked').status).toBe('unavailable')
    getItem.mockRestore()
  })

  it('handles a blocked storage accessor for every operation', () => {
    const storage = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(readStorageString('accessor').status).toBe('unavailable')
    expect(writeStorageString('accessor', 'value')).toBe(false)
    expect(removeStorageValue('accessor')).toBe(false)
    storage.mockRestore()
  })

  it('handles serialization errors without exposing the value or overwriting storage', () => {
    window.localStorage.setItem('serialization', 'previous')
    const onFailure = vi.fn()
    expect(writeStorageJson('serialization', BigInt(1), onFailure)).toBe(false)
    expect(window.localStorage.getItem('serialization')).toBe('previous')
    expect(onFailure).toHaveBeenCalledOnce()
  })

  it('writes JSON and removes values successfully', () => {
    expect(writeStorageJson('settings', { theme: 'dark' })).toBe(true)
    expect(window.localStorage.getItem('settings')).toBe(JSON.stringify({ theme: 'dark' }))
    expect(removeStorageValue('settings')).toBe(true)
    expect(window.localStorage.getItem('settings')).toBeNull()
  })

  it('deduplicates write failures until a later success', () => {
    const onFailure = vi.fn()
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })

    expect(writeStorageString('quota', 'first', onFailure)).toBe(false)
    expect(writeStorageString('quota', 'second', onFailure)).toBe(false)
    expect(onFailure).toHaveBeenCalledOnce()

    setItem.mockRestore()
    expect(writeStorageString('quota', 'recovered', onFailure)).toBe(true)

    const blockedAgain = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(writeStorageString('quota', 'third', onFailure)).toBe(false)
    expect(onFailure).toHaveBeenCalledTimes(2)
    blockedAgain.mockRestore()
  })

  it('swallows removeItem failures', () => {
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })

    expect(removeStorageValue('blocked')).toBe(false)
    removeItem.mockRestore()
  })
})
