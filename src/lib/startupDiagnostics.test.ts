import { afterEach, expect, it, vi } from 'vitest'
import { traceEditorLayout } from './startupDiagnostics'

afterEach(() => {
  delete (window as Window & { __vaporStartupMark?: unknown }).__vaporStartupMark
  document.body.replaceChildren()
})

it('does not inspect layout while native diagnostics are off', () => {
  const node = document.createElement('div')
  const read = vi.spyOn(node, 'getBoundingClientRect')
  traceEditorLayout(node, 5)
  expect(read).not.toHaveBeenCalled()
})

it('records bounded numeric geometry, never editor text', () => {
  const mark = vi.fn()
  Object.assign(window, { __vaporStartupMark: mark })
  const node = document.createElement('div')
  node.innerHTML = '<div class="view-lines"><div>sensitive draft content</div></div>'
  let ancestor = node
  for (let index = 0; index < 12; index++) {
    const wrapper = document.createElement('div')
    wrapper.append(ancestor)
    ancestor = wrapper
  }
  document.body.append(ancestor)
  traceEditorLayout(node, 5)
  const [stage, metrics] = mark.mock.calls.find(([stage]) => stage === 'perf_editor_layout')!
  expect(stage).toBe('perf_editor_layout')
  expect(metrics.lineNodes).toBe(1)
  expect(Object.keys(metrics)).toHaveLength(31)
  expect(Object.values(metrics).every(value => typeof value === 'number')).toBe(true)
  expect(JSON.stringify(metrics)).not.toContain('sensitive')
  expect(metrics.visible8).toBeUndefined()
  expect(mark.mock.calls.filter(([stage]) => stage === 'perf_editor_ancestor')).toHaveLength(8)
})
