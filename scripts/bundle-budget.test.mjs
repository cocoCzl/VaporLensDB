import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyApplicationChunks,
  evaluateBudget,
  measureApplicationChunks,
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
