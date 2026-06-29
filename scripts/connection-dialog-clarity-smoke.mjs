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

const form = read('src/components/connection/ConnectionForm.tsx')
includesAll(
  form,
  [
    'DriverSupportSummary',
    'driverCapabilityBadges',
    "t('connectionForm.capability.metadata')",
    "t('connectionForm.capability.stream')",
    "t('connectionForm.capability.cancel')",
    'externalDriverMissingItems',
    "t('connectionForm.missing'",
    "t('connectionForm.externalDriverReady')",
    'profileCapabilities',
    'profileBackend',
  ],
  'connection dialog driver support summary',
)

includesAll(
  form,
  [
    'driverStatusLabel',
    'driverBackendLabel',
    'driverBackendLabel',
    "t('connectionForm.localDriverRequired')",
    "t('connectionForm.nativeDriverReady')",
  ],
  'connection dialog driver definition badges',
)

const en = read('src/locales/en.json')
const zh = read('src/locales/zh.json')
includesAll(en, ['"supportStatus"', '"externalDriverRequirement"'], 'English connection support locale')
includesAll(zh, ['"supportStatus"', '"externalDriverRequirement"'], 'Chinese connection support locale')

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:connection-dialog-clarity', 'scripts/connection-dialog-clarity-smoke.mjs'],
  'connection dialog clarity smoke registration',
)

if (failures.length > 0) {
  console.error('Connection dialog clarity smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Connection dialog clarity smoke passed.')
