import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const failures = []
const assert = (condition, message) => {
  if (!condition) failures.push(message)
}

const engine = read('src-tauri/src/services/query_engine.rs')
assert(engine.includes('pub const MAX_INTERACTIVE_RESULT_ROWS: u64 = 50_000'), 'interactive result hard limit is missing')
assert(engine.includes('pub const MAX_INTERACTIVE_CELL_BYTES: usize = 1024 * 1024'), 'interactive cell byte limit is missing')
assert(engine.includes('pub const MAX_INTERACTIVE_RESULT_BYTES: usize = 64 * 1024 * 1024'), 'interactive batch byte limit is missing')
assert(engine.includes('pub const MAX_INTERACTIVE_STREAM_CHUNK_BYTES: usize = 4 * 1024 * 1024'), 'interactive stream chunk byte limit is missing')
assert(engine.includes('remaining_bytes = remaining_bytes.saturating_sub(retained_bytes)'), 'batch byte budget is not shared across statements')
assert(engine.includes('const MAX_STREAM_CHUNK_SIZE: usize = 2_000'), 'stream chunk hard limit is missing')
assert(engine.includes('mpsc::channel::<Result<QueryResultChunk, AppError>>(8)'), 'stream backpressure channel budget is missing')

const resultStore = read('src/stores/queryResultStore.ts')
assert(resultStore.includes('const MAX_RENDERED_RESULT_ROWS = 10_000'), 'grid memory window is missing')
assert(resultStore.includes('const MAX_RETAINED_QUERY_RESULTS = 20'), 'query result retention budget is missing')
assert(resultStore.includes('displayTruncated'), 'grid must distinguish retained-window truncation')
assert(!resultStore.includes('rows: [...current.rows, ...chunk.rows]'), 'stream append must not copy every prior row')

const app = read('src/App.tsx')
assert(app.includes('subscribeSqlWorkspacePersistence()'), 'workspace persistence must use a non-rendering store subscription')
assert(!app.includes('useEditorStore((state) => state.tabs)'), 'application root must not subscribe to the complete editor tab collection')

const metadata = read('src-tauri/src/services/metadata_service.rs')
assert(metadata.includes('const MAX_METADATA_CACHE_ENTRIES: usize = 256'), 'metadata cache entry budget is missing')
const metadataIndex = read('src-tauri/src/services/metadata_index.rs')
assert(metadataIndex.includes('const MAX_METADATA_INDEX_ENTRIES_TOTAL: usize = 150_000'), 'metadata index global budget is missing')

const jdbc = read('src-tauri/src/drivers/jdbc.rs')
assert(jdbc.includes('async fn cancel_stream'), 'JDBC stream cancellation is missing')
assert(jdbc.includes('CANCEL\\t0\\t{}'), 'JDBC cancellation command is missing')
assert(jdbc.includes('VAPORLENSDB_JDBC_MAX_HEAP_MB'), 'JDBC heap budget is missing')
assert(jdbc.includes('"maxCellBytes": MAX_INTERACTIVE_CELL_BYTES'), 'JDBC cell budget is not sent to the bridge')
assert(jdbc.includes('"maxChunkBytes": MAX_INTERACTIVE_SOURCE_CHUNK_BYTES'), 'JDBC chunk budget is not sent to the bridge')

const jdbcBridge = read('tools/jdbc-bridge/src/com/vaporlensdb/jdbcbridge/JdbcBridge.java')
assert(jdbcBridge.includes('appendBoundedJsonValue'), 'JDBC bridge cell budget is missing')
assert(jdbcBridge.includes('StreamChunkBuffer'), 'JDBC bridge source chunk budget is missing')

for (const driver of ['postgres', 'mysql', 'mssql', 'sqlite']) {
  const source = read(`src-tauri/src/drivers/${driver}.rs`)
  assert(source.includes('QueryChunkBuffer'), `${driver} source stream byte budget is missing`)
}

if (failures.length > 0) {
  console.error('Performance guardrail smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Performance guardrails passed: bounded result, stream, cache, and cancellation budgets.')
