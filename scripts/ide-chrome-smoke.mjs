import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []

function assert(condition, message) {
  if (!condition) failures.push(message)
}

const styles = readFileSync(resolve(root, 'src/styles/globals.css'), 'utf8')
assert(styles.includes('--chrome:'), 'IDE chrome requires dedicated light and dark surface tokens')
assert(styles.includes('.ide-chrome'), 'IDE chrome surface class is missing')
assert(styles.includes('.ide-tab-strip'), 'tab strip chrome class is missing')
assert(!styles.includes('box-shadow: inset 0 1px hsl(0 0% 100% / 0.58)'), 'dark IDE chrome must not use a fixed white top highlight')

const tabBar = readFileSync(resolve(root, 'src/components/layout/TabBar.tsx'), 'utf8')
assert(tabBar.includes('ide-tab-strip flex h-8'), 'tab strip must use compact 32px IDE density')

const sidebar = readFileSync(resolve(root, 'src/components/layout/Sidebar.tsx'), 'utf8')
assert(sidebar.includes('ide-chrome relative flex shrink-0 border-r'), 'sidebar must share the IDE chrome surface')
assert(sidebar.includes('ide-chrome shrink-0 border-b'), 'data source header must share the IDE chrome surface')
const compactDataSourceTree = sidebar.slice(
  sidebar.indexOf('function CompactDataSourceTree'),
  sidebar.indexOf('function DataSourcesSelectorPanel'),
)
const compactDataSourceHeader = compactDataSourceTree.slice(
  compactDataSourceTree.indexOf('<section className="ide-chrome shrink-0 border-b"'),
  compactDataSourceTree.indexOf('<div className="min-h-0 flex-1'),
)
assert(!compactDataSourceTree.includes('<ConnectionDialog\n          trigger'), 'sidebar must not duplicate the global new-connection action')
assert(compactDataSourceTree.includes("t('connection.reloadSaved')"), 'sidebar refresh must describe reloading saved connections')
assert(!compactDataSourceHeader.includes('uppercase tracking-[0.08em]'), 'sidebar header must not repeat the Data Sources title')

const toolbar = readFileSync(resolve(root, 'src/components/layout/GlobalToolbar.tsx'), 'utf8')
assert(toolbar.includes("t('explorer.refreshObjects')"), 'global refresh must describe refreshing the current object tree')

const packageJson = readFileSync(resolve(root, 'package.json'), 'utf8')
assert(packageJson.includes('test:ide-chrome'), 'IDE chrome smoke script must be registered')

if (failures.length) {
  console.error('IDE chrome smoke failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('IDE chrome smoke passed.')
