import { readdirSync, readFileSync, statSync } from 'node:fs'
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
  'sql.recentScripts',
  'sql.recentDrafts',
  'sql.clearRecentScripts',
  'sql.lastEditedScript',
  'workbench.emptyEditorHint',
  'editor.run',
  'result.empty',
  'status.backendOk',
]

const missingRequired = requiredKeys.filter((key) => !zhKeys.has(key) || !enKeys.has(key))
if (missingRequired.length) {
  console.error(`Missing required i18n keys: ${missingRequired.join(', ')}`)
  process.exit(1)
}

const placeholderMismatches = []
for (const key of zhKeys) {
  const zhPlaceholders = placeholders(valueAtPath(zh, key))
  const enPlaceholders = placeholders(valueAtPath(en, key))
  if (!sameValues(zhPlaceholders, enPlaceholders)) {
    placeholderMismatches.push(`${key}: zh=${[...zhPlaceholders].join(',') || '(none)'} en=${[...enPlaceholders].join(',') || '(none)'}`)
  }
}

if (placeholderMismatches.length) {
  console.error('Locale interpolation placeholder mismatch.')
  for (const item of placeholderMismatches) console.error(`- ${item}`)
  process.exit(1)
}

const invalidTranslations = []
for (const [language, locale] of [['zh', zh], ['en', en]]) {
  for (const [key, value] of flattenEntries(locale)) {
    if (typeof value !== 'string' || !value.trim() || value.trim() === key) {
      invalidTranslations.push(`${language}.${key}`)
    }
  }
}

if (invalidTranslations.length) {
  console.error('Empty or unresolved locale values found.')
  for (const item of invalidTranslations) console.error(`- ${item}`)
  process.exit(1)
}

const reviewFiles = walk(resolve(root, 'src')).filter((file) => {
  const normalized = relative(root, file)
  return (
    /\.(ts|tsx)$/.test(normalized) &&
    !normalized.startsWith('src/locales/') &&
    !normalized.endsWith('.d.ts')
  )
})

const hardcoded = []
for (const file of reviewFiles) {
  const source = readFileSync(file, 'utf8')
  source.split(/\r?\n/).forEach((line, index) => {
    if (/[\p{Script=Han}]/u.test(line) && !line.includes('i18n-hardcoded-ok')) {
      hardcoded.push(`${relative(root, file)}:${index + 1}: ${line.trim()}`)
    }
  })
}

if (hardcoded.length) {
  console.error('Hardcoded user-facing Han characters found. Use locale keys or mark non-UI parsing rules with i18n-hardcoded-ok:')
  for (const item of hardcoded) console.error(`- ${item}`)
  process.exit(1)
}

console.log(`i18n smoke passed: ${zhKeys.size} locale keys, ${reviewFiles.length} source files scanned.`)

function flattenEntries(value, prefix = '', entries = []) {
  for (const [key, nested] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      flattenEntries(nested, path, entries)
    } else {
      entries.push([path, nested])
    }
  }
  return entries
}

function valueAtPath(value, path) {
  return path.split('.').reduce((current, key) => current?.[key], value)
}

function placeholders(value) {
  if (typeof value !== 'string') return new Set()
  return new Set([...value.matchAll(/{{\s*-?\s*([\w]+)\s*}}/g)].map((match) => match[1]))
}

function sameValues(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value))
}

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

function walk(directory) {
  const entries = readdirSync(directory)
  const files = []
  for (const entry of entries) {
    const path = resolve(directory, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      files.push(...walk(path))
    } else {
      files.push(path)
    }
  }
  return files
}
