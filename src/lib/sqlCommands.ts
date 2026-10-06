import { create } from 'zustand'
import { maskSql, statementAtOffset } from './sqlLexer'
import { useEditorStore } from '@/stores/editorStore'
import { useUiStore } from '@/stores/uiStore'
export interface SqlCursor { start: number; end: number; cursor: number }
export const EMPTY_CURSOR: SqlCursor = { start: 0, end: 0, cursor: 0 }
export const SQL_COMMANDS = ['runCurrent', 'runAll', 'cancel', 'format', 'nextTab', 'previousTab', 'focusEditor', 'focusResults', 'focusExplorer'] as const
export type SqlCommand = typeof SQL_COMMANDS[number]
export function executionSql(sql: string, cursor: SqlCursor, scope: 'current' | 'all') {
  const selected = cursor.start !== cursor.end
  const text = scope === 'all' ? sql : selected ? sql.slice(cursor.start, cursor.end) : statementAtOffset(sql, cursor.cursor)
  return maskSql(text).replace(/;/g, '').trim() ? text.trim() : ''
}
interface SqlCommandContext {
  tabId: string
  cursor: () => SqlCursor
  run: (sql: string) => Promise<void>
  cancel: () => void
  format: () => Promise<void>
  focus: (target: 'editor' | 'results') => void
}
type Availability = Partial<Record<SqlCommand, boolean>> & { selection?: boolean }
let context: SqlCommandContext | null = null
export const useSqlCommandState = create<{ available: Availability }>(() => ({ available: {} }))
export function registerSqlCommands(next: SqlCommandContext | null, available: Availability) {
  context = next
  useSqlCommandState.setState({ available })
  return () => { if (context === next) { context = null; useSqlCommandState.setState({ available: {} }) } }
}
export function dispatchSqlCommand(command: SqlCommand) {
  const editor = useEditorStore.getState()
  if (command === 'nextTab' || command === 'previousTab') {
    const sqlTabs = editor.tabs.filter(tab => !tab.kind || tab.kind === 'sql')
    if (sqlTabs.length < 2) return
    const at = sqlTabs.findIndex(tab => tab.id === editor.activeTabId)
    const next = at < 0 ? (command === 'nextTab' ? 0 : sqlTabs.length - 1) : (at + (command === 'nextTab' ? 1 : sqlTabs.length - 1)) % sqlTabs.length
    editor.setActiveTab(sqlTabs[next].id)
    return
  }
  if (command === 'focusExplorer') {
    useUiStore.getState().setSidebarCollapsed(false)
    useUiStore.getState().setSidebarView('explorer')
    requestAnimationFrame(() => focusElement(document.querySelector('aside input') ?? document.querySelector('aside')))
    return
  }
  const active = context
  if (!active || active.tabId !== editor.activeTabId || !useSqlCommandState.getState().available[command]) return
  const tab = editor.tabs.find(tab => tab.id === active.tabId)
  if (!tab) return
  if (command === 'cancel') { active.cancel(); return }
  if (command === 'focusEditor' || command === 'focusResults') { active.focus(command === 'focusEditor' ? 'editor' : 'results'); return }
  if (tab.running || tab.closing || tab.transactionBusy || tab.fileBusy) return
  if (command === 'format') { void active.format(); return }
  const sql = executionSql(tab.sql, active.cursor(), command === 'runAll' ? 'all' : 'current')
  if (sql) void active.run(sql)
}
export function focusElement(element: Element | null) {
  if (!(element instanceof HTMLElement)) return
  if (!element.matches('input, textarea, button, [tabindex]')) element.tabIndex = -1
  element.focus()
}

/** Linux's Monaco default is Ctrl+Shift+I, which can collide with devtools. Leave it unbound. */
export function sqlCommandShortcut(command: SqlCommand) {
  if (command === 'runCurrent') return /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ Enter' : 'Ctrl Enter'
  if (command === 'format' && !/Linux/.test(navigator.platform)) return 'Shift Alt F'
  return undefined
}
