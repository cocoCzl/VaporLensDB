import { invokeCommand } from '@/ipc/client'
import { COMMANDS } from '@/ipc/contracts'

export function shutdownApplication() {
  return invokeCommand<void>(COMMANDS.shutdownApplication)
}
