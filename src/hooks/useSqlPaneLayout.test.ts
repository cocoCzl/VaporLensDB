import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useSqlPaneLayout } from './useSqlPaneLayout'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('reserves editing space, isolates Tab choices, and preserves a manual split across output and viewport changes', () => {
  let available = 600
  let resize = () => {}
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback } observe() {} disconnect = disconnect })
  const host = document.createElement('div')
  vi.spyOn(host, 'getBoundingClientRect').mockImplementation(() => ({ height: available }) as DOMRect)
  const tabs = [{ id: 'a' }, { id: 'b' }]
  const { result, rerender, unmount } = renderHook(({ id, output, open }) => useSqlPaneLayout(id, open, output, 520, false), { initialProps: { id: 'a', output: false, open: tabs } })
  act(() => result.current.setHost(host))
  expect(result.current.height).toBe(88)
  rerender({ id: 'a', output: true, open: tabs })
  expect(result.current.height).toBe(270)
  act(() => result.current.setHeight(350))
  rerender({ id: 'a', output: false, open: tabs })
  expect(result.current.height).toBe(350)
  act(() => { result.current.setCollapsed(true); result.current.setView('results') })
  rerender({ id: 'b', output: false, open: tabs })
  expect(result.current).toMatchObject({ view: 'split', collapsed: false, height: 88 })
  rerender({ id: 'a', output: true, open: tabs })
  expect(result.current).toMatchObject({ view: 'results', collapsed: true, height: 350 })
  act(() => result.current.revealResults())
  expect(result.current.collapsed).toBe(false)
  available = 300
  act(() => resize())
  expect(result.current.height).toBe(136)
  available = 600
  act(() => resize())
  expect(result.current.height).toBe(350)
  // Closing a Tab releases its local choices; a later Tab cannot inherit them.
  rerender({ id: 'b', output: false, open: [{ id: 'b' }] })
  rerender({ id: 'a', output: false, open: tabs })
  expect(result.current).toMatchObject({ view: 'split', collapsed: false, height: 88 })
  unmount()
  expect(disconnect).toHaveBeenCalledOnce()
})
