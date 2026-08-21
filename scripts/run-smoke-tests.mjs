#!/usr/bin/env node

import { readFile, readdir } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDir, '..')
const packageJson = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'))
const declaredSmokeFiles = new Set(
  Object.values(packageJson.scripts).flatMap((command) => {
    const match = /^node scripts\/([\w-]+-smoke\.mjs)$/.exec(command)
    return match ? [match[1]] : []
  }),
)
const smokeFiles = (await readdir(scriptDir))
  .filter((name) => name.endsWith('-smoke.mjs'))
  .filter((name) => name !== 'performance-guardrails-smoke.mjs')
  .sort()

const undeclared = smokeFiles.filter((name) => !declaredSmokeFiles.has(name))
if (undeclared.length > 0) {
  throw new Error(`Smoke tests missing package.json scripts: ${undeclared.join(', ')}`)
}

for (const [index, name] of smokeFiles.entries()) {
  process.stdout.write(`[${index + 1}/${smokeFiles.length}] ${basename(name, '.mjs')}\n`)
  const result = spawnSync(process.execPath, [join(scriptDir, name)], {
    cwd: repositoryRoot,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1
    break
  }
}

if (process.exitCode === undefined) {
  process.stdout.write(`All ${smokeFiles.length} workflow smoke tests passed.\n`)
}
