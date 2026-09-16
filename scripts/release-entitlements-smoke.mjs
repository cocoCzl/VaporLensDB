#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const entitlementPath = resolve('src-tauri/gen/apple/Entitlements.plist')
const buildScriptPath = resolve('src-tauri/build.rs')
const packagingScriptPath = resolve('build.sh')
const releaseBuildScriptPath = resolve('scripts/tauri-release-build.sh')
const entitlements = await readFile(entitlementPath, 'utf8')
const buildScript = await readFile(buildScriptPath, 'utf8')
const packagingScript = await readFile(packagingScriptPath, 'utf8')
const releaseBuildScript = await readFile(releaseBuildScriptPath, 'utf8')

const expectedEntries = new Map([
  ['com.apple.security.app-sandbox', '<false/>'],
])
const prohibitedEntries = [
  'com.apple.security.cs.allow-jit',
  'com.apple.security.cs.allow-unsigned-executable-memory',
  'com.apple.security.cs.disable-library-validation',
]

for (const [key, value] of expectedEntries) {
  const expression = new RegExp(`<key>${key}</key>\\s*${value}`)
  if (!expression.test(entitlements)) {
    throw new Error(`Missing expected macOS entitlement: ${key} = ${value}`)
  }
}

for (const key of prohibitedEntries) {
  if (entitlements.includes(`<key>${key}</key>`)) {
    throw new Error(`Release entitlement exception must stay removed: ${key}`)
  }
}

if (!buildScript.includes('cargo:rerun-if-changed=gen/apple/Entitlements.plist')) {
  throw new Error('macOS build script must rebuild when the entitlement plist changes')
}

for (const remapTarget of ['/vaporlensdb', '/cargo', '/rustup']) {
  if (!releaseBuildScript.includes('--remap-path-prefix=') || !releaseBuildScript.includes(remapTarget)) {
    throw new Error(`macOS release build must remap source paths to ${remapTarget}`)
  }
}

if (!packagingScript.includes('scripts/tauri-release-build.sh')) {
  throw new Error('macOS packaging must use the release build wrapper with source-path remapping')
}

process.stdout.write('Release entitlement policy smoke passed: only app-sandbox=false remains, plist changes invalidate the build, and release source paths are remapped.\n')
