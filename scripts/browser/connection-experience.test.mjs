import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright-core'

// Explicitly MOCKED IPC. Tests real React/CSS geometry and renderer costs only.
// These samples are not native WebKit, DB latency, or cold application startup.
const source = resolve(process.env.VAPOR_QA_SOURCE ?? '.')
const output = process.env.VAPOR_QA_OUTPUT
if (!output || resolve(output) === resolve('.') || resolve(output).startsWith(`${resolve('.')}/`)) throw new Error('Set VAPOR_QA_OUTPUT outside the repository')
const before = process.env.VAPOR_QA_BEFORE === '1'
const workloadsOnly = process.env.VAPOR_QA_WORKLOADS_ONLY === '1'
const copy = Object.fromEntries(await Promise.all(['en', 'zh'].map(async language => [language, JSON.parse(await readFile(join(source, `src/locales/${language}.json`), 'utf8'))])))
const drivers = ['postgres', 'mysql', 'sqlite'].map(id => ({
  id, productId: id, name: { postgres: 'PostgreSQL', mysql: 'MySQL', sqlite: 'SQLite' }[id],
  driverType: id, driverDialect: id === 'postgres' ? 'postgresql' : id,
  backend: 'nativeRust', status: 'ready', builtIn: true, userDriverRequired: false, driverArtifacts: [],
  defaultPort: id === 'postgres' ? 5432 : id === 'mysql' ? 3306 : null,
  connectionVariants: id === 'sqlite' ? [{ id: 'file', label: 'File', requiredFields: ['connectionUrl'] }]
    : [{ id: 'hostPort', label: 'Host/port', requiredFields: ['host', 'username', 'database'] }, { id: 'urlOnly', label: 'URL', requiredFields: ['connectionUrl', 'username'] }],
  capabilities: { canConnect: true, canQuery: true, canReadMetadata: true, canStream: true, canCancel: true, canGenerateDdl: true },
}))
const products = drivers.map(d => ({ id: d.id, name: d.name, builtIn: true, defaultDriverDefinitionId: d.id, iconKey: d.id, adapterId: d.driverDialect }))
const connections = Array.from({ length: 50 }, (_, i) => ({ id: `fixture-${i}`, name: `Local ${String(i).padStart(2, '0')}`, driverType: 'sqlite', productId: 'sqlite', driverDefinitionId: 'sqlite', connectionMode: 'file', connectionUrl: 'fixture.sqlite' }))

async function fixture(page, language, theme) {
  await page.addInitScript(({ language, theme, drivers, products, connections }) => {
    localStorage.setItem('vaporlensdb.language', language)
    localStorage.setItem('vaporlensdb.theme', theme)
    window.__commands = []
    window.__testMode = 'success'
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} }
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => 1, unregisterCallback() {},
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      invoke: async (command, args) => {
        window.__commands.push(command)
        if (command === 'list_connections') return connections
        if (command === 'list_driver_definitions') return drivers
        if (command === 'list_database_products') return products
        if (command === 'get_tables') return Array.from({ length: window.__tableCount ?? 0 }, (_, i) => ({ schema: 'main', name: `table_${String(i).padStart(4, '0')}`, tableType: 'table' }))
        if (command === 'get_views') return []
        if (command === 'test_connection') {
          await new Promise(resolve => setTimeout(resolve, 160))
          if (window.__testMode === 'failure') throw { code: 'CONNECTION_FAILED', message: 'Connection refused fixture', detail: 'password="hidden-fixture"; phase=tcp_connect' }
          return null
        }
        if (command === 'plugin:clipboard-manager|write_text') { window.__copied = args.text; return null }
        if (command === 'health_check') return { status: 'ok', version: '0.1.0', app: 'Mock IPC browser fixture' }
        if (command === 'list_credential_cleanup') return { pending: [], recent: [] }
        if (command.startsWith('plugin:')) return 1
        if (command.startsWith('list_') || command === 'restore_sql_workspace') return []
        return null
      },
    }
  }, { language, theme, drivers, products, connections })
}

