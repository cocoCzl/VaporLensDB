import { invokeCommand } from '@/ipc/client'
import { COMMANDS } from '@/ipc/contracts'
import type { ConnectionConfig, ConnectionInput, ConnectionStatus } from '@/types/connection'

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
