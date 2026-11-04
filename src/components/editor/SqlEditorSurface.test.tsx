import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SqlEditorSurface } from './SqlEditorSurface'
import type { SqlEditorProps } from './SqlEditor'
import { rememberDraftSelection } from '@/lib/editorDraftHandoff'

const fake = vi.hoisted(() => ({ props: null as SqlEditorProps | null }))
vi.mock('./SqlEditor', () => ({ SqlEditor: (props: SqlEditorProps) => { fake.props = props; return <div data-testid="monaco-loading" /> } }))

function Draft() {
  const [value, setValue] = useState('')
  return <SqlEditorSurface value={value} onChange={setValue} onRun={() => {}} autoFocus />
}
async function mountEditor() {
  await waitFor(() => expect(fake.props).not.toBeNull())
  let value = fake.props!.value
  const instance = {
    getValue: () => value,
    setValue: vi.fn((next: string) => { value = next; fake.props!.onChange(next) }),
    getModel: () => ({ getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }) }),
    setSelection: vi.fn(), focus: vi.fn(),
    getDomNode: () => {
      const host = document.createElement('div')
      Object.defineProperty(host, 'getBoundingClientRect', { value: () => ({ width: 912, height: 71 }) as DOMRect })
      const node = document.createElement('div')
      host.append(node)
      return node
    },
    layout: vi.fn(),
  }
  act(() => fake.props!.onReady!(instance as never))
  return instance
}
beforeEach(() => { fake.props = null })
describe('SQL loading draft handoff', () => {
  it('retains immediate typing/paste and backward selection through module and Monaco readiness', async () => {
    render(<Draft />)
    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(input).toHaveFocus()
    fireEvent.change(input, { target: { value: 'SELECT \u4f60\u597d;\nSELECT 2;' } })
    input.setSelectionRange(2, 8, 'backward')
    const instance = await mountEditor()
    expect(instance.getValue()).toBe('SELECT \u4f60\u597d;\nSELECT 2;')
    expect(instance.setSelection).toHaveBeenCalledWith({ selectionStartLineNumber: 1, selectionStartColumn: 9, positionLineNumber: 1, positionColumn: 3 })
    expect(instance.focus).toHaveBeenCalledOnce()
    expect(instance.layout).toHaveBeenCalledExactlyOnceWith({ width: 912, height: 71 })
    expect(instance.layout.mock.invocationCallOrder[0]).toBeLessThan(instance.focus.mock.invocationCallOrder[0])
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('waits for IME completion without a timer, commits once and does not leak a draft into a reopened tab', async () => {
    const view = render(<Draft />)
    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'SELECT \u4e2d' } })
    const instance = await mountEditor()
    expect(input).toBeInTheDocument()
    expect(instance.focus).not.toHaveBeenCalled()
    expect(instance.layout).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'SELECT \u4e2d\u6587' } })
    fireEvent.compositionEnd(input, { data: '\u4e2d\u6587' })
    expect(instance.getValue()).toBe('SELECT \u4e2d\u6587')
    expect(instance.focus).toHaveBeenCalledOnce()
    expect(instance.layout).toHaveBeenCalledExactlyOnceWith({ width: 912, height: 71 })
    view.unmount()
    render(<Draft />)
    expect(screen.getByRole('textbox')).toHaveValue('')
  })

  it('does not steal focus when readiness follows a click outside the draft', async () => {
    render(<><Draft /><button>Elsewhere</button></>)
    screen.getByRole('button', { name: 'Elsewhere' }).focus()
    const instance = await mountEditor()
    expect(instance.focus).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus()
  })

  it('keeps run and IME shortcuts distinct while loading', () => {
    const run = vi.fn()
    render(<SqlEditorSurface value="SELECT 1" onChange={() => {}} onRun={run} />)
    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, isComposing: true })
    expect(run).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    expect(run).toHaveBeenCalledOnce()
  })

  it('preserves focus outside the first workspace while its module loads', () => {
    rememberDraftSelection({ tabId: 'first', start: 2, end: 4, direction: 'forward', focused: false })
    render(<><button>Outside workspace</button><SqlEditorSurface draftId="first" value="SELECT" onChange={() => {}} onRun={() => {}} autoFocus /></>)
    expect(screen.getByRole('textbox')).not.toHaveFocus()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).selectionStart).toBe(2)
  })
})
