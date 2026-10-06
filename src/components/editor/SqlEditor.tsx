import { sqlCommandShortcut, type SqlCursor } from '@/lib/sqlCommands'
import Editor, { loader, type BeforeMount, type Monaco, type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { useEffect, useRef } from 'react'
import { registerSqlCompletionProvider } from '@/components/editor/AutoComplete'
import { useUiStore } from '@/stores/uiStore'
import type { DriverType } from '@/types/connection'

const MONACO_CTRL_CMD = 2048
const MONACO_ENTER = 3

loader.config({ paths: { vs: '/monaco/vs' } })

interface SqlEditorProps {
  value: string
  connectionId?: string | null
  schema?: string | null
  driverType?: DriverType | null
  showSystemObjects?: boolean
  onChange: (value: string) => void
  onRun: () => void
  onFormat?: () => void
  onScopeChange?: (cursor: SqlCursor) => void
  onFocusReady?: (focus: (() => void) | null) => void
  readOnly?: boolean
  autoFocus?: boolean
}

export function SqlEditor({
  value,
  connectionId,
  schema,
  driverType,
  showSystemObjects = false,
  onChange,
  onRun,
  onScopeChange,
  onFormat,
  onFocusReady,
  readOnly = false,
  autoFocus = false,
}: SqlEditorProps) {
  const connectionIdRef = useRef(connectionId)
  const schemaRef = useRef(schema)
  const driverTypeRef = useRef(driverType)
  const showSystemObjectsRef = useRef(showSystemObjects)
  const onRunRef = useRef(onRun)
  const readOnlyRef = useRef(readOnly)
  const onScopeChangeRef = useRef(onScopeChange)
  const onFormatRef = useRef(onFormat)
  const onFocusReadyRef = useRef(onFocusReady)
  const resolvedTheme = useUiStore((state) => state.resolvedTheme)
  const editorFontSize = useUiStore((state) => state.editorFontSize)
  const monacoRef = useRef<Monaco | null>(null)
  const editorTheme = resolvedTheme === 'dark' ? 'vaporlens-dark' : 'vaporlens-light'

  useEffect(() => {
    if (!monacoRef.current) return
    defineVaporLensThemes(monacoRef.current)
    monacoRef.current.editor.setTheme(editorTheme)
  }, [editorTheme])

  useEffect(() => {
    connectionIdRef.current = connectionId
  }, [connectionId])

  useEffect(() => {
    schemaRef.current = schema
  }, [schema])

  useEffect(() => {
    driverTypeRef.current = driverType
  }, [driverType])

  useEffect(() => {
    showSystemObjectsRef.current = showSystemObjects
  }, [showSystemObjects])

  useEffect(() => {
    onRunRef.current = onRun
    readOnlyRef.current = readOnly
  }, [onRun, readOnly])

  useEffect(() => {
    onScopeChangeRef.current = onScopeChange
    onFormatRef.current = onFormat
    onFocusReadyRef.current = onFocusReady
  }, [onScopeChange, onFormat, onFocusReady])

  const handleMount: OnMount = (instance, monaco) => {
    monacoRef.current = monaco
    defineVaporLensThemes(monaco)
    if (autoFocus) {
      instance.focus()
    }
    instance.addCommand(MONACO_CTRL_CMD | MONACO_ENTER, () => {
      if (readOnlyRef.current) return
      onScopeChangeRef.current?.(cursorSnapshot(instance))
      onRunRef.current()
    })
    if (onFormat && sqlCommandShortcut('format')) instance.addCommand(1024 | 512 | 36, () => { if (!readOnlyRef.current) onFormatRef.current?.() }) // Shift+Alt+F: Monaco Format Document.
    onFocusReadyRef.current?.(() => instance.focus())
    const completionProvider = registerSqlCompletionProvider(monaco, {
      getConnectionId: () => connectionIdRef.current,
      getSchema: () => schemaRef.current,
      getDriverType: () => driverTypeRef.current,
      getShowSystemObjects: () => showSystemObjectsRef.current,
    })
    instance.onDidChangeCursorSelection(() => {
      onScopeChangeRef.current?.(cursorSnapshot(instance))
    })
    instance.onDidDispose(() => {
      onFocusReadyRef.current?.(null)
      completionProvider.dispose()
      monacoRef.current = null
    })
  }

  return (
    <Editor
      height="100%"
      defaultLanguage="pgsql"
      value={value}
      theme={editorTheme}
      onChange={(next) => onChange(next ?? '')}
      beforeMount={defineVaporLensThemes}
      onMount={handleMount}
      options={{
        minimap: { enabled: false },
        fontSize: editorFontSize,
        fontFamily: 'Geist Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        lineHeight: 22,
        // Give SQL a composed writing surface while keeping the result panel
        // as the primary work area below it.
        padding: { top: 16, bottom: 12 },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        wordWrap: 'on',
        tabSize: 2,
        quickSuggestions: { other: true, comments: false, strings: false },
        suggestOnTriggerCharacters: true,
        readOnly,
        domReadOnly: readOnly,
      }}
    />
  )
}

const defineVaporLensThemes: BeforeMount = (monaco) => {
  const light = monacoPalette(false)
  const dark = monacoPalette(true)
  monaco.editor.defineTheme('vaporlens-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: dark.primary, fontStyle: 'bold' },
      { token: 'string', foreground: dark.success },
      { token: 'number', foreground: dark.warning },
      { token: 'comment', foreground: dark.muted, fontStyle: 'italic' },
      { token: 'identifier', foreground: dark.foreground },
      { token: 'delimiter', foreground: dark.muted },
    ],
    colors: {
      'editor.background': dark.editor,
      'editor.foreground': dark.foreground,
      'editorLineNumber.foreground': dark.muted,
      'editorLineNumber.activeForeground': dark.foreground,
      'editor.selectionBackground': dark.selected,
      'editor.inactiveSelectionBackground': dark.hover,
      'editor.lineHighlightBackground': dark.hover,
      'editorCursor.foreground': dark.primary,
      'editorIndentGuide.background1': dark.border,
      'editorIndentGuide.activeBackground1': dark.borderStrong,
    },
  })
  monaco.editor.defineTheme('vaporlens-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: light.primary, fontStyle: 'bold' },
      { token: 'string', foreground: light.success },
      { token: 'number', foreground: light.warning },
      { token: 'comment', foreground: light.muted, fontStyle: 'italic' },
      { token: 'identifier', foreground: light.foreground },
    ],
    colors: {
      'editor.background': light.editor,
      'editor.foreground': light.foreground,
      'editorLineNumber.foreground': light.muted,
      'editorLineNumber.activeForeground': light.foreground,
      'editor.selectionBackground': light.selected,
      'editor.inactiveSelectionBackground': light.hover,
      'editor.lineHighlightBackground': light.hover,
      'editorCursor.foreground': light.primary,
      'editorIndentGuide.background1': light.border,
      'editorIndentGuide.activeBackground1': light.borderStrong,
    },
  })
}

