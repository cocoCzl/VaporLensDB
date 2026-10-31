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
assert(tabBar.includes('ide-tab-strip flex h-9'), 'tab strip must use the compact 36px workspace density')
assert(tabBar.includes('h-9 min-w-24 max-w-48 shrink-0'), 'workspace tabs must keep content-driven 96px to 192px sizing')
assert(tabBar.includes('border-r border-border/25'), 'workspace tabs must retain only a subtle separator')
assert(tabBar.includes('shadow-[inset_0_-2px_0_hsl(var(--primary))]'), 'active workspace tabs must use a single primary indicator')

const sidebar = readFileSync(resolve(root, 'src/components/layout/Sidebar.tsx'), 'utf8')
assert(sidebar.includes('ide-chrome relative flex shrink-0 border-r'), 'sidebar must share the IDE chrome surface')
assert(sidebar.includes('<DataSourcesSidebar />'), 'sidebar shell must delegate data-source rendering to its dedicated component')
assert(sidebar.includes('sidebarResizing'), 'sidebar resize handle must distinguish dragging from its resting state')
assert(sidebar.includes('hover:bg-border-strong/70'), 'sidebar resize hover must strengthen the neutral divider without using accent blue')
assert(sidebar.includes("? 'bg-primary/70'"), 'sidebar resize handle must reserve accent blue for active dragging')

const dataSourcesSidebar = readFileSync(resolve(root, 'src/components/sidebar/DataSourcesSidebar.tsx'), 'utf8')
const connectionRow = readFileSync(resolve(root, 'src/components/sidebar/ConnectionRow.tsx'), 'utf8')
assert(dataSourcesSidebar.includes('onClick={requestNewConnection}'), 'data-source header must request the shared new-connection action')
assert(dataSourcesSidebar.includes('<ConnectionGroup'), 'data-source list must use the dedicated group component')
assert(dataSourcesSidebar.includes('<ConnectionContextMenu'), 'data-source list must preserve connection context actions')
assert(connectionRow.includes('connectionEndpoint(connection)'), 'connection rows must expose endpoint secondary text')
assert(connectionRow.includes('<DatabaseVendorIcon'), 'connection rows must keep the vendor mark distinct from status')
assert(connectionRow.includes('connectionStatusDotClass(status)'), 'connection rows must render a semantic connection state dot')
assert(!dataSourcesSidebar.includes('<RecentSection'), 'recent connections must not duplicate the main sidebar tree')
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
assert(topBar.includes("openWorkspaceTab('settings')"), 'top bar Settings action must open the existing settings workspace')
const settings = readFileSync(resolve(root, 'src/components/settings/SettingsWorkspacePanel.tsx'), 'utf8')
assert(settings.includes('data-settings-workspace') && settings.includes('h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden'), 'settings outer shell must constrain scrolling')
assert(settings.includes('data-settings-nav') && settings.includes('overflow-y-auto overscroll-contain border-r'), 'settings navigation must scroll independently')
assert(settings.includes('data-settings-content') && settings.includes('overflow-x-hidden overflow-y-auto'), 'settings content must own vertical scrolling')
assert(settings.includes("t('settings.sections')"), 'narrow settings must expose an accessible section selector')
assert(topBar.includes("openWorkspaceTab('drivers')") && topBar.includes('min-[1200px]:inline'), 'global driver entry must adapt labels to narrow windows')
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
