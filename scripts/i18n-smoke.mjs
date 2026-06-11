import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const zh = JSON.parse(readFileSync(resolve(root, 'src/locales/zh.json'), 'utf8'))
const en = JSON.parse(readFileSync(resolve(root, 'src/locales/en.json'), 'utf8'))

const zhKeys = flattenKeys(zh)
const enKeys = flattenKeys(en)
const missingInEn = [...zhKeys].filter((key) => !enKeys.has(key))
const missingInZh = [...enKeys].filter((key) => !zhKeys.has(key))

if (missingInEn.length || missingInZh.length) {
  console.error('Locale key mismatch.')
  if (missingInEn.length) console.error(`Missing in en: ${missingInEn.join(', ')}`)
  if (missingInZh.length) console.error(`Missing in zh: ${missingInZh.join(', ')}`)
  process.exit(1)
}

const requiredKeys = [
  'settings.language.label',
  'settings.language.zh',
  'settings.language.en',
  'nav.dataSources',
  'connection.new',
  'sql.workspace',
  'editor.run',
  'result.empty',
  'status.backendOk',
]

const missingRequired = requiredKeys.filter((key) => !zhKeys.has(key) || !enKeys.has(key))
if (missingRequired.length) {
  console.error(`Missing required i18n keys: ${missingRequired.join(', ')}`)
  process.exit(1)
}

const reviewFiles = [
  'src/App.tsx',
  'src/components/layout/Sidebar.tsx',
  'src/components/layout/StatusBar.tsx',
  'src/components/layout/TabBar.tsx',
  'src/components/connection/ConnectionList.tsx',
  'src/components/connection/ConnectionDialog.tsx',
  'src/components/editor/EditorToolbar.tsx',
  'src/components/grid/DataGrid.tsx',
]

const hardcoded = []
for (const file of reviewFiles) {
  const source = readFileSync(resolve(root, file), 'utf8')
  source.split(/\r?\n/).forEach((line, index) => {
    if (/[\p{Script=Han}]/u.test(line) && !line.includes('i18n-hardcoded-ok')) {
      hardcoded.push(`${relative(root, file)}:${index + 1}: ${line.trim()}`)
    }
  })
}

if (hardcoded.length) {
  console.warn('i18n hardcoded-string review items:')
  for (const item of hardcoded) console.warn(`- ${item}`)
}

console.log(`i18n smoke passed: ${zhKeys.size} locale keys, ${hardcoded.length} review items.`)

function flattenKeys(value, prefix = '', keys = new Set()) {
  for (const [key, nested] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      flattenKeys(nested, path, keys)
    } else {
      keys.add(path)
    }
  }
  return keys
}
