import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUDITED_BASELINE,
  classifyApplicationChunks,
  evaluateBudget,
  HARD_LIMITS,
  measureApplicationChunks,
  REGRESSION_MARGIN,
} from './bundle-budget.mjs'

const manifest = {
  'index.html': {
    file: 'assets/entry.js',
    isEntry: true,
    imports: ['assets/shared.js'],
    dynamicImports: ['src/features/diagram.ts'],
  },
  'assets/shared.js': {
    file: 'assets/shared.js',
    imports: ['assets/runtime.js'],
  },
  'assets/runtime.js': {
    file: 'assets/runtime.js',
  },
  'src/features/diagram.ts': {
    file: 'assets/diagram.js',
    isDynamicEntry: true,
    imports: ['assets/diagram-support.js', 'assets/shared.js'],
    dynamicImports: ['src/features/nested.ts'],
  },
  'assets/diagram-support.js': {
    file: 'assets/diagram-support.js',
  },
  'src/features/nested.ts': {
    file: 'assets/nested.js',
    isDynamicEntry: true,
  },
}

const sizes = new Map([
  ['assets/entry.js', 100],
  ['assets/shared.js', 40],
  ['assets/runtime.js', 10],
  ['assets/diagram.js', 70],
  ['assets/diagram-support.js', 20],
  ['assets/nested.js', 30],
])

function metricsForFixture() {
  return measureApplicationChunks(
    manifest,
    (file) => file,
    (file) => sizes.get(file.replace(/^.*assets\//, 'assets/')),
  )
}

test('classifies static imports recursively as startup', () => {
  const { startup } = classifyApplicationChunks(manifest)
  assert.deepEqual([...startup].sort(), ['assets/runtime.js', 'assets/shared.js', 'index.html'])
})

test('classifies dynamic boundaries and their static dependencies as lazy', () => {
  const { lazy } = classifyApplicationChunks(manifest)
  assert.deepEqual(
    [...lazy].sort(),
    ['assets/diagram-support.js', 'src/features/diagram.ts', 'src/features/nested.ts'],
  )
})

test('does not count lazy chunks in startup but includes them in total', () => {
  const metrics = metricsForFixture()
  assert.equal(metrics.startupApplicationJsGzip, 150)
  assert.equal(metrics.largestLazyChunkGzip, 70)
  assert.equal(metrics.largestLazyChunk, 'assets/diagram.js')
  assert.equal(metrics.totalApplicationJsGzip, 270)
})

test('fails an over-budget startup path', () => {
  const metrics = metricsForFixture()
  assert.deepEqual(
    evaluateBudget(metrics, { startupApplicationJsGzip: 149, largestLazyChunkGzip: 70 }),
    ['startupApplicationJsGzip: 150 > 149'],
  )
})

test('fails an over-budget largest lazy chunk', () => {
  const metrics = metricsForFixture()
  assert.deepEqual(
    evaluateBudget(metrics, { startupApplicationJsGzip: 150, largestLazyChunkGzip: 69 }),
    ['largestLazyChunkGzip: 70 > 69'],
  )
})

test('keeps total application JS informational', () => {
  const metrics = metricsForFixture()
  assert.deepEqual(
    evaluateBudget(metrics, { startupApplicationJsGzip: 150, largestLazyChunkGzip: 70 }),
    [],
  )
})

test('reviewed baseline and small growth pass the default five-percent policy', () => {
  assert.equal(REGRESSION_MARGIN, 0.05)
  for (const growth of [0, 0.01, 0.04]) {
    assert.deepEqual(evaluateBudget({
      startupApplicationJsGzip: Math.ceil(AUDITED_BASELINE.startupApplicationJsGzip * (1 + growth)),
      largestLazyChunkGzip: AUDITED_BASELINE.largestLazyChunkGzip,
      totalApplicationJsGzip: 10_000_000,
    }), [])
  }
})

test('six-percent startup growth still fails the default policy', () => {
  const startupApplicationJsGzip = Math.ceil(AUDITED_BASELINE.startupApplicationJsGzip * 1.06)
  assert.deepEqual(evaluateBudget({
    startupApplicationJsGzip,
    largestLazyChunkGzip: AUDITED_BASELINE.largestLazyChunkGzip,
  }), [`startupApplicationJsGzip: ${startupApplicationJsGzip} > ${HARD_LIMITS.startupApplicationJsGzip}`])
})

test('rounded startup limit is inclusive, but one byte above it fails', () => {
  const limit = Math.ceil(AUDITED_BASELINE.startupApplicationJsGzip * (1 + REGRESSION_MARGIN))
  const metrics = { startupApplicationJsGzip: limit, largestLazyChunkGzip: 0 }
  assert.deepEqual(evaluateBudget(metrics), [])
  assert.deepEqual(evaluateBudget({ ...metrics, startupApplicationJsGzip: limit + 1 }), [
    `startupApplicationJsGzip: ${limit + 1} > ${limit}`,
  ])
})

test('startup rebaseline preserves the independent lazy limit', () => {
  assert.equal(AUDITED_BASELINE.largestLazyChunkGzip, 74_022)
  assert.equal(HARD_LIMITS.largestLazyChunkGzip, 77_724)
  assert.deepEqual(evaluateBudget({
    startupApplicationJsGzip: AUDITED_BASELINE.startupApplicationJsGzip,
    largestLazyChunkGzip: 77_725,
  }), ['largestLazyChunkGzip: 77725 > 77724'])
})
