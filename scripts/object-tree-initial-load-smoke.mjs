import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []

function assert(condition, message) {
  if (!condition) failures.push(message)
}

const databaseTree = readFileSync(resolve(root, 'src/components/explorer/DatabaseTree.tsx'), 'utf8')
assert(
  databaseTree.includes("connection?.driverType === 'mysql' && configured ? { name: configured } : null"),
  'MySQL must expose its configured database while metadata enumeration is empty',
)
assert(
  databaseTree.includes('parentId: ROOT_ID') && databaseTree.includes('depth: 0'),
  'initial databases must be direct root nodes rather than a generic wrapper folder',
)
assert(
  databaseTree.includes("kind: 'database'") && databaseTree.includes('childrenLoaded: true') &&
    databaseTree.includes('parentId: id') && databaseTree.includes('depth: 1'),
  'prebuilt database and schema children must survive collapse and expansion without wrapper folders',
)

const connectionStore = readFileSync(resolve(root, 'src/stores/connectionStore.ts'), 'utf8')
const connectSuccess = connectionStore.slice(
  connectionStore.indexOf('const status = await connect(id)'),
  connectionStore.indexOf('} catch (error)', connectionStore.indexOf('const status = await connect(id)')),
)
assert(
  connectSuccess.indexOf('useMetadataStore.getState().clearConnection(id)') < connectSuccess.indexOf('statuses:'),
  'successful connections must clear stale metadata before publishing connected state',
)

const packageJson = readFileSync(resolve(root, 'package.json'), 'utf8')
assert(packageJson.includes('test:object-tree-initial-load'), 'initial tree-load smoke must be registered')

if (failures.length > 0) {
  console.error('Object tree initial-load smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Object tree initial-load smoke passed.')
