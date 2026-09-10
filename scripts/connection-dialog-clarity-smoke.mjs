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
includesAll(en, ['"supportStatus"', '"externalDriverRequirement"', '"connectionUrl"', '"urlCredentialsWarning"', '"urlCredentialsExtracted"', '"urlOnlySshUnsupported"'], 'English connection support locale')
includesAll(zh, ['"supportStatus"', '"externalDriverRequirement"', '"connectionUrl"', '"urlCredentialsWarning"', '"urlCredentialsExtracted"', '"urlOnlySshUnsupported"'], 'Chinese connection support locale')

const dialog = read('src/components/connection/ConnectionDialog.tsx')
includesAll(
  dialog,
  [
    'void loadDrivers()',
    "h-[min(50rem,calc(100vh-3rem))]",
    'max-w-[50rem]',
    'data-open:animate-none',
    'data-closed:animate-none',
    'min-h-0 flex-1 overflow-hidden',
  ],
  'connection dialog stable opening layout',
)
includesAll(form, ['overflow-y-auto overflow-x-hidden', '[scrollbar-gutter:stable]'], 'connection dialog single stable scroll region')
includesAll(form, ['DatabaseTypeSelector', 'DisclosureSection', "t('connectionForm.sshTunnelSection')", "t('connectionForm.sslSection')", "t('connectionForm.advanced')"], 'connection dialog progressive disclosure')
assert(!form.includes("t('connectionForm.projectDataSources')"), 'connection dialog should not render a project data sources sidebar')
includesAll(
  form,
  [
    'databaseTypeOptions',
    "driver.backend === 'nativeRust' && driver.status === 'ready'",
    'driverVariants.length > 1',
    'id="driver-profile"',
    "t('connectionForm.viewCapabilities')",
  ],
  'database type and driver profile progressive disclosure',
)
includesAll(
  form,
  [
    "const isUrlOnly = activeConnectionVariant === 'urlOnly'",
    "label={t('connectionForm.connectionUrl')}",
    "updateConnectionUrl(event.target.value)",
    "t('connectionForm.urlCredentialsWarning')",
    "username: variant === 'file' ? null : emptyToNull(input.username)",
    "password: variant === 'file' ? null : emptyToNull(input.password)",
    "savePassword: variant === 'file' ? false : input.savePassword",
    "sshTunnel: isUrlOnly || variant === 'file' ? null : normalizeSshTunnel(input)",
    "activeConnectionVariant === 'file'",
  ],
  'URL-only connection form behavior',
)
assert(!dialog.includes('if (open) {\n      loadDrivers()'), 'driver catalogue must not first load only after the dialog opens')

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
