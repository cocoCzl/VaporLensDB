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

const erDiagram = read('src/components/diagram/ERDiagram.tsx')
includesAll(
  erDiagram,
  [
    '导出 SVG',
    'buildDiagramSvg({',
    'downloadTextFile(',
    'image/svg+xml',
    '<svg xmlns="http://www.w3.org/2000/svg"',
    'marker id="arrow"',
    'column.isPrimaryKey',
    'Large diagram limited to first',
    'ER_DIAGRAM_EXPORT_UNAVAILABLE',
    'ER diagram 导出失败',
    'safeFileName',
    'escapeXml',
  ],
  'ER diagram SVG export',
)

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:er-diagram-export', 'scripts/er-diagram-export-smoke.mjs'],
  'ER diagram export smoke script registration',
)

if (failures.length > 0) {
  console.error('ER diagram export smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('ER diagram export smoke passed.')
