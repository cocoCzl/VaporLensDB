import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { build, preview } from 'vite'
import { chromium } from 'playwright-core'

// Production React/CSS, isolated mock IPC. Instrumentation is added by this
// build-only plugin, never shipped in the application.
const source = resolve(process.env.VAPOR_QA_SOURCE ?? '.')
const output = resolve(process.env.VAPOR_QA_OUTPUT ?? '')
if (!process.env.VAPOR_QA_OUTPUT || output.startsWith(resolve('.') + '/') || output === resolve('.')) throw Error('Use an external output directory')
await mkdir(output, { recursive: true })
const copy = Object.fromEntries(await Promise.all(['en', 'zh'].map(async lang => [lang, JSON.parse(await readFile(join(source, `src/locales/${lang}.json`), 'utf8'))])))
const stores = { editorStore: 'useEditorStore', queryResultStore: 'useQueryResultStore', connectionStore: 'useConnectionStore' }
await build({ root: source, logLevel: 'warn', build: { outDir: join(output, 'dist'), emptyOutDir: true }, plugins: [{ name: 'isolated-measurement-stores', transform(code, id) {
  const entry = Object.entries(stores).find(([name]) => id.endsWith(`/stores/${name}.ts`))
  return entry ? `${code}\n;(globalThis.__qaStores ??= {}).${entry[0]} = ${entry[1]};` : null
} }] })
const server = await preview({ root: source, logLevel: 'error', build: { outDir: join(output, 'dist') }, preview: { host: '127.0.0.1', port: 0 } })
const browser = await chromium.launch({ headless: true })
const measurements = [], geometry = []
const before = process.env.VAPOR_QA_BEFORE === '1'
const workloadsOnly = process.env.VAPOR_QA_WORKLOADS_ONLY === '1'
const matrixOnly = process.env.VAPOR_QA_MATRIX_ONLY === '1'
const semantics = []
const drivers = ['postgres', 'sqlite'].map(id => ({ id, productId: id, name: id === 'postgres' ? 'PostgreSQL' : 'SQLite', driverType: id, driverDialect: id === 'postgres' ? 'postgresql' : id, backend: 'nativeRust', builtIn: true, status: 'ready', userDriverRequired: false, driverArtifacts: [], defaultPort: id === 'postgres' ? 5432 : null,
  connectionVariants: id === 'sqlite' ? [{ id: 'file', label: 'File', requiredFields: ['connectionUrl'] }] : [{ id: 'hostPort', label: 'Host/port', requiredFields: ['host', 'username', 'database'] }],
  capabilities: { canConnect: true, canQuery: true, canReadMetadata: true, canStream: true, canCancel: true } }))
