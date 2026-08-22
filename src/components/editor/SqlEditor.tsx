import Editor, { loader, type BeforeMount, type OnMount } from '@monaco-editor/react'
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
  onRun: (sql: string) => void
  onSelectionChange?: (value: string) => void
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
  onSelectionChange,
  readOnly = false,
  autoFocus = false,
}: SqlEditorProps) {
  const connectionIdRef = useRef(connectionId)
  const schemaRef = useRef(schema)
  const driverTypeRef = useRef(driverType)
  const showSystemObjectsRef = useRef(showSystemObjects)
  const onRunRef = useRef(onRun)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const appTheme = useUiStore((state) => state.theme)
  const editorFontSize = useUiStore((state) => state.editorFontSize)
  const editorTheme =
    appTheme === 'light'
      ? 'vaporlens-light'
      : appTheme === 'dark' || window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'vaporlens-dark'
        : 'vaporlens-light'

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
  }, [onRun])

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange
  }, [onSelectionChange])

  const handleMount: OnMount = (instance, monaco) => {
    if (autoFocus) {
      instance.focus()
    }
    if (!readOnly) {
      instance.addCommand(MONACO_CTRL_CMD | MONACO_ENTER, () => {
        onRunRef.current(sqlAtCursor(instance))
      })
    }
    const completionProvider = registerSqlCompletionProvider(monaco, {
      getConnectionId: () => connectionIdRef.current,
      getSchema: () => schemaRef.current,
      getDriverType: () => driverTypeRef.current,
      getShowSystemObjects: () => showSystemObjectsRef.current,
    })
    instance.onDidChangeCursorSelection(() => {
      onSelectionChangeRef.current?.(selectedText(instance))
    })
    instance.onDidDispose(() => completionProvider.dispose())
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
        lineHeight: 20,
        padding: { top: 8, bottom: 8 },
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
  monaco.editor.defineTheme('vaporlens-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '6EA8FE', fontStyle: 'bold' },
      { token: 'string', foreground: 'A6D189' },
      { token: 'number', foreground: 'E5A96B' },
      { token: 'comment', foreground: '727982', fontStyle: 'italic' },
      { token: 'identifier', foreground: 'D8DEE7' },
      { token: 'delimiter', foreground: 'AAB2BD' },
    ],
    colors: {
      'editor.background': '#202225',
      'editor.foreground': '#D8DEE7',
      'editorLineNumber.foreground': '#666D76',
      'editorLineNumber.activeForeground': '#B9C1CC',
      'editor.selectionBackground': '#31568A',
      'editor.inactiveSelectionBackground': '#2A405C',
      'editor.lineHighlightBackground': '#25282C',
      'editorCursor.foreground': '#79AFFF',
      'editorIndentGuide.background1': '#30343A',
      'editorIndentGuide.activeBackground1': '#4A515B',
    },
  })
  monaco.editor.defineTheme('vaporlens-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '2764C5', fontStyle: 'bold' },
      { token: 'string', foreground: '2F7D4B' },
      { token: 'number', foreground: 'A45A14' },
      { token: 'comment', foreground: '7A838F', fontStyle: 'italic' },
      { token: 'identifier', foreground: '20242A' },
    ],
    colors: {
      'editor.background': '#FFFFFF',
      'editor.foreground': '#20242A',
      'editorLineNumber.foreground': '#9AA1AA',
      'editorLineNumber.activeForeground': '#515862',
      'editor.selectionBackground': '#C9DDFD',
      'editor.inactiveSelectionBackground': '#DDE8F8',
      'editor.lineHighlightBackground': '#F5F7FA',
      'editorCursor.foreground': '#337AE8',
      'editorIndentGuide.background1': '#E4E7EB',
      'editorIndentGuide.activeBackground1': '#B8BEC7',
    },
  })
}

function selectedText(instance: editor.IStandaloneCodeEditor) {
  const selection = instance.getSelection()
  const model = instance.getModel()
  if (!selection || !model || selection.isEmpty()) {
    return ''
  }
  return model.getValueInRange(selection)
}

function sqlAtCursor(instance: editor.IStandaloneCodeEditor) {
  const selection = selectedText(instance)
  if (selection) {
    return selection.trim()
  }

  const model = instance.getModel()
  const position = instance.getPosition()
  if (!model || !position) {
    return ''
  }
  return statementAtOffset(model.getValue(), model.getOffsetAt(position))
}

function statementAtOffset(sql: string, offset: number) {
  const statements: Array<{ start: number; end: number }> = []
  let start = 0
  let inSingleQuote = false
  let inDoubleQuote = false
  let inLineComment = false
  let inBlockComment = false

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]
    const next = sql[index + 1]

    if (inLineComment) {
      if (character === '\n') inLineComment = false
      continue
    }
    if (inBlockComment) {
      if (character === '*' && next === '/') {
        index += 1
        inBlockComment = false
      }
      continue
    }
    if (!inSingleQuote && !inDoubleQuote && character === '-' && next === '-') {
      index += 1
      inLineComment = true
      continue
    }
    if (!inSingleQuote && !inDoubleQuote && character === '/' && next === '*') {
      index += 1
      inBlockComment = true
      continue
    }
    if (character === "'" && !inDoubleQuote) {
      if (inSingleQuote && next === "'") {
        index += 1
      } else {
        inSingleQuote = !inSingleQuote
      }
      continue
    }
    if (character === '"' && !inSingleQuote) {
      if (inDoubleQuote && next === '"') {
        index += 1
      } else {
        inDoubleQuote = !inDoubleQuote
      }
      continue
    }
    if (character === ';' && !inSingleQuote && !inDoubleQuote) {
      if (sql.slice(start, index).trim()) {
        statements.push({ start, end: index })
      }
      start = index + 1
    }
  }

  if (sql.slice(start).trim()) {
    statements.push({ start, end: sql.length })
  }

  const statementAtCursor = statements.find(
    (candidate) => offset >= candidate.start && offset <= candidate.end,
  )
  const statementBeforeTrailingDelimiter = statements
    .filter(
      (candidate) =>
        candidate.end < offset && /^[\s;]*$/.test(sql.slice(candidate.end, offset)),
    )
    .at(-1)
  const statement = statementAtCursor ?? statementBeforeTrailingDelimiter
  return statement ? sql.slice(statement.start, statement.end).trim() : ''
}
