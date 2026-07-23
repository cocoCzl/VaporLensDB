import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []

function read(path) {
  return readFileSync(resolve(root, path), 'utf8')
}

function assert(condition, message) {
  if (!condition) failures.push(message)
}

function includesAll(source, values, label) {
  for (const value of values) {
    assert(source.includes(value), `${label} missing: ${value}`)
  }
}

const appMenu = read('src-tauri/src/app_menu.rs')
includesAll(
  appMenu,
  [
    'set_application_menu',
    'AppMenuLanguage',
    'HELP_SUBMENU_ID',
    'with_id(app, HELP_SUBMENU_ID',
    'APP_WINDOW_SUBMENU_ID',
    'about_with_text(labels.help_about',
    'vaporlensdb-edit-menu',
    'vaporlensdb-window-menu',
    'MenuItem::with_id',
    'PredefinedMenuItem',
    'PredefinedMenuItem::copy',
    'PredefinedMenuItem::paste',
    'WINDOW_MINIMIZE_ID',
    'WINDOW_ZOOM_ID',
    'handle_menu_event',
    'get_webview_window("main")',
    'webview_windows',
    '文件',
    '编辑',
    '显示',
    '窗口',
    '帮助',
    'File',
    'Edit',
    'View',
    'Window',
    'Help',
    'close_window_with_text',
    'fullscreen_with_text',
  ],
  'native menu builder',
)

for (const prohibitedPattern of [
  'document.execCommand',
  'minimize_with_text',
  'maximize_with_text',
  'bring_all_to_front_with_text',
  'AutoFill',
  'Start Dictation',
  'Emoji & Symbols',
  'Move & Resize',
  'Full Screen Tile',
  'Remove Window from Set',
]) {
  assert(
    !appMenu.includes(prohibitedPattern),
    `native menu builder should not use macOS-injected menu path: ${prohibitedPattern}`,
  )
}

assert(
  !/\bWINDOW_SUBMENU_ID\b(?!\s*:)/.test(appMenu.replaceAll('APP_WINDOW_SUBMENU_ID', '')),
  'native menu builder should not import or use Tauri WINDOW_SUBMENU_ID',
)

const settingsCommand = read('src-tauri/src/commands/settings.rs')
includesAll(
  settingsCommand,
  ['set_application_menu_language', 'SetApplicationMenuLanguageInput', 'AppMenuLanguage::from_code'],
  'native menu command',
)

const lib = read('src-tauri/src/lib.rs')
includesAll(
  lib,
  [
    'app_menu::set_application_menu',
    'on_menu_event',
    'app_menu::handle_menu_event',
    'commands::settings::set_application_menu_language',
    'AppMenuLanguage::Zh',
  ],
  'native menu registration',
)

const app = read('src/App.tsx')
includesAll(
  app,
  [
    'setApplicationMenuLanguage',
    'normalizedApplicationMenuLanguage(i18n.language)',
  ],
  'startup native menu sync',
)

const settingsPanel = read('src/components/settings/SettingsWorkspacePanel.tsx')
includesAll(
  settingsPanel,
  ['setApplicationMenuLanguage', 'setApplicationMenuLanguage(draft.language)'],
  'settings native menu sync',
)

const contracts = read('src/shared/command-contracts.json')
includesAll(contracts, ['set_application_menu_language', 'SetApplicationMenuLanguageInput'], 'command contract')

const ipc = read('src/ipc/settings.ts')
includesAll(
  ipc,
  ['setApplicationMenuLanguage', 'normalizedApplicationMenuLanguage', 'COMMANDS.setApplicationMenuLanguage'],
  'settings IPC',
)

const packageJson = read('package.json')
includesAll(packageJson, ['test:native-menu', 'scripts/native-menu-smoke.mjs'], 'native menu smoke registration')

if (failures.length > 0) {
  console.error('Native menu smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Native menu smoke passed.')
