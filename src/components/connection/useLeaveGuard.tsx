import { useRef, useState } from 'react'
import { LeavePrompt } from './WorkflowPage'

export function useLeaveGuard(dirty: boolean) {
  const returnFocus = useRef<HTMLElement | null>(null)
  const [pending, setPending] = useState<(() => void) | null>(null)
  return {
    request: (action: () => void) => { if (dirty) { returnFocus.current = document.activeElement as HTMLElement; setPending(() => action) } else action() },
    prompt: pending ? <LeavePrompt onKeep={() => { setPending(null); queueMicrotask(() => { if (returnFocus.current?.isConnected) returnFocus.current.focus() }) }} onDiscard={() => { setPending(null); pending() }} /> : null,
  }
}