async function twoFrames(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

test('connection feedback matrix and renderer baseline (mock IPC)', { timeout: 240_000 }, async () => {
  await mkdir(output, { recursive: true })
  const server = await createServer({ root: source, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [source, resolve('.')] } } })
  let browser
  const measurements = [], rendering = [], metadata = [], lifecycle = []
  try {
    await server.listen()
    browser = await chromium.launch({ headless: true })
    for (const viewport of workloadsOnly ? [] : [{ width: 800, height: 600 }, { width: 1200, height: 800 }]) for (const language of ['zh', 'en']) for (const theme of ['light', 'dark']) {
      const c = copy[language], label = `${viewport.width}x${viewport.height}-${language}-${theme}`
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
      page.setDefaultTimeout(8000)
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await fixture(page, language, theme)
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
      const create = page.locator('header.ide-top-bar').getByRole('button', { name: c.connection.new, exact: true })
      await create.waitFor()
      await page.locator('[data-connection-id]').first().waitFor()
      assert.equal(await page.locator('[data-connection-id]').count(), 50)
      const timings = []
      for (let sample = 0; sample < 4; sample++) {
        await page.evaluate(() => window.__openAt = performance.now())
        await create.click()
        const dialog = page.getByRole('dialog')
        await dialog.getByRole('radiogroup').waitFor()
        await twoFrames(page)
        timings.push(await page.evaluate(() => performance.now() - window.__openAt))
        if (sample < 3) {
          await dialog.getByRole('button', { name: c.common.cancel, exact: true }).click()
          await dialog.waitFor({ state: 'hidden' })
        }
      }
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('button', { name: c.connectionCatalog.next, exact: true }).click()
      await dialog.locator('#connection-username').fill('fixture-user')
      await dialog.locator('#connection-database').fill('fixture')
      await page.screenshot({ path: join(output, `${label}-parameters.png`) })
      await dialog.getByRole('button', { name: c.connectionForm.testConnection, exact: true }).click()
      if (!before) {
        const busy = dialog.getByRole('button', { name: c.connectionForm.testing, exact: true })
        await busy.waitFor()
        assert.equal(await busy.isDisabled(), true)
        assert.equal(await busy.getAttribute('aria-busy'), 'true')
        await page.screenshot({ path: join(output, `${label}-running.png`) })
      }
      await dialog.getByText(c.connectionForm.connectionTestSucceeded, { exact: true }).waitFor()
      await page.screenshot({ path: join(output, `${label}-success.png`) })
      const geometry = await dialog.evaluate(el => {
        const r = item => { const b = item.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height } }
        const form = el.querySelector('.connection-form'), scroll = form.children[1]
        const feedback = el.querySelector('[data-connection-feedback]')
        return { dialog: r(el), feedback: feedback && r(feedback), footer: r(form.lastElementChild), client: el.clientWidth, scroll: el.scrollWidth, formScroll: scroll.scrollHeight > scroll.clientHeight, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio } }
      })
      assert.ok(geometry.scroll <= geometry.client + 1, `${label}: horizontal overflow`)
      assert.ok(geometry.footer.y + geometry.footer.height <= viewport.height, `${label}: footer clipped`)
      if (!before) {
        assert.ok(geometry.feedback.y >= geometry.dialog.y && geometry.feedback.y + geometry.feedback.height <= geometry.footer.y + 1)
        const saved = dialog.getByRole('button', { name: c.connectionForm.saveOnly, exact: true })
        const connect = dialog.getByRole('button', { name: c.connectionForm.saveAndConnect, exact: true })
        assert.equal(await saved.isVisible(), true)
        assert.equal(await connect.isVisible(), true)
        const y = geometry.feedback.y
        await dialog.evaluate(el => { el.querySelector('.connection-form').children[1].scrollTop = 10000 })
        await twoFrames(page)
        assert.equal(Math.round((await dialog.locator('[data-connection-feedback]').boundingBox()).y), Math.round(y))
        await dialog.locator('#connection-host').fill('other.invalid')
        assert.equal(await dialog.getByText(c.connectionForm.connectionTestSucceeded, { exact: true }).count(), 0)
        await page.evaluate(() => window.__testMode = 'failure')
        await dialog.getByRole('button', { name: c.connectionForm.testConnection, exact: true }).click()
        await dialog.getByText(c.connectionForm.testFailed, { exact: true }).waitFor()
        await dialog.locator('[data-connection-feedback] summary').click()
        await dialog.getByRole('button', { name: c.connectionForm.copyRedactedDetails, exact: true }).click()
        await dialog.getByRole('button', { name: c.connectionForm.detailsCopied, exact: true }).waitFor()
        assert.ok((await page.evaluate(() => window.__copied)).includes('[REDACTED]'))
        assert.ok(!(await page.evaluate(() => window.__copied)).includes('hidden-fixture'))
        await page.screenshot({ path: join(output, `${label}-failure.png`) })
      }
      measurements.push({ label, source, build: 'Vite development, Chromium; mock IPC; not native timing', dialogFirstMs: timings[0], dialogRepeatMs: timings.slice(1), geometry, commands: await page.evaluate(() => window.__commands), errors })
      assert.deepEqual(errors, [])
      await page.close()
    }

    // Independent bounded result fixtures, not database query timing.
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
    await fixture(page, 'en', 'light')
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
    await page.locator('header.ide-top-bar').waitFor()
    await page.locator('[data-connection-id]').first().waitFor()
    await page.waitForFunction(async () => {
      const { useConnectionStore } = await import('/src/stores/connectionStore.ts')
      return !useConnectionStore.getState().loading && useConnectionStore.getState().connections.length === 50
    })
    for (const count of [500, 1000]) {
      for (let sample = 0; sample < 5; sample++) {
        const start = await page.evaluate(async ({ count, sample }) => {
          const { useConnectionStore } = await import('/src/stores/connectionStore.ts')
          const { useMetadataStore } = await import('/src/stores/metadataStore.ts')
          const { useEditorStore } = await import('/src/stores/editorStore.ts')
          const { openBrowserWorkspace } = await import('/src/components/workspace/openBrowserWorkspace.ts')
          useEditorStore.setState({ tabs: [], activeTabId: null })
          useMetadataStore.getState().clearConnection('fixture-0')
          useConnectionStore.setState({ statuses: { 'fixture-0': { connectionId: 'fixture-0', status: 'connected' } }, lifecycleEpochs: { 'fixture-0': count + sample } })
          window.__tableCount = count
          window.__commands = []
          const start = performance.now()
          openBrowserWorkspace('fixture-0', 'main', { kind: 'schema', database: 'fixture.sqlite', schema: 'main', objectKind: 'table' })
          return start
        }, { count, sample })
        const workspace = page.getByRole('region', { name: copy.en.browser.workspace })
        await workspace.getByRole('button', { name: `table_${String(count - 1).padStart(4, '0')}`, exact: false }).waitFor({ timeout: 8000 }).catch(async error => {
          await page.screenshot({ path: join(output, 'workload-failure.png') })
          await writeFile(join(output, 'workload-failure.json'), JSON.stringify(await page.evaluate(async () => {
            const { useConnectionStore } = await import('/src/stores/connectionStore.ts')
            const { useMetadataStore } = await import('/src/stores/metadataStore.ts')
            return { text: document.body.innerText, commands: window.__commands, statuses: useConnectionStore.getState().statuses, tables: useMetadataStore.getState().tables }
          }), null, 2))
          throw error
        })
        await twoFrames(page)
        const expandedMs = await page.evaluate(start => performance.now() - start, start)
        const filter = workspace.getByRole('textbox', { name: copy.en.browser.filterObjects })
        const filterStart = await page.evaluate(() => performance.now())
        await filter.fill('table_0042')
        await twoFrames(page)
        const searchMs = await page.evaluate(start => performance.now() - start, filterStart)
        assert.equal(await workspace.locator('button[title^="table_"]').count(), 1)
        const cached = await page.evaluate(async () => {
          const { useMetadataStore } = await import('/src/stores/metadataStore.ts')
          await Promise.all(Array.from({ length: 10 }, () => useMetadataStore.getState().loadTables('fixture-0', 'main')))
          return window.__commands.filter(command => command === 'get_tables').length
        })
        assert.equal(cached, 1)
        metadata.push({ count, sample, expandedMs, searchMs, tableRequestsIncludingTenCachedLoads: cached,
          method: 'React browser workspace with 50 connections, immediate mock metadata; excludes native/DB costs; automation wait overhead included' })
        await filter.fill('')
        await twoFrames(page)
      }
      await page.screenshot({ path: join(output, `metadata-${count}-search.png`) })
    }
    for (const [name, count, width, length] of [['normal', 10000, 3, 12], ['wide', 1000, 128, 12], ['long', 1000, 2, 8000]]) {
      for (let sample = 0; sample < 5; sample++) {
        const result = await page.evaluate(async ({ name, count, width, length }) => {
          const { useEditorStore } = await import('/src/stores/editorStore.ts')
          const { useQueryResultStore } = await import('/src/stores/queryResultStore.ts')
          const q = useQueryResultStore.getState(), e = useEditorStore
          e.setState({ tabs: [], activeTabId: null })
          q.clearResult('perf')
          const rows = Array.from({ length: count }, (_, r) => Array.from({ length: width }, (_, c) => c ? `${r}:${c} ` + 'x'.repeat(length) : r))
          const columns = Array.from({ length: width }, (_, i) => ({ name: `column_${i}`, dataType: i ? 'TEXT' : 'INTEGER', nullable: false }))
          const start = performance.now()
          q.setResults('perf', [{ columns, rows, rowCount: count, elapsedMs: 0, affectedRows: 0, truncated: false }])
          const storeMs = performance.now() - start
          e.setState({ activeTabId: 'perf-tab', tabs: [{ id: 'perf-tab', kind: 'data', title: name, sql: '', connectionId: null, lastQueryId: 'perf', dataContext: { database: null, schema: 'main', object: name, objectKind: 'table', driverType: 'sqlite', limit: 200, offset: 0, primaryKeyColumns: [] } }] })
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          return { storeMs, firstFrameMs: performance.now() - start, retainedRows: useQueryResultStore.getState().results.perf[0].rows.length, retainedBytes: useQueryResultStore.getState().retainedBytes.perf, domCells: document.querySelectorAll('.data-grid-cell').length }
        }, { name, count, width, length })
        await page.locator('.data-grid-cell').first().waitFor()
        const scrollMs = await page.locator('.data-grid-shell .overflow-auto').first().evaluate(async el => {
          const start = performance.now(); el.scrollTop = 15000
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          return performance.now() - start
        })
        const switchMs = await page.evaluate(async () => {
          const { useEditorStore } = await import('/src/stores/editorStore.ts')
          const store = useEditorStore, current = store.getState().tabs[0]
          const start = performance.now()
          store.setState({ tabs: [current, { ...current, id: 'other' }], activeTabId: 'other' })
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          return performance.now() - start
        })
        rendering.push({ name, sample, inputRows: count, columns: width, longTextCharacters: length, ...result, scrollMs, switchMs })
      }
      await page.screenshot({ path: join(output, `renderer-${name}.png`) })
    }
    lifecycle.push(await page.evaluate(async () => {
      const { useEditorStore } = await import('/src/stores/editorStore.ts')
      const { useQueryResultStore } = await import('/src/stores/queryResultStore.ts')
      const q = useQueryResultStore.getState(), e = useEditorStore.getState()
      for (const tab of useEditorStore.getState().tabs) e.closeTab(tab.id)
      for (const id of Object.keys(useQueryResultStore.getState().results)) q.clearResult(id)
      const result = { columns: [{ name: 'value', dataType: 'TEXT' }], rows: Array.from({ length: 10000 }, () => ['x'.repeat(128)]), rowCount: 10000, elapsedMs: 0, affectedRows: 0 }
      for (let i = 0; i < 30; i++) {
        q.setResults(`cycle-${i}`, [result])
        e.addTab({ id: `cycle-${i}`, kind: 'data', title: 'cycle', sql: '', connectionId: null, lastQueryId: `cycle-${i}` })
        e.closeTab(`cycle-${i}`)
      }
      const afterClose = { tabs: useEditorStore.getState().tabs.length, results: Object.keys(useQueryResultStore.getState().results).length,
        estimatedRowBytes: Object.values(useQueryResultStore.getState().retainedBytes).reduce((a, b) => a + b, 0) }
      for (let i = 0; i < 30; i++) q.setResults(`cache-${i}`, [result])
      const afterThirtyResults = { results: Object.keys(useQueryResultStore.getState().results).length,
        estimatedRowBytes: Object.values(useQueryResultStore.getState().retainedBytes).reduce((a, b) => a + b, 0) }
      for (const id of Object.keys(useQueryResultStore.getState().results)) q.clearResult(id)
      return { cycles: 30, afterClose, afterThirtyResults, afterClearResults: Object.keys(useQueryResultStore.getState().results).length,
        method: 'Store lifecycle only; estimated row bytes are not heap/RSS or native JDBC cleanup evidence' }
    }))
    assert.equal(lifecycle[0].afterClose.results, 0)
    assert.equal(lifecycle[0].afterThirtyResults.results, 20)
    assert.equal(lifecycle[0].afterClearResults, 0)
    await page.close()
  } finally {
    await writeFile(join(output, 'measurements.json'), JSON.stringify({ before, browser: browser && await browser.version(), measurements, metadata, rendering, lifecycle }, null, 2))
    await browser?.close()
    await server.close()
  }
})
