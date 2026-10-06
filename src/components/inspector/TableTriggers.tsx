import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { getTableTriggers } from '@/ipc/metadata'
import { normalizeAppError } from '@/ipc/client'
import type { DbObjectInfo } from '@/types/metadata'

type TriggerState = { request: string } & (
  | { status: 'loading' }
  | { status: 'ready'; triggers: DbObjectInfo[] }
  | { status: 'unsupported' }
  | { status: 'error'; message: string }
)

export function TableTriggers({ connectionId, schema, table, refresh, onOpenDefinition }: {
  connectionId: string
  schema: string
  table: string
  refresh: number
  onOpenDefinition: (trigger: DbObjectInfo) => void
}) {
  const { t } = useTranslation()
  const request = JSON.stringify([connectionId, schema, table, refresh])
  const [state, setState] = useState<TriggerState>({ request, status: 'loading' })
  useEffect(() => {
    let current = true
    // The cleanup invalidates success AND failure on switch, refresh or unmount.
    void getTableTriggers(connectionId, schema, table).then((triggers) => {
      if (current) setState({ request, status: 'ready', triggers })
    }).catch((error: unknown) => {
      if (!current) return
      const normalized = normalizeAppError(error)
      setState(normalized.code === 'UNSUPPORTED_OPERATION'
        ? { request, status: 'unsupported' }
        : { request, status: 'error', message: normalized.message })
    })
    return () => { current = false }
  }, [connectionId, schema, table, request])

  // Clear stale data immediately, including the render before effect cleanup.
  if (state.request !== request || state.status === 'loading') {
    return <p role="status" className="p-4 text-xs text-muted-foreground">{t('workbench.loadingTriggers')}</p>
  }
  if (state.status === 'unsupported') {
    return <p className="p-4 text-xs text-muted-foreground">{t('workbench.triggersUnsupported')}</p>
  }
  if (state.status === 'error') {
    return <div role="alert" className="p-4 text-xs text-destructive">
      <p>{t('workbench.loadTriggersFailed')}</p>
      <p className="mt-2 break-words">{state.message}</p>
    </div>
  }
  return <TriggersList triggers={state.triggers} onOpenDefinition={onOpenDefinition} />
}

function TriggersList({
  triggers,
  onOpenDefinition,
}: {
  triggers: DbObjectInfo[]
  onOpenDefinition: (trigger: DbObjectInfo) => void
}) {
  const { t } = useTranslation()
  if (triggers.length === 0) {
    return <p className="p-4 text-xs text-muted-foreground">{t('workbench.noTriggers')}</p>
  }

  return (
    <div className="min-w-[720px] text-xs">
      <div className="grid grid-cols-[minmax(220px,1fr)_160px_120px_120px] border-b bg-muted/45 font-medium">
        <div className="border-r px-2 py-1.5">{t('workbench.structureHeaders.trigger')}</div>
        <div className="border-r px-2 py-1.5">{t('workbench.structureHeaders.type')}</div>
        <div className="border-r px-2 py-1.5">{t('workbench.structureHeaders.status')}</div>
        <div className="px-2 py-1.5">{t('workbench.structureHeaders.definition')}</div>
      </div>
      {triggers.map((trigger) => (
        <div
          key={`${trigger.schema ?? ''}.${trigger.name}`}
          className="grid grid-cols-[minmax(220px,1fr)_160px_120px_120px] border-b hover:bg-accent/35"
        >
          <div className="min-w-0 truncate border-r px-2 py-1.5 font-mono">{trigger.name}</div>
          <div className="min-w-0 truncate border-r px-2 py-1.5">{trigger.objectType ?? 'trigger'}</div>
          <div className="min-w-0 truncate border-r px-2 py-1.5">{trigger.status ?? ''}</div>
          <div className="px-2 py-1">
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => onOpenDefinition(trigger)}
            >
              {t('workbench.openSourceDdl')}
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
