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
