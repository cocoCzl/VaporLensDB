import type { editor } from 'monaco-editor'

// Installed only by the explicitly enabled native diagnostic script. Numeric
// metadata only: never pass SQL, draft text, event.data, keys, labels or IDs.
type DiagnosticWindow = Window & {
  __vaporStartupMark?: (stage: string, metrics: Record<string, number>) => void
  __vaporDiagnosticEditorGate?: (phase: 'workspace' | 'monaco') => Promise<void> | undefined
}

export function traceEditorPhase(boundary: number, event: number, metrics: Record<string, number> = {}) {
  ;(window as DiagnosticWindow).__vaporStartupMark?.('perf_editor_phase', { boundary, event, ...metrics })
}

/** Experimental first-loading gate, released by a real input/composition event.
 * Absent during ordinary use and all ungated control runs; never a fixed delay.
 */
export function editorDiagnosticGate(phase: 'workspace' | 'monaco') {
  return (window as DiagnosticWindow).__vaporDiagnosticEditorGate?.(phase)
}

/** One bounded, read-only snapshot at editor handoff; no text or DOM polling. */
export function traceEditorLayout(node: HTMLElement | null | undefined, event: number) {
  const mark = (window as DiagnosticWindow).__vaporStartupMark
  if (!mark || !node) return
  const rect = node.getBoundingClientRect()
  const lines = node.querySelector('.view-lines')
  const metrics: Record<string, number> = {
    event, width: rect.width, height: rect.height, x: rect.x, y: rect.y,
    hidden: document.visibilityState === 'hidden' ? 1 : 0,
    lineNodes: lines?.childElementCount ?? -1,
  }
  let parent: HTMLElement | null = node
  for (let depth = 0; parent && depth < 8; depth++, parent = parent.parentElement) {
    const style = getComputedStyle(parent)
    const bounds = parent.getBoundingClientRect()
    mark('perf_editor_ancestor', { event, depth, width: bounds.width, height: bounds.height,
      visible: style.visibility === 'visible' ? 1 : 0, display: style.display === 'none' ? 0 : 1,
      opacity: Number(style.opacity) })
    metrics[`visible${depth}`] = style.visibility === 'visible' ? 1 : 0
    metrics[`display${depth}`] = style.display === 'none' ? 0 : 1
    metrics[`opacity${depth}`] = Number(style.opacity)
  }
  mark('perf_editor_layout', metrics)
}

/** Bounded event evidence, not a render workaround. Never logs model/DOM text.
 * Ctrl+Alt+Shift+F12 takes a read-only snapshot after the critical input interval.
 */
export function observeEditorRendering(instance: editor.IStandaloneCodeEditor) {
  const mark = (window as DiagnosticWindow).__vaporStartupMark
  if (!mark) return () => {}
  const node = instance.getDomNode()
  if (!node) return () => {}
  let sequence = 0
  let inputs = 0
  let changes = 0
  let mutations = 0
  const snapshot = (event: number, geometry = false) => {
    if (sequence >= 80) return
    const model = instance.getModel()
    if (!model) return
    const lines = node.querySelector('.view-lines')
    const domText = (lines?.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\u200b/g, '')
    const value = model.getValue()
    // Deliberately limited to short, single, unwrapped lines. Wrapped lines,
    // tabs and empty-line sentinel spaces are not claimed comparable.
    const comparable = model.getLineCount() === 1 && value.length > 0 && value.length <= 80 &&
      !value.includes('\t') && lines?.childElementCount === 1
    const selection = instance.getSelection()
    mark('perf_editor_render', { event, sequence: ++sequence,
      modelVersion: model.getVersionId(), modelLength: model.getValueLength(), modelLines: model.getLineCount(),
      domLength: domText.length, lineNodes: lines?.childElementCount ?? -1,
      comparable: comparable ? 1 : 0, domMatches: comparable ? Number(domText === value) : -1,
      focused: Number(instance.hasTextFocus()), activeInside: Number(node.contains(document.activeElement)),
      start: selection ? model.getOffsetAt(selection.getStartPosition()) : -1,
      end: selection ? model.getOffsetAt(selection.getEndPosition()) : -1,
      hidden: Number(document.hidden), inputs, changes, mutations })
    if (!geometry) return
    const rect = node.getBoundingClientRect()
    const host = node.parentElement?.getBoundingClientRect()
    const layout = instance.getLayoutInfo()
    const first = lines?.firstElementChild
    const line = first?.getBoundingClientRect()
    const hit = line && document.elementFromPoint?.(Math.max(0, line.x + 2), Math.max(0, line.y + 2))
    const style = first ? getComputedStyle(first) : null
    mark('perf_editor_render_geometry', { sequence, event,
      hostWidth: host?.width ?? -1, hostHeight: host?.height ?? -1,
      width: rect.width, height: rect.height, layoutWidth: layout.width, layoutHeight: layout.height,
      lineWidth: line?.width ?? -1, lineHeight: line?.height ?? -1, lineX: line?.x ?? -1, lineY: line?.y ?? -1,
      hitInside: hit ? Number(node.contains(hit)) : -1, hitDialog: Number(!!hit?.closest('[role="dialog"],[role="alertdialog"]')),
      lineVisible: style ? Number(style.visibility === 'visible' && style.display !== 'none') : -1,
      lineOpacity: style ? Number(style.opacity) : -1 })
    const lineStyle = first instanceof HTMLElement ? first.style : null
    mark('perf_editor_line_style', { sequence, event,
      inlineHeight: parseFloat(lineStyle?.height ?? '') || 0,
      inlineTop: parseFloat(lineStyle?.top ?? '') || 0,
      computedHeight: parseFloat(style?.height ?? '') || 0,
      computedLineHeight: parseFloat(style?.lineHeight ?? '') || 0,
      absolute: Number(style?.position === 'absolute'),
      stylePresent: Number(!!first?.hasAttribute('style')),
      styleSheets: document.styleSheets.length,
      nonceStyles: document.querySelectorAll('style[nonce]').length,
      emptyStyles: [...document.querySelectorAll('style')].filter(style => !style.sheet).length })
    traceEditorLayout(node, event)
  }
  const input = () => { inputs++; snapshot(1) }
  const change = instance.onDidChangeModelContent(() => { changes++; snapshot(2) })
  const observer = new MutationObserver(() => { mutations++; snapshot(3) })
  const lines = node.querySelector('.view-lines')
  if (lines) observer.observe(lines, { subtree: true, childList: true, characterData: true })
  const inspect = (event: KeyboardEvent) => {
    if (event.key === 'F12' && event.ctrlKey && event.altKey && event.shiftKey && !event.metaKey) {
      event.preventDefault()
      snapshot(4, true)
    }
  }
  node.addEventListener('beforeinput', input, true)
  window.addEventListener('keydown', inspect, true)
  snapshot(0, true)
  return () => {
    node.removeEventListener('beforeinput', input, true)
    window.removeEventListener('keydown', inspect, true)
    change.dispose()
    observer.disconnect()
  }
}
