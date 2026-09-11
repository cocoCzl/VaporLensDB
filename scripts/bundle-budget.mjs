import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = resolve(import.meta.dirname, '..')
const outputDir = resolve(root, 'dist')
const manifestPath = resolve(root, 'dist/.vite/manifest.json')

// The former 430,080-byte limit measured every emitted JS file as one blocking
// "application" budget. Since Settings, ER Diagram, sql-formatter, and the SQL
// editor are intentionally loaded through dynamic boundaries, Phase 11's
// audited release policy now protects startup reachability and individual lazy
// feature growth separately. Total JS remains visible as an informational
// release metric.
const AUDITED_BASELINE = {
  startupApplicationJsGzip: 281_230,
  largestLazyChunkGzip: 74_022,
}
const REGRESSION_MARGIN = 0.05
export const HARD_LIMITS = {
  startupApplicationJsGzip: Math.ceil(AUDITED_BASELINE.startupApplicationJsGzip * (1 + REGRESSION_MARGIN)),
  largestLazyChunkGzip: Math.ceil(AUDITED_BASELINE.largestLazyChunkGzip * (1 + REGRESSION_MARGIN)),
}

function isJavaScriptChunk(record) {
  return typeof record?.file === 'string' && record.file.endsWith('.js')
}

function requiredChunk(manifest, key) {
  const chunk = manifest[key]
  if (!isJavaScriptChunk(chunk)) {
    throw new Error(`Bundle manifest references a missing JavaScript chunk: ${key}`)
  }
  return chunk
}

function visitStaticImports(manifest, key, visited) {
  if (visited.has(key)) return
  const chunk = requiredChunk(manifest, key)
  visited.add(key)
  for (const dependency of chunk.imports ?? []) {
    visitStaticImports(manifest, dependency, visited)
  }
}

/**
 * Classify Vite output using manifest edges, never hash/file-name conventions.
 * A dynamic chunk can statically import startup code; that shared code remains
 * startup rather than being double-counted as lazy.
 */
export function classifyApplicationChunks(manifest) {
  const jsEntries = Object.entries(manifest).filter(([, record]) => isJavaScriptChunk(record))
  const entryRoots = jsEntries
    .filter(([, record]) => record.isEntry)
    .map(([key]) => key)
  if (entryRoots.length === 0) {
    throw new Error('Bundle manifest has no JavaScript entry chunk')
  }

  const startup = new Set()
  for (const key of entryRoots) visitStaticImports(manifest, key, startup)

  const lazyRoots = new Set(
    jsEntries
      .filter(([, record]) => record.isDynamicEntry)
      .map(([key]) => key),
  )
  for (const [, record] of jsEntries) {
    for (const dynamicImport of record.dynamicImports ?? []) {
      lazyRoots.add(dynamicImport)
    }
  }

  const lazyReachable = new Set()
  for (const key of lazyRoots) visitStaticImports(manifest, key, lazyReachable)
  const lazy = new Set([...lazyReachable].filter((key) => !startup.has(key)))
  const all = new Set(jsEntries.map(([key]) => key))
  const unclassified = [...all].filter((key) => !startup.has(key) && !lazy.has(key))
  if (unclassified.length > 0) {
    throw new Error(`Bundle manifest has unclassified JavaScript chunks: ${unclassified.join(', ')}`)
  }

  return { startup, lazy, all }
}

export function measureApplicationChunks(manifest, readFile = readFileSync, gzipSize = (bytes) => gzipSync(bytes).length) {
  const classification = classifyApplicationChunks(manifest)
  const chunks = [...classification.all].map((key) => {
    const chunk = requiredChunk(manifest, key)
    const gzip = gzipSize(readFile(resolve(outputDir, chunk.file)))
    return {
      key,
      file: chunk.file,
      gzip,
      category: classification.startup.has(key) ? 'startup' : 'lazy',
    }
  })
  const startupApplicationJsGzip = chunks
    .filter((chunk) => chunk.category === 'startup')
    .reduce((total, chunk) => total + chunk.gzip, 0)
  const lazyChunks = chunks.filter((chunk) => chunk.category === 'lazy')
  const largestLazyChunk = lazyChunks.reduce(
    (largest, chunk) => (!largest || chunk.gzip > largest.gzip ? chunk : largest),
    null,
  )

  return {
    startupApplicationJsGzip,
    largestLazyChunkGzip: largestLazyChunk?.gzip ?? 0,
    largestLazyChunk: largestLazyChunk?.file ?? null,
    totalApplicationJsGzip: chunks.reduce((total, chunk) => total + chunk.gzip, 0),
    chunks: chunks.sort((left, right) => right.gzip - left.gzip),
  }
}

export function evaluateBudget(metrics, limits = HARD_LIMITS) {
  const failures = []
  if (metrics.startupApplicationJsGzip > limits.startupApplicationJsGzip) {
    failures.push(`startupApplicationJsGzip: ${metrics.startupApplicationJsGzip} > ${limits.startupApplicationJsGzip}`)
  }
  if (metrics.largestLazyChunkGzip > limits.largestLazyChunkGzip) {
    failures.push(`largestLazyChunkGzip: ${metrics.largestLazyChunkGzip} > ${limits.largestLazyChunkGzip}`)
  }
  return failures
}

function formatBytes(value) {
  return `${value} bytes`
}

export function formatBudgetReport(metrics, limits = HARD_LIMITS) {
  const chunkBreakdown = metrics.chunks
    .map((chunk) => `  ${chunk.category.padEnd(7)} ${formatBytes(chunk.gzip).padStart(12)}  ${chunk.file}`)
    .join('\n')
  return [
    `Startup application JS: ${formatBytes(metrics.startupApplicationJsGzip)} / ${formatBytes(limits.startupApplicationJsGzip)} budget`,
    `Largest lazy chunk: ${formatBytes(metrics.largestLazyChunkGzip)} / ${formatBytes(limits.largestLazyChunkGzip)} budget`,
    `chunk: ${metrics.largestLazyChunk ?? 'none'}`,
    `Total application JS: ${formatBytes(metrics.totalApplicationJsGzip)} informational`,
    'Chunk breakdown:',
    chunkBreakdown,
  ].join('\n')
}

function main() {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`Unable to read Vite bundle manifest at ${manifestPath}. Run pnpm build first.`, { cause: error })
  }
  const metrics = measureApplicationChunks(manifest)
  const failures = evaluateBudget(metrics)
  const report = formatBudgetReport(metrics)
  if (failures.length > 0) {
    process.stderr.write(`Bundle budget exceeded:\n${failures.map((failure) => `- ${failure}`).join('\n')}\n${report}\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write(`${report}\nBundle budget passed.\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
