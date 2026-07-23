import { invokeCommand } from '@/ipc/client'
import { COMMANDS } from '@/ipc/contracts'
import type { ConnectionConfig, ConnectionInput, ConnectionStatus, DataSourceGroup } from '@/types/connection'

export function createConnection(input: ConnectionInput) {
  return invokeCommand<ConnectionConfig>(COMMANDS.createConnection, { input })
}

export function updateConnection(input: ConnectionInput) {
  return invokeCommand<ConnectionConfig>(COMMANDS.updateConnection, { input })
}

export function deleteConnection(id: string) {
  return invokeCommand<void>(COMMANDS.deleteConnection, { id })
}

export function listConnections() {
  return invokeCommand<ConnectionConfig[]>(COMMANDS.listConnections)
}

export function testConnection(input: ConnectionInput) {
  return invokeCommand<void>(COMMANDS.testConnection, { input })
}

export function connect(id: string) {
  return invokeCommand<ConnectionStatus>(COMMANDS.connect, { id })
}

export function disconnect(id: string) {
  return invokeCommand<ConnectionStatus>(COMMANDS.disconnect, { id })
}

export function listConnectionStatuses() {
  return invokeCommand<ConnectionStatus[]>(COMMANDS.listConnectionStatuses)
}

export function setConnectionSessionPolicy(input: { maxLiveSessions: number; idleReclaimMinutes: number | null }) {
  return invokeCommand<void>(COMMANDS.setConnectionSessionPolicy, { input })
}

export function listDataSourceGroups() {
  return invokeCommand<DataSourceGroup[]>(COMMANDS.listDataSourceGroups)
}

export function createDataSourceGroup(name: string) {
  return invokeCommand<DataSourceGroup>(COMMANDS.createDataSourceGroup, { name })
}

export function renameDataSourceGroup(id: string, name: string) {
  return invokeCommand<DataSourceGroup>(COMMANDS.renameDataSourceGroup, { id, name })
}

export function deleteDataSourceGroup(id: string) {
  return invokeCommand<void>(COMMANDS.deleteDataSourceGroup, { id })
}

export function reorderDataSourceGroups(ids: string[]) {
  return invokeCommand<DataSourceGroup[]>(COMMANDS.reorderDataSourceGroups, { ids })
}

export function setConnectionDataSourceGroup(connectionId: string, groupId: string | null) {
  return invokeCommand<void>(COMMANDS.setConnectionDataSourceGroup, { connectionId, groupId })
}
