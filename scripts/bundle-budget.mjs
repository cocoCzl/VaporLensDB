import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const root = resolve(import.meta.dirname, '..')
const assetDir = resolve(root, 'dist/assets')
const jsFiles = readdirSync(assetDir).filter((name) => name.endsWith('.js'))
const gzipSizes = jsFiles.map((name) => gzipSync(readFileSync(resolve(assetDir, name))).length)
const totalGzip = gzipSizes.reduce((sum, size) => sum + size, 0)
const largestGzip = Math.max(0, ...gzipSizes)
const limits = {
  totalApplicationJsGzip: 550 * 1024,
  largestApplicationChunkGzip: 350 * 1024,
  favicon: 150 * 1024,
}
const actual = {
  totalApplicationJsGzip: totalGzip,
  largestApplicationChunkGzip: largestGzip,
  favicon: statSync(resolve(root, 'dist/favicon.png')).size,
}
const failures = Object.entries(limits)
  .filter(([name, limit]) => actual[name] > limit)
  .map(([name, limit]) => `${name}: ${actual[name]} > ${limit}`)

if (failures.length) {
  console.error(`Bundle budget exceeded:\n${failures.map((failure) => `- ${failure}`).join('\n')}`)
  process.exit(1)
}
console.log(`Bundle budget passed: ${jsFiles.length} chunks, ${Math.round(totalGzip / 1024)} KiB gzip total.`)
