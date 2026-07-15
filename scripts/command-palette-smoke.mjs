import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []

function assert(condition, message) {
  if (!condition) failures.push(message)
}

const palette = readFileSync(resolve(root, 'src/components/common/WorkspaceCommandPalette.tsx'), 'utf8')
for (const value of [
  "event.key.toLowerCase() === 'k'",
  'event.metaKey || event.ctrlKey',
  'CommandDialog',
  "kind: 'sql'",
  "openTab('dataSources')",
  "openTab('settings')",
  'requestQueryHistory',
  'setActiveConnection(connection.id)',
  "setTheme(theme === 'dark' ? 'light' : 'dark')",
]) {
  assert(palette.includes(value), `command palette missing: ${value}`)
}

const app = readFileSync(resolve(root, 'src/App.tsx'), 'utf8')
assert(app.includes('<WorkspaceCommandPalette />'), 'command palette must be mounted globally')

const locales = ['src/locales/en.json', 'src/locales/zh.json']
for (const file of locales) {
  const source = readFileSync(resolve(root, file), 'utf8')
  assert(source.includes('"commandPalette"'), `${file} must localize the command palette`)
}

const packageJson = readFileSync(resolve(root, 'package.json'), 'utf8')
assert(packageJson.includes('test:command-palette'), 'command palette smoke script must be registered')

if (failures.length) {
  console.error('Command palette smoke failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('Command palette smoke passed.')
