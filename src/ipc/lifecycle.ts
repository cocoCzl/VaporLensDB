import { invokeCommand } from '@/ipc/client'
import { COMMANDS } from '@/ipc/contracts'

export function shutdownApplication() {
  return invokeCommand<void>(COMMANDS.shutdownApplication)
}

export function applicationCloseListenerReady() {
  return invokeCommand<void>(COMMANDS.applicationCloseListenerReady)
}

export function applicationCloseRequestFinished() {
  return invokeCommand<void>(COMMANDS.applicationCloseRequestFinished)
}
