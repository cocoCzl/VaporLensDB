import { useCallback, useEffect, useRef, useState } from 'react'
import { copyToClipboard } from '@/lib/clipboard'

/** Latest copy wins; a completion cannot update a closed result/viewer. */
export function useClipboardFeedback() {
  const [feedback, setFeedback] = useState<'success' | 'failure' | null>(null)
  const generation = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => { generation.current++; clearTimeout(timer.current) }, [])
  const copy = useCallback(async (value: string) => {
    const request = ++generation.current
    clearTimeout(timer.current)
    const success = await copyToClipboard(value)
    if (request !== generation.current) return
    setFeedback(success ? 'success' : 'failure')
    timer.current = setTimeout(() => setFeedback(null), success ? 3000 : 6000)
  }, [])
  return { copy, feedback }
}
