import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SqlEditor } from './SqlEditor'
import { EMPTY_CURSOR, registerSqlCommands, dispatchSqlCommand, type SqlCursor } from '@/lib/sqlCommands'
import { useEditorStore } from '@/stores/editorStore'
const fake = vi.hoisted(() => ({ commands: new Map<number, () => void>(), start: 0, end: 0, cursor: 0, changed: () => {}, disposed: () => {} }))
vi.mock('./AutoComplete', () => ({ registerSqlCompletionProvider: () => ({ dispose: () => {} }) }))
vi.mock('@monaco-editor/react', async () => {
  const { useEffect } = await import('react')
  return { loader: { config: () => {} }, default: function MockMonaco({ onMount }: { onMount: (instance: unknown, monaco: unknown) => void }) {
    useEffect(() => {
      onMount({
        focus: () => {}, addCommand: (key: number, fn: () => void) => fake.commands.set(key, fn),
        getSelection: () => ({ getStartPosition: () => fake.start, getEndPosition: () => fake.end }),
        getPosition: () => fake.cursor, getModel: () => ({ getOffsetAt: (value: number) => value }),
        onDidChangeCursorSelection: (fn: () => void) => { fake.changed = fn },
        onDidDispose: (fn: () => void) => { fake.disposed = fn },
      }, { editor: { defineTheme: () => {}, setTheme: () => {} } })
      return () => fake.disposed()
    }, [onMount])
    return null
  } }
})
beforeEach(() => { fake.commands.clear(); fake.start = fake.end = fake.cursor = 0; useEditorStore.setState({ tabs: [{ id: 'tab', title: 'SQL', sql: 'SELECT 1; SELECT 2;', connectionId: 'A' }], activeTabId: 'tab' }) })
describe('Monaco command adapter', () => {
  it.each([false, true])('Ctrl/Cmd+Enter publishes live cursor/selection and uses the shared command (selected=%s)', (selected) => {
    let cursor: SqlCursor = EMPTY_CURSOR
    const run = vi.fn().mockResolvedValue(undefined)
    const format = vi.fn().mockResolvedValue(undefined)
    const cleanup = registerSqlCommands({ tabId: 'tab', cursor: () => cursor, run, format, cancel: vi.fn(), focus: vi.fn() }, { runCurrent: true, format: true })
    render(<SqlEditor value="SELECT 1; SELECT 2;" onChange={() => {}} onRun={() => dispatchSqlCommand('runCurrent')} onFormat={() => dispatchSqlCommand('format')} onScopeChange={value => { cursor = value }} />)
    fake.start = selected ? 0 : 14; fake.end = selected ? 8 : 14; fake.cursor = 14
    act(() => fake.commands.get(2048 | 3)!())
    expect(run).toHaveBeenCalledExactlyOnceWith(selected ? 'SELECT 1' : 'SELECT 2')
    act(() => fake.commands.get(1024 | 512 | 36)!())
    expect(format).toHaveBeenCalledOnce()
    cleanup()
  })
  it('honors current read-only state without losing the shortcut after a file operation', () => {
    const run = vi.fn()
    const props = { value: 'SELECT 1', onChange: () => {}, onRun: run }
    const view = render(<SqlEditor {...props} readOnly />)
    act(() => fake.commands.get(2048 | 3)!())
    expect(run).not.toHaveBeenCalled()
    view.rerender(<SqlEditor {...props} readOnly={false} />)
    act(() => fake.commands.get(2048 | 3)!())
    expect(run).toHaveBeenCalledOnce()
  })

})
