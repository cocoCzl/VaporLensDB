import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright-core'

// Real browser geometry over the production React shell; IPC is an explicit,
// read-only catalog fixture. This does not validate JDBC or database behavior.
const products = ['postgres', 'mysql', 'sqlite'].map(id => ({
  id, name: { postgres: 'PostgreSQL', mysql: 'MySQL', sqlite: 'SQLite' }[id],
  iconKey: id, adapterId: id, builtIn: true, defaultDriverDefinitionId: id,
}))
const drivers = products.flatMap(product => [false, true].map(jdbc => ({
  id: jdbc ? `jdbc-${product.id}` : product.id, productId: product.id,
  name: `${product.name}${jdbc ? ' JDBC' : ''}`, driverType: product.id,
  driverDialect: product.id === 'postgres' ? 'postgresql' : product.id,
  backend: jdbc ? 'jdbc' : 'nativeRust', status: 'ready', builtIn: true,
  userDriverRequired: jdbc, driverArtifacts: [],
  defaultPort: product.id === 'postgres' ? 5432 : product.id === 'mysql' ? 3306 : null,
  jdbcDriverClass: jdbc ? `${product.id}.example.Driver` : null,
  urlTemplate: jdbc ? `jdbc:${product.id}://{host}/{database}` : null,
  connectionVariants: [{ id: 'hostPort', label: 'Host/Port', requiredFields: ['host', 'database', 'username'] }],
  capabilities: { canConnect: true, canQuery: true, canReadMetadata: true, canStream: true, canCancel: true, canGenerateDdl: false },
})))

const output = process.env.VAPOR_LAYOUT_OUTPUT ?? await mkdtemp(join(tmpdir(), 'vapor-driver-layout-'))
await mkdir(output, { recursive: true })

async function geometry(root) {
  return root.evaluate(element => {
    const rect = item => {
      const r = item.getBoundingClientRect(), css = getComputedStyle(item)
      return { tag: item.tagName, width: r.width, height: r.height, x: r.x, y: r.y, display: css.display, flex: css.flex, direction: css.flexDirection, containerType: css.containerType }
    }
    const heading = element.querySelector('h2'), search = element.querySelector('input'), list = element.querySelector('[role="list"]')
    return { root: rect(element), parent: rect(element.parentElement), heading: heading && rect(heading), search: search && rect(search), list: list && rect(list), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }
  })
}

