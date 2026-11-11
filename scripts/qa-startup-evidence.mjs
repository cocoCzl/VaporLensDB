// Read-only QA analysis. Visibility, accessibility and rAF are independent of
// the captured pixels: none alone can establish that a window was blank.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function summarizeStartup(records, pid, observation = {}) {
  const rows = records.filter(row => row.pid === pid)
  const first = stage => rows.find(row => row.stage === stage)
  const last = stage => rows.filter(row => row.stage === stage).at(-1)
  const native = rows.filter(row => row.metrics && 'occlusion_visible' in row.metrics).at(-1)
  const visibility = rows.filter(row => row.metrics && 'hidden' in row.metrics).at(-1)
  const layout = last('perf_editor_layout')
  const visual = ['complete', 'blank'].includes(observation.visual) ? observation.visual : 'unobserved'
  return {
    pid,
    identityRecorded: !!first('runtime_identity'),
    native: native?.metrics ?? null,
    webviewAvailable: !!first('webview_available_in_setup'),
    navigationFinished: !!first('webview_finished'),
    htmlLoaded: !!first('dom_loaded'),
    reactCommittedMs: first('shell_committed')?.elapsedMs ?? null,
    editorLayout: layout ? { width: layout.metrics.width, height: layout.metrics.height } : null,
    documentHidden: visibility?.metrics.hidden ?? null,
    rafRequests: rows.filter(row => row.stage === 'perf_raf_requested').length,
    rafCallbacks: rows.filter(row => row.stage === 'perf_frame').length,
    shellFrameMs: first('react_shell_frame')?.elapsedMs ?? null,
    errors: rows.filter(row => row.stage === 'perf_error').length,
    cspViolations: rows.filter(row => row.stage === 'perf_csp_violation').length,
    visual,
    axContent: typeof observation.axContent === 'boolean' ? observation.axContent : null,
    // Even a blank screenshot plus suspended rAF is correlation, not proof of
    // the underlying compositor/occlusion or application-code cause.
    rootCause: 'undetermined',
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [tracePath, launchesPath, observationsPath] = process.argv.slice(2)
  const jsonl = path => readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
  const records = jsonl(tracePath)
  const observations = JSON.parse(readFileSync(observationsPath, 'utf8'))
  const results = jsonl(launchesPath).map(launch => ({
    label: launch.label,
    mode: launch.mode,
    binarySha256: launch.binarySha256,
    ...summarizeStartup(records, launch.pid, observations[launch.label]),
  }))
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
}