drivers.push({ ...drivers[0], id: 'postgres-jdbc', name: 'PostgreSQL JDBC', driverType: 'jdbc', backend: 'jdbc', builtIn: false, jdbcDriverClass: 'org.postgresql.Driver', userDriverRequired: true })
const products = drivers.slice(0, 2).map(d => ({ id: d.id, name: d.name, builtIn: true, defaultDriverDefinitionId: d.id, iconKey: d.id, adapterId: d.driverDialect }))
async function fixture(page, language, theme) {
  await page.addInitScript(({ language, theme, drivers, products }) => {
    localStorage.setItem('vaporlensdb.language', language); localStorage.setItem('vaporlensdb.theme', theme)
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} }
    window.__TAURI_INTERNALS__ = { transformCallback: () => 1, unregisterCallback() {}, metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, invoke: async (command, args) => {
      if (command === 'list_driver_definitions') return drivers
      if (command === 'list_database_products') return products
      if (command === 'list_driver_installations') return [{id:'local-jdbc',driverDefinitionId:'postgres-jdbc',label:'Local fixture 42.7.13',version:'42.7.13',artifacts:[{path:'/local/driver.jar',sha256:null,role:'driver'}],javaRequirement:'17'}]
      if (command === 'list_connections') return Array.from({ length: 50 }, (_, i) => ({ id: `fixture-${i}`, name: `Local ${i}`, driverType: 'sqlite', connectionUrl: 'fixture.sqlite' }))
      if (command === 'test_connection') { await new Promise(r => setTimeout(r, 150)); return null }
      if (command === 'plugin:clipboard-manager|write_text') { window.__copied = args.text; return null }
      if (command === 'health_check') return { status: 'ok', version: '0.1.0' }
      if (command === 'list_credential_cleanup') return { pending: [], recent: [] }
      if (command.startsWith('plugin:')) return 1
      if (command.startsWith('list_') || command === 'restore_sql_workspace') return []
      return null
    } }
  }, { language, theme, drivers, products })
}
const frames = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
try {
  for (const viewport of workloadsOnly ? [] : [{ width: 800, height: 600 }, { width: 1200, height: 800 }]) for (const language of ['zh', 'en']) for (const theme of ['light', 'dark']) for (const product of ['sqlite', 'postgres', 'postgres-jdbc']) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 }); page.setDefaultTimeout(10000)
    const c = copy[language], label = `${viewport.width}x${viewport.height}-${language}-${theme}-${product}`
    await fixture(page, language, theme); await page.goto(server.resolvedUrls.local[0])
    await page.locator('[data-connection-id]').first().waitFor()
    await page.locator('header.ide-top-bar').getByRole('button', { name: c.connection.new, exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: product === 'sqlite' ? 'SQLite' : 'PostgreSQL', exact: true }).click()
    await dialog.getByRole('button', { name: c.connectionCatalog.next, exact: true }).click()
    if (product === 'postgres-jdbc') {
      await dialog.locator('#driver-profile').click()
      await page.getByRole('option', {name:/PostgreSQL JDBC/}).click()
      await dialog.getByRole('combobox', {name:c.driverRefactor.installation,exact:true}).click()
      await page.getByRole('option', {name:'Local fixture 42.7.13',exact:true}).click()
    }
    if (product === 'sqlite') await dialog.locator('#connection-url').fill('/local/fixture.sqlite')
    else { await dialog.locator('#connection-username').fill('fixture'); await dialog.locator('#connection-database').fill('fixture') }
    await frames(page)
    const bounds = async () => dialog.evaluate(el => {
      const rect = el => { const r = el.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height } }
      return { dialog:rect(el), footer:rect(el.querySelector('form').lastElementChild), feedback:rect(el.querySelector('[data-connection-feedback]')), overflow:el.scrollWidth-el.clientWidth }
    })
    const initial = await bounds()
    await page.screenshot({ path:join(output, `${label}-parameters.png`) })
    await dialog.getByRole('button', { name:c.connectionForm.testConnection, exact:true }).click()
    await dialog.locator('[data-connection-feedback]').getByText(c.connectionForm.connectionTestSucceeded, { exact:true }).waitFor(); await frames(page)
    const success = await bounds()
    await page.screenshot({ path:join(output, `${label}-success.png`) })
    assert.ok(success.footer.y + success.footer.height <= viewport.height)
    assert.ok(success.overflow <= 1)
    if (!before) {
      assert.equal(success.footer.y, initial.footer.y, `${label}: test feedback moved primary actions`)
      await dialog.getByText(c.connectionForm.testNextNew,{exact:true}).waitFor()
    }
    await dialog.getByText(c.connectionForm.advanced, { exact:true }).click(); await frames(page)
    const advanced = await bounds()
    await page.screenshot({ path:join(output, `${label}-advanced.png`) })
    geometry.push({label,initial,success,advanced})
    await page.close()
  }
  const page = await browser.newPage({viewport:{width:1200,height:800}})
  await fixture(page,'en','light'); await page.goto(server.resolvedUrls.local[0]); await page.locator('[data-connection-id]').first().waitFor()
  await page.waitForFunction(() => Object.keys(window.__qaStores ?? {}).length === 3)
  const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable')
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.filter(m=>/LayoutDuration|RecalcStyleDuration|ScriptDuration|TaskDuration/.test(m.name)).map(m=>[m.name,m.value*1000]))
  for (const [name,width,length] of matrixOnly ? [] : [['normal',3,12],['wide',128,12],['long',2,6400]]) for (let sample=0;sample<7;sample++) {
    const prior = await metrics()
    const first = await page.evaluate(async ({name,width,length}) => {
      const e=window.__qaStores.editorStore, q=window.__qaStores.queryResultStore
      e.setState({tabs:[],activeTabId:null}); q.getState().clearResult('perf')
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
      const rows=Array.from({length:1000},(_,r)=>Array.from({length:width},(_,c)=>c ? `${r}:${c} `+'x'.repeat(length):r))
      const columns=Array.from({length:width},(_,c)=>({name:`column_${c}`,dataType:c?'TEXT':'INTEGER',nullable:false}))
      const start=performance.now()
      q.getState().setResults('perf',[{columns,rows,rowCount:1000,elapsedMs:0,affectedRows:0,truncated:false}])
      e.setState({activeTabId:'perf',tabs:[{id:'perf',kind:'data',title:name,sql:'',connectionId:null,lastQueryId:'perf',dataContext:{schema:'main',object:name,objectKind:'table',driverType:'sqlite',limit:1000,offset:0,primaryKeyColumns:[]}}]})
      while (!document.querySelector('.data-grid-cell')) {
        if (performance.now() - start > 5000) throw Error('No first result cell within 5 seconds')
        await new Promise(requestAnimationFrame)
      }
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
      return {firstFrameMs:performance.now()-start,retainedRows:q.getState().results.perf[0].rows.length,domCells:document.querySelectorAll('.data-grid-cell').length,domColumns:document.querySelectorAll('.data-grid-column').length}
    },{name,width,length})
    const after = await metrics()
    const scroll = await page.locator('.data-grid-shell .overflow-auto').first().evaluate(async el=>{
      const start=performance.now();el.scrollTop=15000;el.scrollLeft=8000
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()-start
    })
    const switchMs = await page.evaluate(async()=>{
      const e=window.__qaStores.editorStore,tab=e.getState().tabs[0],start=performance.now()
      e.setState({tabs:[tab,{...tab,id:'other'}],activeTabId:'other'})
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()-start
    })
    measurements.push({name,sample,inputRows:1000,columns:width,...first,scrollMs:scroll,switchMs,cpuMs:Object.fromEntries(Object.entries(after).map(([k,v])=>[k,v-prior[k]]))})
  }
  if (!before && !matrixOnly) {
    await page.evaluate(async()=>{
      const e=window.__qaStores.editorStore,q=window.__qaStores.queryResultStore
      q.getState().setResults('semantic',[{columns:Array.from({length:128},(_,c)=>({name:`field_${c}`,dataType:'TEXT',nullable:false})),rows:Array.from({length:100},(_,r)=>Array.from({length:128},(_,c)=>`r${r}c${c}`)),rowCount:100,elapsedMs:0,affectedRows:0,truncated:false}])
      e.setState({activeTabId:'semantic',tabs:[{id:'semantic',kind:'data',title:'Wide semantics',sql:'',connectionId:null,lastQueryId:'semantic',dataContext:{schema:'main',object:'wide',objectKind:'table',driverType:'sqlite',limit:100,offset:0,primaryKeyColumns:[]}}]})
    })
    const cell=page.locator('.data-grid-cell button').filter({hasText:/^r0c0$/}).first()
    await cell.click(); await page.keyboard.press('Shift+End'); await frames(page)
    await page.getByRole('button',{name:'r0c127',exact:true}).waitFor()
    const handle=page.getByRole('separator',{name:'resize field_127, 128',exact:true})
    await handle.focus(); await page.keyboard.press('ArrowRight'); await frames(page)
    const width=await handle.locator('..').evaluate(el=>el.getBoundingClientRect().width)
    assert.ok(width>=88)
    await page.getByRole('checkbox',{name:copy.en.result.copyHeaders}).check()
    await page.getByRole('button',{name:'CSV',exact:true}).click()
    const copied=await page.evaluate(()=>window.__copied)
    assert.equal(copied.split('\n')[0].split(',').length,128)
    assert.equal(copied.split('\n')[1].split(',').length,128)
    assert.ok(copied.includes('r0c60'))
    await page.getByRole('status').filter({hasText:copy.en.result.copySucceeded}).waitFor()
    await page.getByRole('button',{name:'r0c127',exact:true}).click(); await page.keyboard.press('Control+End'); await frames(page)
    await page.getByRole('button',{name:'r99c127',exact:true}).waitFor()
    await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab')
    await page.screenshot({path:join(output,'wide-semantics.png')})
    semantics.push({keyboardCrossViewport:true,rangeCopyIncludesUnmountedColumns:128,headers:true,columnResizeWidth:width,retainedRows:100})
  }
} finally {
  await writeFile(join(output,'measurements.json'),JSON.stringify({build:'Vite production, React production; Chromium; mock IPC, no native/DB claim',source,geometry,measurements,semantics},null,2))
  await browser.close(); await server.httpServer.close()
}
