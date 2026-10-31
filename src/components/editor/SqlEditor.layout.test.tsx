import { act, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SqlEditor } from './SqlEditor'

vi.mock('@monaco-editor/react', () => ({ loader: { config: () => {} }, default: ({ width, height }: { width: number | string; height: number | string }) => <div data-testid="canvas" data-width={width} data-height={height} /> }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('passes measured flex-pane dimensions to Monaco, updates on resize, and ignores hidden zero-size panes', () => {
  let width = 800
  let height = 360
  let resize!: () => void
  const disconnect = vi.fn()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width, height }) as DOMRect)
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback } observe() {} disconnect = disconnect })
  const view = render(<SqlEditor value="SELECT 1" onChange={() => {}} onRun={() => {}} />)
  expect(screen.getByTestId('canvas')).toHaveAttribute('data-height', '360')
  width = 600; height = 240
  act(() => resize())
  expect(screen.getByTestId('canvas')).toHaveAttribute('data-width', '600')
  expect(screen.getByTestId('canvas')).toHaveAttribute('data-height', '240')
  height = 0
  act(() => resize())
  expect(screen.getByTestId('canvas')).toHaveAttribute('data-height', '240')
  view.unmount()
  expect(disconnect).toHaveBeenCalledOnce()
})
