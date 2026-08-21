import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@/i18n'

Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
  configurable: true,
  value() {
    return { width: 800, height: 400, top: 0, right: 800, bottom: 400, left: 0, x: 0, y: 0, toJSON() {} }
  },
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})
