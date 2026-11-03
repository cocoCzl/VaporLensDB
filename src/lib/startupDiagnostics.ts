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
