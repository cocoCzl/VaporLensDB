import { invokeCommand } from '@/ipc/client'
import type { ConnectionConfig, ConnectionInput, ConnectionStatus } from '@/types/connection'

export function createConnection(input: ConnectionInput) {
  return invokeCommand<ConnectionConfig>('create_connection', { input })
}

export function updateConnection(input: ConnectionInput) {
  return invokeCommand<ConnectionConfig>('update_connection', { input })
}

export function deleteConnection(id: string) {
  return invokeCommand<void>('delete_connection', { id })
}

export function listConnections() {
  return invokeCommand<ConnectionConfig[]>('list_connections')
}

export function testConnection(input: ConnectionInput) {
  return invokeCommand<void>('test_connection', { input })
}

export function connect(id: string) {
  return invokeCommand<ConnectionStatus>('connect', { id })
}

export function disconnect(id: string) {
  return invokeCommand<ConnectionStatus>('disconnect', { id })
}

export function listConnectionStatuses() {
  return invokeCommand<ConnectionStatus[]>('list_connection_statuses')
}
