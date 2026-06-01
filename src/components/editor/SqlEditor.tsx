import Editor, { loader, type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { useEffect, useRef } from 'react'
import { registerSqlCompletionProvider } from '@/components/editor/AutoComplete'
import { useUiStore } from '@/stores/uiStore'

const MONACO_CTRL_CMD = 2048
const MONACO_ENTER = 3

loader.config({ paths: { vs: '/monaco/vs' } })

interface SqlEditorProps {
  value: string
  connectionId?: string | null
  onChange: (value: string) => void
  onRun: () => void
  onSelectionChange?: (value: string) => void
}

export function SqlEditor({
  value,
  connectionId,
  onChange,
  onRun,
  onSelectionChange,
}: SqlEditorProps) {
  const connectionIdRef = useRef(connectionId)
  const appTheme = useUiStore((state) => state.theme)
  const editorFontSize = useUiStore((state) => state.editorFontSize)
  const editorTheme =
    appTheme === 'light'
      ? 'vs'
      : appTheme === 'dark' || window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'vs-dark'
        : 'vs'

  useEffect(() => {
    connectionIdRef.current = connectionId
  }, [connectionId])

  const handleMount: OnMount = (instance, monaco) => {
    instance.addCommand(MONACO_CTRL_CMD | MONACO_ENTER, onRun)
    const completionProvider = registerSqlCompletionProvider(monaco, {
      getConnectionId: () => connectionIdRef.current,
    })
    instance.onDidChangeCursorSelection(() => {
      onSelectionChange?.(selectedText(instance))
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
      onMount={handleMount}
      options={{
        minimap: { enabled: false },
        fontSize: editorFontSize,
        fontFamily: 'Geist Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        lineHeight: 20,
        padding: { top: 12, bottom: 12 },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        wordWrap: 'on',
        tabSize: 2,
      }}
    />
  )
}

function selectedText(instance: editor.IStandaloneCodeEditor) {
  const selection = instance.getSelection()
  const model = instance.getModel()
  if (!selection || !model || selection.isEmpty()) {
    return ''
  }
  return model.getValueInRange(selection)
}
