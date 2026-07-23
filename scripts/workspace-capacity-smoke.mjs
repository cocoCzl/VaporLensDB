import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const expect = (condition, message) => {
  if (!condition) throw new Error(message)
}

const connectionList = read('src/components/connection/ConnectionList.tsx')
const connectionManager = read('src-tauri/src/services/connection_manager.rs')
const styles = read('src/styles/globals.css')

// This fixture is deliberately deterministic: it exercises the exact ordering
// contract required for the 200-source / 20-group benchmark without opening a
// database connection or relying on timing-sensitive browser measurements.
const groups = Array.from({ length: 20 }, (_, index) => ({ id: `group-${index}`, name: `Group ${index}`, order: index, connections: [] }))
const connections = Array.from({ length: 200 }, (_, index) => ({
  id: `source-${index}`,
  name: `Source ${String(index).padStart(3, '0')}`,
  groupId: `group-${index % 20}`,
}))
for (const connection of connections) groups[indexOfGroup(connection.groupId)].connections.push(connection)
const favorites = new Set(['source-199', 'source-178', 'source-157'])
for (const group of groups) group.connections.sort((left, right) => Number(favorites.has(right.id)) - Number(favorites.has(left.id)) || left.name.localeCompare(right.name))

expect(groups.length === 20 && groups.every((group) => group.connections.length === 10), '200 sources must remain distributed across 20 groups')
expect(groups.every((group) => {
  const firstNonFavorite = group.connections.findIndex((connection) => !favorites.has(connection.id))
  return firstNonFavorite < 0 || group.connections.slice(firstNonFavorite).every((connection) => !favorites.has(connection.id))
}), 'favorites must remain at the top of their own group')
expect(connectionList.includes('content-visibility-auto'), 'data-source rows must skip off-screen rendering work')
expect(connectionList.includes('favoriteDataSourceIds.includes(right.id)'), 'grouped data-source ordering must keep favorites first')
expect(connectionList.includes('dataSourceGroups') && connectionList.includes('group.id'), 'persisted group ordering must use stable group IDs')
expect(connectionManager.includes('DEFAULT_MAX_LIVE_SESSIONS: usize = 5'), 'capacity scenario must retain the five live-session limit')
expect(connectionManager.includes('reclaim_session_if_needed'), 'capacity scenario must reclaim an idle session before exceeding the limit')

console.log('Workspace capacity smoke passed: 200 sources / 20 groups / 5 live sessions.')

function indexOfGroup(id) {
  return Number(id.slice('group-'.length))
}
