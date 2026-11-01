import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright-core'

// Geometry-only regression over the real React data panel. No database behavior
// is inferred from this disconnected, retained-result fixture.
test('preview predicate remains usable beside long sort columns', { timeout: 120_000 }, async () => {
  const output = await mkdtemp(join(tmpdir(), 'vapor-preview-layout-'))
  const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } })
  let browser
  const measurements = []
  try {
    await server.listen()
    browser = await chromium.launch({ headless: true })
    for (const width of [800, 1200]) for (const language of ['en', 'zh']) for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width, height: width === 800 ? 600 : 800 } })
      await page.addInitScript(({ language, theme }) => {
        localStorage.setItem('vaporlensdb.language', language)
        localStorage.setItem('vaporlensdb.theme', theme)
        window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} }
        window.__TAURI_INTERNALS__ = {
          transformCallback: () => 1, unregisterCallback() {},
          metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
          invoke: async command => command === 'list_credential_cleanup' ? { pending: [], recent: [] }
            : command === 'health_check' ? { status: 'ok', version: '0.1.0' }
              : command.startsWith('list_') || command === 'restore_sql_workspace' ? [] : null,
        }
      }, { language, theme })
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
      await page.locator('header.ide-top-bar').waitFor()
      await page.evaluate(async () => {
        const { useEditorStore } = await import('/src/stores/editorStore.ts')
        const { useQueryResultStore } = await import('/src/stores/queryResultStore.ts')
        const { useUiStore } = await import('/src/stores/uiStore.ts')
        useUiStore.setState({ sidebarWidth: 426 })
        useQueryResultStore.getState().setResults('geometry', [{ columns: [{ name: '中文长字段名称_long_column_name_0123456789', dataType: 'TEXT', nullable: true }], rows: [['geometry']], rowCount: 1, elapsedMs: 0, affectedRows: 0, truncated: false }])
        useEditorStore.setState({ activeTabId: 'preview', tabs: [{ id: 'preview', kind: 'data', title: 'Layout QA', sql: '', connectionId: null, lastQueryId: 'geometry', dataContext: { database: null, schema: 'main', object: 'layout_qa', objectKind: 'table', driverType: 'sqlite', limit: 200, offset: 0, primaryKeyColumns: [] } }] })
      })
      const input = page.getByPlaceholder(language === 'en' ? 'WHERE predicate' : 'WHERE 条件')
      await input.waitFor()
      const sizes = await input.evaluate(element => {
        const row = element.parentElement, sort = row.querySelector('[role="combobox"]')
        return { input: element.getBoundingClientRect().width, sort: sort.getBoundingClientRect().width, client: row.clientWidth, scroll: row.scrollWidth }
      })
      measurements.push({ width, language, theme, ...sizes })
      await page.screenshot({ path: join(output, `${width}-${language}-${theme}.png`) })
      assert.ok(sizes.input >= 160, `WHERE collapsed to ${sizes.input}px at ${width}/${language}/${theme}`)
      assert.ok(sizes.sort >= 128 && sizes.sort <= 200, `sort width ${sizes.sort}px monopolizes the row`)
      assert.ok(sizes.scroll <= sizes.client + 1, `filter toolbar overflow at ${width}/${language}/${theme}`)
      await page.close()
    }
  } finally {
    await writeFile(join(output, 'measurements.json'), JSON.stringify(measurements, null, 2))
    console.log(`Browser-only evidence: ${output}`)
    await browser?.close()
    await server.close()
  }
})
