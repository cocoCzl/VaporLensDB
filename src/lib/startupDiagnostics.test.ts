import { afterEach, expect, it, vi } from 'vitest'
import { observeEditorRendering, traceEditorLayout } from './startupDiagnostics'
import type { editor } from 'monaco-editor'

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

it('does not subscribe to rendering or read the editor when diagnostics are off', () => {
  const getDomNode = vi.fn()
  observeEditorRendering({ getDomNode } as unknown as editor.IStandaloneCodeEditor)()
  expect(getDomNode).not.toHaveBeenCalled()
})

it('separates received input, changed model and changed DOM without logging text or forcing render', async () => {
  const mark = vi.fn()
  Object.assign(window, { __vaporStartupMark: mark })
  const node = document.createElement('div')
  node.innerHTML = '<div class="view-lines"><div>before</div></div><textarea></textarea>'
  document.body.append(node)
  let value = 'before'
  let changed = () => {}
  const dispose = vi.fn()
  const layout = vi.fn()
  const focus = vi.fn()
  const model = { getValue: () => value, getValueLength: () => value.length, getLineCount: () => 1,
    getVersionId: () => value === 'before' ? 1 : 2, getOffsetAt: () => 0 }
  const instance = { getDomNode: () => node, getModel: () => model, hasTextFocus: () => false,
    getSelection: () => null, getLayoutInfo: () => ({ width: 912, height: 71 }), layout, focus,
    onDidChangeModelContent: (callback: () => void) => { changed = callback; return { dispose } } }
  const stop = observeEditorRendering(instance as unknown as editor.IStandaloneCodeEditor)
  node.querySelector('textarea')!.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, data: 'private new value' }))
  value = 'private new value'; changed()
  const samples = () => mark.mock.calls.filter(([stage]) => stage === 'perf_editor_render').map(([, metrics]) => metrics)
  expect(samples().at(-1)).toMatchObject({ event: 2, inputs: 1, changes: 1, domMatches: 0 })
  node.querySelector('.view-lines div')!.textContent = value
  await Promise.resolve()
  expect(samples().at(-1)).toMatchObject({ event: 3, mutations: 1, domMatches: 1 })
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', ctrlKey: true, altKey: true, shiftKey: true }))
  expect(samples().at(-1).event).toBe(4)
  expect(JSON.stringify(mark.mock.calls)).not.toMatch(/before|private new value/)
  expect(layout).not.toHaveBeenCalled(); expect(focus).not.toHaveBeenCalled()
  stop()
  const calls = mark.mock.calls.length
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', ctrlKey: true, altKey: true, shiftKey: true }))
  node.querySelector('.view-lines div')!.textContent = 'after disposal'
  await Promise.resolve()
  expect(mark).toHaveBeenCalledTimes(calls)
  expect(dispose).toHaveBeenCalledOnce()
})