async function assertManager(page, scope, name, measurements) {
  const root = scope.locator('.workflow-page').first()
  await root.waitFor({ state: 'attached' })
  const sizes = await geometry(root)
  measurements.push({ name, ...sizes })
  await writeFile(join(output, 'measurements.json'), JSON.stringify(measurements, null, 2))
  await page.screenshot({ path: join(output, `${name}.png`) })
  assert.ok(sizes.root.width >= sizes.parent.width - 2, `${name}: manager ${sizes.root.width}px must fill parent ${sizes.parent.width}px`)
  assert.ok(sizes.heading.width >= 100, `${name}: title collapsed to ${sizes.heading.width}px`)
  assert.ok(sizes.heading.height <= 55, `${name}: title wraps vertically (${sizes.heading.height}px)`)
  if (sizes.search && sizes.list?.width > 0) assert.ok(sizes.search.width >= 180, `${name}: search collapsed to ${sizes.search.width}px`)
  assert.ok(sizes.scrollWidth <= sizes.clientWidth + 1, `${name}: manager horizontal overflow`)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: window horizontal overflow`)
  return root
}

const copy = Object.fromEntries(await Promise.all(['en', 'zh'].map(async language => {
  const l = JSON.parse(await readFile(new URL(`../../src/locales/${language}.json`, import.meta.url), 'utf8'))
  return [language, { manager: l.topBar.drivers, search: l.drivers.search, settings: l.settings.title,
    legacy: l.drivers.title, sections: l.settings.sections, general: l.settings.general, content: l.settings.content,
    create: l.connection.new, next: l.connectionCatalog.next, manage: l.driverRefactor.manage, back: l.driverWorkflow.back,
    close: l.sql.closeTab, hide: l.topBar.hideSidebar, show: l.topBar.showSidebar, explorer: l.connection.explorerTitle,
    configuration: l.driverRefactor.configuration, importJar: l.drivers.importJar }]
})))

async function selectPostgres(page, root, c, name, measurements) {
  const search = root.getByRole('textbox', { name: c.search })
  if (!await search.isVisible()) await root.getByRole('button', { name: c.back, exact: true }).click()
  await search.fill('PostgreSQL')
  const list = root.getByRole('list')
  await list.getByRole('listitem', { name: 'PostgreSQL JDBC', exact: true }).waitFor()
  assert.equal(await list.getByRole('listitem').count(), 1, `${name}: search filters the catalog`)
  await list.getByRole('listitem', { name: 'PostgreSQL JDBC', exact: true }).click()
  await root.locator('h3').filter({ hasText: 'PostgreSQL JDBC' }).waitFor()
  await assertManager(page, page.locator('main'), name, measurements)
  const details = await root.locator('dl').boundingBox()
  assert.ok(details.width >= 240, `${name}: details too narrow (${details.width}px)`)
  const action = await root.getByRole('button', { name: c.importJar, exact: true }).boundingBox()
  assert.ok(action && action.width > 60 && action.y + action.height <= page.viewportSize().height, `${name}: installation action unavailable`)
  Object.assign(measurements.at(-1), { details, installationAction: action })
  await writeFile(join(output, 'measurements.json'), JSON.stringify(measurements, null, 2))
}

test('driver workspaces keep usable geometry across hosts, languages, themes and sidebar widths', { timeout: 180_000 }, async () => {
  const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } })
  let browser
  const measurements = []
  const commands = []
  try {
    await server.listen()
    const address = server.httpServer.address()
    browser = await chromium.launch({ headless: true })
    for (const viewport of [{ width: 800, height: 600 }, { width: 1200, height: 800 }]) {
      for (const language of ['zh', 'en']) for (const theme of ['light', 'dark']) {
        const label = `${viewport.width}-${language}-${theme}`, c = copy[language]
        const context = await browser.newContext({ viewport })
        const page = await context.newPage()
        const errors = []
        page.on('pageerror', error => errors.push(error.message))
        page.setDefaultTimeout(10_000)
        await page.addInitScript(({ language, theme, products, drivers }) => {
          localStorage.setItem('vaporlensdb.language', language)
          localStorage.setItem('vaporlensdb.theme', theme)
          window.__layoutCommands = []
          window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
          window.__TAURI_INTERNALS__ = {
            transformCallback: () => 1, unregisterCallback: () => {},
            metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
            invoke: async command => {
              window.__layoutCommands.push(command)
              if (command === 'list_driver_definitions') return drivers
              if (command === 'list_database_products') return products
              if (command === 'health_check') return { status: 'ok', app: 'Browser layout fixture', version: '0.1.0', configPath: 'browser-only', configSchemaVersion: 15 }
              if (command === 'list_credential_cleanup') return { pending: [], recent: [] }
              if (command.startsWith('plugin:')) return 1
              if (command.startsWith('list_') || command === 'restore_sql_workspace') return []
              return null
            },
          }
        }, { language, theme, products, drivers })
        await page.goto(`http://127.0.0.1:${address.port}`)
        await page.screenshot({ path: join(output, `${label}-startup.png`) })
        const toolbar = page.locator('header.ide-top-bar')
        await toolbar.getByRole('button', { name: c.manager, exact: true }).click()
        let root = await assertManager(page, page.locator('main'), `${label}-top`, measurements)
        await selectPostgres(page, root, c, `${label}-selected`, measurements)

        await toolbar.getByRole('button', { name: c.settings, exact: true }).click()
        const content = page.getByRole('region', { name: c.content, exact: true })
        await content.waitFor()
        const selector = page.getByRole('combobox', { name: c.sections })
        const nav = page.locator('[data-settings-nav]')
        const fixed = await selector.isVisible() ? selector : nav
        const before = await fixed.boundingBox()
        await content.focus()
        await content.press('End')
        await page.waitForFunction(() => { const el = document.querySelector('[data-settings-content]'); return el.scrollTop > 0 })
        const after = await fixed.boundingBox()
        assert.ok(after && Math.abs(after.y - before.y) < 1, `${label}: settings navigation moved with content`)
        await page.screenshot({ path: join(output, `${label}-settings-scrolled.png`) })
        // Old settings compatibility entry reuses the standalone workspace.
        if (await selector.isVisible()) {
          await selector.click()
          await page.getByRole('option', { name: c.legacy, exact: true }).click()
        } else await nav.getByRole('button', { name: c.legacy, exact: true }).click()
        root = await assertManager(page, page.locator('main'), `${label}-legacy`, measurements)

        // Switch back and close/reopen the singleton tab.
        await toolbar.getByRole('button', { name: c.settings, exact: true }).click()
        await toolbar.getByRole('button', { name: c.manager, exact: true }).click()
        await page.locator('.ide-tab-strip .group').filter({ has: page.getByRole('button', { name: c.manager, exact: true }) }).getByRole('button', { name: c.close, exact: true }).click()
        await toolbar.getByRole('button', { name: c.manager, exact: true }).click()
        root = await assertManager(page, page.locator('main'), `${label}-reopened`, measurements)
        await selectPostgres(page, root, c, `${label}-reopened-selected`, measurements)

        // Layout follows actual workspace width, including sidebar resizing.
        await toolbar.getByRole('button', { name: c.hide, exact: true }).click()
        await assertManager(page, page.locator('main'), `${label}-collapsed`, measurements)
        await toolbar.getByRole('button', { name: c.show, exact: true }).click()
        const splitter = page.getByRole('separator', { name: c.explorer, exact: true })
        await splitter.focus()
        for (let step = 0; step < 15; step++) await splitter.press('ArrowRight')
        await assertManager(page, page.locator('main'), `${label}-sidebar-wide`, measurements)
        const wide = measurements.at(-1).root.width
        for (let step = 0; step < 15; step++) await splitter.press('ArrowLeft')
        await assertManager(page, page.locator('main'), `${label}-sidebar-narrow`, measurements)
        if (viewport.width === 1200) assert.ok(measurements.at(-1).root.width > wide + 100, `${label}: sidebar resizing did not exercise different content widths`)

        // Configuration and local-install pages replace the same flex child.
        await root.getByRole('button', { name: c.configuration, exact: true }).click()
        await assertManager(page, page.locator('main'), `${label}-configuration`, measurements)
        await page.locator('main').getByRole('button', { name: c.back, exact: true }).click()
        root = page.locator('main .workflow-page')
        await selectPostgres(page, root, c, `${label}-before-install`, measurements)
        await root.getByRole('button', { name: c.importJar, exact: true }).click()
        await assertManager(page, page.locator('main'), `${label}-local-install`, measurements)
        await page.locator('main').getByRole('button', { name: c.back, exact: true }).click()

        // Existing new-connection workflow, with its own block-layout host.
        await toolbar.getByRole('button', { name: c.create, exact: true }).click()
        const dialog = page.getByRole('dialog')
        await dialog.getByRole('radio', { name: 'PostgreSQL', exact: true }).click()
        await dialog.getByRole('button', { name: c.next, exact: true }).click()
        await dialog.locator('#driver-profile').click()
        await page.getByRole('option', { name: /PostgreSQL JDBC/ }).click()
        await dialog.getByRole('button', { name: c.manage, exact: true }).click()
        const embedded = await assertManager(page, dialog, `${label}-connection-dialog`, measurements)
        await embedded.locator('h3').filter({ hasText: 'PostgreSQL JDBC' }).waitFor()
        assert.ok((await embedded.locator('dl').boundingBox()).width >= 240, `${label}: dialog details collapsed`)
        await embedded.getByRole('button', { name: c.back, exact: true }).click()
        await dialog.locator('#driver-profile').waitFor({ state: 'visible' })
        assert.deepEqual(errors, [], `${label}: browser runtime errors`)
        commands.push(...await page.evaluate(() => window.__layoutCommands))
        await context.close()
      }
    }
    assert.ok(!commands.some(command => ['connect', 'test_connection', 'download_jdbc_driver', 'delete_connection'].includes(command)), 'layout checks must not connect or mutate saved data')
  } finally {
    await browser?.close()
    await server.close()
    console.log(`Browser layout evidence: ${output}`)
  }
})