/**
 * Monaco accepts hex rather than HSL design tokens. Read both semantic token
 * sets once at editor bootstrap so the editor remains visually in step with
 * the application without introducing a separate, hand-maintained palette.
 */
function monacoPalette(dark: boolean) {
  const fallback = dark
    ? {
        editor: '#202225', foreground: '#D8DEE7', muted: '#727982', primary: '#79AFFF', success: '#84B98C', warning: '#E5A96B', selected: '#31568A', hover: '#25282C', border: '#30343A', borderStrong: '#4A515B',
      }
    : {
        editor: '#FFFFFF', foreground: '#20242A', muted: '#7A838F', primary: '#337AE8', success: '#2F7D4B', warning: '#A45A14', selected: '#C9DDFD', hover: '#F5F7FA', border: '#E4E7EB', borderStrong: '#B8BEC7',
      }
  if (typeof document === 'undefined') return fallback

  const probe = document.createElement('span')
  if (dark) probe.className = 'dark'
  probe.style.display = 'none'
  document.body.append(probe)
  const read = (token: string, fallbackColor: string) => {
    probe.style.color = `hsl(var(${token}))`
    return hslTokenToHex(window.getComputedStyle(probe).color, fallbackColor)
  }
  const palette = {
    editor: read('--editor', fallback.editor),
    foreground: read('--foreground', fallback.foreground),
    muted: read('--muted-foreground', fallback.muted),
    primary: read('--primary', fallback.primary),
    success: read('--success', fallback.success),
    warning: read('--warning', fallback.warning),
    selected: read('--grid-selected', fallback.selected),
    hover: read('--grid-hover', fallback.hover),
    border: read('--border', fallback.border),
    borderStrong: read('--border-strong', fallback.borderStrong),
  }
  probe.remove()
  return palette
}

function hslTokenToHex(value: string, fallback: string) {
  const match = value.trim().match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/)
  return match ? `#${match.slice(1).map((channel) => Number(channel).toString(16).padStart(2, '0')).join('')}` : fallback
}

function cursorSnapshot(instance: editor.IStandaloneCodeEditor): SqlCursor {
  const selection = instance.getSelection()
  const position = instance.getPosition()
  const model = instance.getModel()
  if (!selection || !position || !model) return { start: 0, end: 0, cursor: 0 }
  return { start: model.getOffsetAt(selection.getStartPosition()), end: model.getOffsetAt(selection.getEndPosition()), cursor: model.getOffsetAt(position) }
}
