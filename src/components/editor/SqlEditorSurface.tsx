import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { editor } from 'monaco-editor'
import { sqlCommandShortcut } from '@/lib/sqlCommands'
import { useUiStore } from '@/stores/uiStore'
import type { SqlEditorProps } from './SqlEditor'
import { takeDraftSelection } from '@/lib/editorDraftHandoff'
import { editorDiagnosticGate, traceEditorLayout, traceEditorPhase } from '@/lib/startupDiagnostics'

const SqlEditor = lazy(() => import('./SqlEditor').then(module => ({ default: module.SqlEditor })))

/** Keep an editable draft throughout both the module and Monaco loader.
 * Read the live textarea at handoff, including selection and unfinished IME.
 */
export function SqlEditorSurface(props: SqlEditorProps & { draftId?: string }) {
  const { t } = useTranslation()
  const fontSize = useUiStore(state => state.editorFontSize)
  const draft = useRef<HTMLTextAreaElement>(null)
  const [instance, setInstance] = useState<editor.IStandaloneCodeEditor | null>(null)
  const [composing, setComposing] = useState(false)
  const [ready, setReady] = useState(false)
  const restoreFocus = useRef(false)
  const alive = useRef(false)
  const latest = useRef(props)
  useLayoutEffect(() => { latest.current = props })

  useLayoutEffect(() => {
    alive.current = true
    const input = draft.current
    if (!input) return
    const selection = takeDraftSelection(latest.current.draftId)
    if (selection) input.setSelectionRange(selection.start, selection.end, selection.direction)
    latest.current.onFocusReady?.(() => input.focus())
    if (latest.current.autoFocus && (selection?.focused ?? true)) input.focus()
    traceEditorPhase(2, 3, { length: input.value.length, start: input.selectionStart, end: input.selectionEnd, focused: document.activeElement === input ? 1 : 0 })
    return () => { alive.current = false; latest.current.onFocusReady?.(null) }
  }, [])

  useLayoutEffect(() => {
    const input = draft.current
    if (!input || !instance || composing || ready) return
    const focused = document.activeElement === input
    // An input event may precede React's next render. The DOM is authoritative.
    if (instance.getValue() !== input.value) instance.setValue(input.value)
    const model = instance.getModel()
    if (model) {
      const start = model.getPositionAt(input.selectionStart)
      const end = model.getPositionAt(input.selectionEnd)
      const backwards = input.selectionDirection === 'backward'
      instance.setSelection({
        selectionStartLineNumber: backwards ? end.lineNumber : start.lineNumber,
        selectionStartColumn: backwards ? end.column : start.column,
        positionLineNumber: backwards ? start.lineNumber : end.lineNumber,
        positionColumn: backwards ? start.column : end.column,
      })
    }
    restoreFocus.current = focused
    traceEditorPhase(2, 4, { length: input.value.length, start: input.selectionStart, end: input.selectionEnd, focused: focused ? 1 : 0, matched: instance.getValue() === input.value ? 1 : 0 })
    setReady(true)
  }, [instance, composing, ready])

  useLayoutEffect(() => {
    if (!ready || !instance) return
    // The loading surface has just become visible. Monaco's initial automatic
    // layout can still be queued on a suspended native animation frame (5×5
    // editor inside a full-sized host). Commit the actual host dimensions at
    // this ownership handoff, before moving the caret/focus into Monaco.
    const host = instance.getDomNode?.()?.parentElement
    const bounds = host?.getBoundingClientRect()
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      instance.layout({ width: bounds.width, height: bounds.height })
    }
    latest.current.onFocusReady?.(() => instance.focus())
    if (restoreFocus.current) { instance.focus(); restoreFocus.current = false }
    const selection = instance.getSelection?.()
    const model = instance.getModel()
    traceEditorPhase(2, 5, { length: instance.getValue().length, focused: instance.hasTextFocus?.() ? 1 : 0,
      start: selection && model ? model.getOffsetAt(selection.getStartPosition()) : -1,
      end: selection && model ? model.getOffsetAt(selection.getEndPosition()) : -1 })
    traceEditorLayout(instance.getDomNode?.(), 5)
  }, [ready, instance])

  const handleReady = useCallback((editor: editor.IStandaloneCodeEditor) => {
    traceEditorPhase(2, 2)
    const accept = () => { if (alive.current) setInstance(editor) }
    const gate = editorDiagnosticGate('monaco')
    if (gate) void gate.then(accept)
    else accept()
  }, [])

  return <div className="absolute inset-0 min-h-0 min-w-0">
    <div className="absolute inset-0" style={{ visibility: ready ? 'visible' : 'hidden' }} aria-hidden={!ready}>
      <Suspense fallback={null}>
        <SqlEditor {...props} autoFocus={false} onFocusReady={undefined} onReady={handleReady} />
      </Suspense>
    </div>
    {!ready && <div className="absolute inset-0 flex flex-col bg-card">
      <textarea
        ref={draft}
        data-sql-loading-draft="monaco"
        aria-label={t('editor.inputLabel')}
        readOnly={props.readOnly}
        className="min-h-0 flex-1 resize-none bg-card p-3 font-mono leading-5 text-foreground outline-none"
        style={{ fontSize, lineHeight: `${Math.max(18, fontSize + 7)}px` }}
        value={props.value}
        spellCheck={false}
        onChange={event => props.onChange(event.currentTarget.value)}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={event => { props.onChange(event.currentTarget.value); setComposing(false) }}
        onSelect={event => {
          const input = event.currentTarget
          props.onScopeChange?.({ start: input.selectionStart, end: input.selectionEnd, cursor: input.selectionDirection === 'backward' ? input.selectionStart : input.selectionEnd })
        }}
        onKeyDown={event => {
          if (props.readOnly || event.nativeEvent.isComposing) return
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            const input = event.currentTarget
            props.onScopeChange?.({ start: input.selectionStart, end: input.selectionEnd, cursor: input.selectionEnd })
            props.onRun()
          } else if (sqlCommandShortcut('format') && event.shiftKey && event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'f') {
            event.preventDefault(); props.onFormat?.()
          }
        }}
      />
      <span role="status" className="pointer-events-none absolute right-3 bottom-2 text-[11px] text-muted-foreground">{t('workbench.loadingSqlEditor')}</span>
    </div>}
  </div>
}
