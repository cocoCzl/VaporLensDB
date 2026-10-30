import { useTranslation } from 'react-i18next'
import { normalizeAppError } from '@/ipc/client'
import { workflowErrorSummary } from './workflowPresentation'

/** Keep backend diagnostics available without using them as the localized summary. */
export function WorkflowError({ error }: { error: unknown }) {
  const { t } = useTranslation()
  const normalized = normalizeAppError(error)
  return <div role="alert" className="min-w-0 break-words text-xs text-destructive">
    <p>{workflowErrorSummary(normalized, t)}</p>
    <details className="mt-1"><summary className="cursor-pointer">{t('connectionForm.errorDetails')}</summary><pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-sans">{[normalized.message, normalized.detail].filter(Boolean).join('\n')}</pre></details>
  </div>
}
