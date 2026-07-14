import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []

function assert(condition, message) {
  if (!condition) failures.push(message)
}

function read(path) {
  return readFileSync(resolve(root, path), 'utf8')
}

const model = read('src-tauri/src/models/query_result.rs')
assert(model.includes('pub result: Option<QueryResult>'), 'explain result must preserve tabular plans')
assert(model.includes('Table,'), 'explain format must support tables')

for (const path of ['src-tauri/src/drivers/mysql.rs', 'src-tauri/src/drivers/sqlite.rs', 'src-tauri/src/drivers/mssql.rs']) {
  const source = read(path)
  assert(source.includes('format: ExplainFormat::Table'), `${path} must return table-format plans`)
  assert(source.includes('result: Some(result)'), `${path} must preserve plan columns and rows`)
}

const mainPanel = read('src/components/layout/MainPanel.tsx')
assert(mainPanel.includes('<DataGrid result={activeExplain.result} />'), 'tabular plans must render in the result grid')
assert(mainPanel.includes('disabled={Boolean(activeExplain)'), 'plan mode must not export a stale query result')

const types = read('src/types/query.ts')
assert(types.includes("'text' | 'json' | 'table'"), 'frontend explain type must include tables')

if (failures.length > 0) {
  console.error('Explain result smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Explain result smoke passed.')
