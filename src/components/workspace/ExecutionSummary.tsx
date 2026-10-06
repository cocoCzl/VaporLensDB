import { useTranslation } from 'react-i18next'
import type { ExecutionReport } from '@/types/query'

export function ExecutionSummary({ report, onSelectResult }: {
  report: ExecutionReport
  onSelectResult: (index: number) => void
}) {
  const { t } = useTranslation()
  const succeeded = report.statements.filter(statement => statement.status === 'succeeded').length
  return <details key={report.outcome} open={report.outcome !== 'completed'} className="shrink-0 border-b text-xs">
    <summary className="cursor-pointer px-3 py-2 font-medium">
      {t('executionReport.title')} · {t('executionReport.count', { completed: succeeded, total: report.statements.length })}
    </summary>
    <div className="max-h-48 overflow-auto px-3 pb-2">
      <p className="mb-2 text-muted-foreground">{t('executionReport.facts')}</p>
      {report.outcome === 'cancelled' && <p className="mb-2 text-muted-foreground">{t('executionReport.cancelNote')}</p>}
      <ol className="space-y-2">
        {report.statements.map(statement => <li key={statement.index} className="rounded border p-2">
          <div className="flex flex-wrap items-center gap-2">
            {statement.resultIndex != null
              ? <button type="button" className="underline underline-offset-2" onClick={() => onSelectResult(statement.resultIndex!)}>{t('executionReport.statement', { index: statement.index })}</button>
              : <span>{t('executionReport.statement', { index: statement.index })}</span>}
            <strong>{t(`executionReport.${statement.status}`)}</strong>
            {statement.elapsedMs != null && <span>{statement.elapsedMs} ms</span>}
            {statement.affectedRows != null && <span>{t('executionReport.affected', { count: statement.affectedRows })}</span>}
          </div>
          <pre className="mt-1 whitespace-pre-wrap break-all text-muted-foreground">{statement.preview}</pre>
          {statement.error && <p className="mt-1 break-words text-destructive">{statement.error.message}</p>}
        </li>)}
      </ol>
    </div>
  </details>
}
