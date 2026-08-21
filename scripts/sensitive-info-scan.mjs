#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const listed = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: repositoryRoot },
)
  .toString()
  .split('\0')
  .filter(Boolean)

const skippedExtensions = new Set([
  '.icns', '.ico', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.woff', '.woff2',
])
const sensitiveLinePatterns = [
  /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/,
  new RegExp(['/Users/', '[^\\s"\']+', 'ojdbc[^\\s"\']*\\.jar'].join(''), 'i'),
  /\b(?:PASSWORD|PASSWD|PWD)\s*=\s*["']?(?:develop|password|root|admin|changeme)["']?(?:\s|$)/i,
]
const findings = []

function containsSensitiveInformation(line) {
  return sensitiveLinePatterns.some((pattern) => pattern.test(line))
}

for (const relativePath of listed) {
  if (/(^|\/)\.env(?:\.|$)/.test(relativePath) && !relativePath.endsWith('.env.example')) {
    findings.push(relativePath)
    continue
  }
  if (
    relativePath === 'scripts/sensitive-info-scan.mjs'
    || skippedExtensions.has(extname(relativePath).toLowerCase())
  ) {
    continue
  }
  const bytes = await readFile(resolve(repositoryRoot, relativePath))
  if (bytes.includes(0)) continue
  const lines = bytes.toString('utf8').split(/\r?\n/)
  for (const [index, line] of lines.entries()) {
    if (containsSensitiveInformation(line)) {
      findings.push(`${relativePath}:${index + 1}`)
    }
  }
}

if (findings.length > 0) {
  process.stderr.write(`Potential sensitive information found:\n${findings.join('\n')}\n`)
  process.exit(1)
}

process.stdout.write(`Sensitive-information scan passed (${listed.length} repository files checked).\n`)
