import { useCallback, useEffect, useRef, useState } from 'react'
import { previewTableCsvImport, type ImportPreview, type PreviewTableCsvImportInput } from '@/ipc/export'
import { cancelTask } from '@/ipc/task'

export type CsvPreviewStatus = 'idle' | 'loading' | 'cancelling'

export function useCsvPreview({
  onCompleted,
  onError,
}: {
  onCompleted: (preview: ImportPreview) => void
  onError: (error: unknown) => void
}) {
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [status, setStatus] = useState<CsvPreviewStatus>('idle')
  const generation = useRef(0)
  const activeTaskId = useRef<string | null>(null)
  const callbacks = useRef({ onCompleted, onError })
  useEffect(() => {
    callbacks.current = { onCompleted, onError }
  }, [onCompleted, onError])

  const start = useCallback(async (input: Omit<PreviewTableCsvImportInput, 'taskId'>) => {
    const requestGeneration = ++generation.current
    const taskId = crypto.randomUUID()
    activeTaskId.current = taskId
    setStatus('loading')
    try {
      const result = await previewTableCsvImport({ ...input, taskId })
      if (generation.current !== requestGeneration) return
      if (!result.cancelled) {
        setPreview(result)
        callbacks.current.onCompleted(result)
      }
    } catch (error) {
      if (generation.current === requestGeneration) callbacks.current.onError(error)
    } finally {
      if (generation.current === requestGeneration) {
        activeTaskId.current = null
        setStatus('idle')
      }
    }
  }, [])

  const cancel = useCallback(async () => {
    const taskId = activeTaskId.current
    if (!taskId) return
    setStatus('cancelling')
    try {
      await cancelTask(taskId)
    } catch (error) {
      callbacks.current.onError(error)
    }
  }, [])

  const clear = useCallback(() => setPreview(null), [])

  return { preview, status, start, cancel, clear }
}
