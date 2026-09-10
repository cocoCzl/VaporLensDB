import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []

function assert(condition, message) {
  if (!condition) failures.push(message)
}

const styles = readFileSync(resolve(root, 'src/styles/globals.css'), 'utf8')
assert(styles.includes('--chrome:'), 'IDE chrome requires dedicated light and dark surface tokens')
assert(styles.includes('--panel:'), 'IDE panel surfaces require a semantic panel token')
assert(styles.includes('--separator:'), 'IDE chrome requires a dedicated separator token')
assert(styles.includes('.ide-chrome'), 'IDE chrome surface class is missing')
assert(styles.includes('.ide-tab-strip'), 'tab strip chrome class is missing')
assert(styles.includes('.ide-splitter'), 'result panel needs a lightweight IDE splitter')
assert(!styles.includes('box-shadow: inset 0 1px hsl(0 0% 100% / 0.58)'), 'dark IDE chrome must not use a fixed white top highlight')

const tabBar = readFileSync(resolve(root, 'src/components/layout/TabBar.tsx'), 'utf8')
assert(tabBar.includes('ide-tab-strip flex h-9'), 'tab strip must use the refined 36px workspace density')

const sidebar = readFileSync(resolve(root, 'src/components/layout/Sidebar.tsx'), 'utf8')
assert(sidebar.includes('ide-chrome relative flex shrink-0 border-r'), 'sidebar must share the IDE chrome surface')
assert(sidebar.includes('<DataSourcesSidebar />'), 'sidebar shell must delegate data-source rendering to its dedicated component')
assert(sidebar.includes('sidebarResizing'), 'sidebar resize handle must distinguish dragging from its resting state')
assert(sidebar.includes('hover:bg-border-strong/70'), 'sidebar resize hover must strengthen the neutral divider without using accent blue')
assert(sidebar.includes("? 'bg-primary/70'"), 'sidebar resize handle must reserve accent blue for active dragging')

const dataSourcesSidebar = readFileSync(resolve(root, 'src/components/sidebar/DataSourcesSidebar.tsx'), 'utf8')
const connectionRow = readFileSync(resolve(root, 'src/components/sidebar/ConnectionRow.tsx'), 'utf8')
const recentSection = readFileSync(resolve(root, 'src/components/sidebar/RecentSection.tsx'), 'utf8')
assert(dataSourcesSidebar.includes('<ConnectionDialog'), 'data-source header must own the new-connection action after global toolbar consolidation')
assert(dataSourcesSidebar.includes('<ConnectionGroup'), 'data-source list must use the dedicated group component')
assert(dataSourcesSidebar.includes('<ConnectionContextMenu'), 'data-source list must preserve connection context actions')
assert(connectionRow.includes('connectionEndpoint(connection)'), 'connection rows must expose endpoint secondary text')
assert(connectionRow.includes('<DatabaseVendorIcon'), 'connection rows must keep the vendor mark distinct from status')
assert(connectionRow.includes('connectionStatusDotClass(status)'), 'connection rows must render a semantic connection state dot')
assert(recentSection.includes("t('connection.recent')"), 'sidebar must surface the existing recent data-source state')
assert(!connectionRow.includes('emerald-') && !connectionRow.includes('amber-') && !connectionRow.includes('red-'), 'connection state colors must use semantic tokens')

const app = readFileSync(resolve(root, 'src/App.tsx'), 'utf8')
assert(!app.includes('GlobalToolbar'), 'workspace must not render a redundant global toolbar band')
assert(!app.includes('splash-background.png'), 'startup UI must not decode the legacy raster splash')
assert(app.includes('<AppTopBar />'), 'app shell must mount the dedicated global top bar')

const mainPanel = readFileSync(resolve(root, 'src/components/layout/MainPanel.tsx'), 'utf8')
const home = readFileSync(resolve(root, 'src/components/home/WorkbenchHome.tsx'), 'utf8')
assert(mainPanel.includes("import { WorkbenchHome }"), 'main panel must delegate its empty workspace to Welcome Workspace')
assert(home.includes('<HomeQuickActions'), 'welcome workspace must expose quick actions through its dedicated component')
assert(home.includes('<RecentConnections'), 'welcome workspace must render recent connections from existing state')
assert(home.includes('<RecentQueries'), 'welcome workspace must render recent query history')
assert(home.includes("new Event('vaporlensdb:open-command-palette')"), 'welcome workspace must reuse the shared command palette event')
assert(home.includes('<ConnectionDialog'), 'welcome workspace must reuse the existing controlled connection dialog')

const topBar = readFileSync(resolve(root, 'src/components/layout/AppTopBar.tsx'), 'utf8')
assert(topBar.includes("new Event('vaporlensdb:open-command-palette')"), 'top bar must trigger the shared command palette')
assert(topBar.includes('<ConnectionDialog'), 'top bar New menu must reuse the connection dialog')
assert(topBar.includes('setSidebarCollapsed'), 'top bar must expose the existing sidebar layout toggle')
assert(topBar.includes("kind: 'settings'"), 'top bar Settings action must open the existing settings workspace')
assert(!tabBar.includes("new Event('vaporlensdb:open-command-palette')"), 'tab strip must not own global command search')
assert(!tabBar.includes("kind: 'sql'"), 'tab strip must not create global SQL workspaces')

const packageJson = readFileSync(resolve(root, 'package.json'), 'utf8')
assert(packageJson.includes('test:ide-chrome'), 'IDE chrome smoke script must be registered')

if (failures.length) {
  console.error('IDE chrome smoke failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('IDE chrome smoke passed.')
