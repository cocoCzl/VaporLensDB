import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../src-tauri/src/utils/startup.js', import.meta.url), 'utf8')
function harness(gate = null) {
  const events = new Map(), records = [], frames = [], observers = []
  class Element {}
  const document = { visibilityState: 'visible', hasFocus: () => true, activeElement: null, querySelector: () => null }
  const context = {
    document, Element, URL, performance, queueMicrotask, location: { href: 'tauri://localhost/index.html' },
    requestAnimationFrame: callback => frames.push(callback),
    addEventListener: (name, callback) => events.set(name, [...(events.get(name) ?? []), callback]),
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this) }
      observe() {}
      disconnect() { this.disconnected = true }
    },
    __vaporDiagnosticGateConfig: gate,
    __TAURI_INTERNALS__: { invoke: async (command, args) => records.push({ command, ...args }) },
  }
  context.window = context
  vm.runInNewContext(source, context)
  return { context, records, frames, observers, emit(name, event = {}) { for (const callback of events.get(name) ?? []) callback(event) } }
}
const flushed = () => new Promise(resolve => queueMicrotask(resolve))

test('release allows generated editor styles without opting scripts out of CSP protection', () => {
  const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
  assert.deepEqual(config.app.security.dangerousDisableAssetCspModification, ['style-src'])
  assert.match(config.app.security.csp, /style-src 'self' 'unsafe-inline'/)
  assert.match(config.app.security.csp, /script-src 'self';/)
  assert(!config.app.security.csp.includes('unsafe-eval'))
})

test('CSP evidence classifies style blocks without retaining policy, CSS or input', async () => {
  const h = harness()
  for (let index = 0; index < 40; index++) h.emit('securitypolicyviolation', {
    effectiveDirective: index === 0 ? 'style-src-attr' : 'style-src-elem', blockedURI: 'inline',
    disposition: 'enforce', originalPolicy: "style-src 'nonce-private'; SELECT secret", sample: 'private input',
  })
  await flushed()
  const records = h.records.filter(x => x.stage === 'perf_csp_violation')
  assert.equal(records.length, 30)
  assert.equal(records[0].metrics.styleAttribute, 1)
  assert.equal(records[1].metrics.styleElement, 1)
  assert.equal(records[0].metrics.noncePolicy, 1)
  assert(!/private|secret|SELECT/.test(JSON.stringify(records)))
})

test('error evidence retains type, static message and source positions without raw SQL/input/credentials', async () => {
  const h = harness()
  h.emit('unhandledrejection', { reason: { name: 'TypeError', message: "Cannot read properties of SELECT secret password=private", stack: "SELECT secret\ninput@tauri://localhost/assets/MainPanel-Abcd1234.js:2:45\nprivate@file:///Users/private/config.db:1:2" } })
  h.emit('unhandledrejection', { reason: "SELECT secret password=private" })
  h.emit('error', { message: 'Importing a module script failed.', filename: 'tauri://localhost/assets/SqlEditor-Abcd1234.js?password=private#secret', lineno: 2, colno: 8 })
  await flushed()
  const records = h.records.filter(x => x.stage === 'perf_error')
  assert.equal(records.length, 3)
  const json = JSON.stringify(records)
  assert(!json.includes('SELECT') && !json.includes('secret') && !json.includes('private'))
  assert.equal(records[0].details.name, 'TypeError')
  assert.equal(records[0].details.stack[0], 'app:/assets/MainPanel-Abcd1234.js:2:45')
  assert.equal(records[2].details.location, 'app:/assets/SqlEditor-Abcd1234.js')
  assert.equal(records[2].details.line, 2)
  assert.match(records[2].details.message, /Dynamic module/)
})

test('resource errors identify bundled positions and redact external/data URLs', async () => {
  const h = harness()
  for (const src of ['tauri://localhost/favicon.png', 'https://private:secret@database.invalid/private.svg', 'data:image/svg+xml,private']) {
    const target = new h.context.Element(); target.src = src; target.tagName = 'IMG'
    h.emit('error', { target })
  }
  await flushed()
  const records = h.records.filter(x => x.stage === 'perf_error')
  assert.equal(records[0].details.location, 'app:/favicon.png')
  assert(!JSON.stringify(records).includes('private'))
  assert(!JSON.stringify(records).includes('secret'))
  const inlineStyle = new h.context.Element(); inlineStyle.localName = 'style'
  h.emit('error', { target: inlineStyle })
  await flushed()
  const inline = h.records.filter(x => x.stage === 'perf_error').at(-1)
  assert.equal(inline.details.element, 'style')
  assert.equal(inline.details.locationClass, 'unknown')
})

test('rAF requests are bounded, immutable and never report a callback gap as click latency', async () => {
  const h = harness()
  for (let i = 0; i < 30; i++) h.emit('click')
  assert.equal(h.frames.length, 8)
  h.frames.splice(0).forEach(callback => callback())
  await flushed()
  const frames = h.records.filter(x => x.stage === 'perf_frame')
  assert.deepEqual(frames.map(x => x.metrics.request), [1, 2, 3, 4, 5, 6, 7, 8])
  assert(frames.every(x => !('latencyMs' in x.metrics)))
})

test('boot observer disconnects at shell and default diagnostic mode installs no editor gate', async () => {
  const h = harness()
  assert.equal(h.context.__vaporDiagnosticEditorGate, undefined)
  h.context.document.querySelector = () => ({})
  h.observers[0].callback()
  await flushed()
  assert.equal(h.observers[0].disconnected, true)
})

test('explicit first-load gate releases on real composition boundary without a timer or field contents', async () => {
  const h = harness('workspace-composition')
  let released = false
  const gate = h.context.__vaporDiagnosticEditorGate('workspace').then(() => { released = true })
  const target = { dataset: { sqlLoadingDraft: 'workspace' }, value: 'private', selectionStart: 7, selectionEnd: 7 }
  h.emit('input', { target })
  await flushed()
  assert.equal(released, false)
  h.emit('compositionstart', { target })
  await gate
  assert.equal(released, true)
  assert(!JSON.stringify(h.records).includes('private'))
  assert.equal(h.context.__vaporDiagnosticEditorGate('workspace'), undefined)
})

test('composition arriving before module resolution cannot strand the diagnostic gate', () => {
  const h = harness('workspace-composition')
  h.emit('compositionstart', { target: { dataset: { sqlLoadingDraft: 'workspace' }, value: '', selectionStart: 0, selectionEnd: 0 } })
  assert.equal(h.context.__vaporDiagnosticEditorGate('workspace'), undefined)
})
