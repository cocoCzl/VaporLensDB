import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeStartup } from './qa-startup-evidence.mjs'

const event = (stage, metrics = {}, pid = 7) => ({ pid, stage, elapsedMs: 300, metrics })
const background = [
  event('native_app_ready', { visible: 1, view_hidden: 0, occlusion_visible: 0 }),
  event('runtime_identity'), event('dom_loaded'), event('shell_committed'),
  event('perf_raf_requested', { hidden: 1 }),
]

test('hidden background window without rAF can have complete pixels', () => {
  const result = summarizeStartup(background, 7, { visual: 'complete', axContent: false })
  assert.equal(result.documentHidden, 1)
  assert.equal(result.rafCallbacks, 0)
  assert.equal(result.visual, 'complete')
  assert.equal(result.axContent, false)
  assert.equal(result.rootCause, 'undetermined')
})

test('mounted React or an empty AX tree cannot determine captured pixels', () => {
  const result = summarizeStartup(background, 7, { axContent: false })
  assert.equal(result.reactCommittedMs, 300)
  assert.equal(result.visual, 'unobserved')
})

test('a blank screenshot is retained even after an rAF callback', () => {
  const result = summarizeStartup([...background, event('perf_frame')], 7, { visual: 'blank' })
  assert.equal(result.visual, 'blank')
  assert.equal(result.rafCallbacks, 1)
  assert.equal(result.rootCause, 'undetermined')
})

test('errors remain visible even when the interface has rendered', () => {
  const result = summarizeStartup([...background, event('perf_error'), event('perf_csp_violation')], 7, { visual: 'complete' })
  assert.equal(result.errors, 1)
  assert.equal(result.cspViolations, 1)
})

test('another process cannot supply missing identity, HTML, React or rAF evidence', () => {
  const result = summarizeStartup([...background, event('perf_frame')], 8)
  assert.equal(result.identityRecorded, false)
  assert.equal(result.htmlLoaded, false)
  assert.equal(result.reactCommittedMs, null)
  assert.equal(result.rafCallbacks, 0)
})
