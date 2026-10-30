import { useEffect, useRef, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

/** One page inside a task; navigation never creates another modal or focus trap. */
export function WorkflowHeader({ title, description, onBack, focus = false }: { title: string; description?: string; onBack?: () => void; focus?: boolean }) {
  const { t } = useTranslation()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (focus) heading.current?.focus({ preventScroll: true }) }, [focus])
  return <header className="flex min-h-16 shrink-0 items-center gap-3 border-b px-5 py-3">
    {onBack && <Button type="button" variant="ghost" size="icon" aria-label={t('driverWorkflow.back')} title={t('driverWorkflow.backHint')} onClick={onBack}><ArrowLeft /></Button>}
    <div className="min-w-0"><h2 ref={heading} tabIndex={-1} className="outline-none text-base font-semibold tracking-tight [overflow-wrap:anywhere]">{title}</h2>{description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}</div>
  </header>
}

export function WorkflowFooter({ children }: { children: ReactNode }) {
  return <footer className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-surface px-5 py-3">{children}</footer>
}


export function LeavePrompt({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  const { t } = useTranslation()
  return <div role="alert" className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning-bg p-3 text-xs">
    <span>{t('driverWorkflow.unsaved')}</span><div className="flex gap-2"><Button autoFocus type="button" variant="outline" onClick={onKeep}>{t('driverWorkflow.keepEditing')}</Button><Button type="button" variant="destructive" onClick={onDiscard}>{t('driverWorkflow.discard')}</Button></div>
  </div>
}
