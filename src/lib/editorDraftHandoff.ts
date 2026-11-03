// A single transient selection during the first workspace module handoff.
// Text is already in editorStore; no timers, persistent storage or input queue.
type DraftSelection = { tabId: string; start: number; end: number; direction: 'forward' | 'backward' | 'none'; focused: boolean }
let pending: DraftSelection | null = null
export function rememberDraftSelection(selection: DraftSelection) { pending = selection }
export function takeDraftSelection(tabId?: string) {
  const selection = pending
  pending = null
  return selection?.tabId === tabId ? selection : null
}
