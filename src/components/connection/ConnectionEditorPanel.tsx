import { useEffect } from 'react'
import { Database, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ConnectionForm } from '@/components/connection/ConnectionForm'
import { Button } from '@/components/ui/button'
import { useConnectionStore } from '@/stores/connectionStore'
import { useDriverStore } from '@/stores/driverStore'
import type { ConnectionConfig } from '@/types/connection'

interface ConnectionEditorPanelProps {
  connection: ConnectionConfig | null
  isNew?: boolean
  onNew: () => void
  onCancel: () => void
  onSaved: (connection: ConnectionConfig) => void
  onDirtyChange: (dirty: boolean) => void
}

export function ConnectionEditorPanel({ connection, isNew = false, onNew, onCancel, onSaved, onDirtyChange }: ConnectionEditorPanelProps) {
  const { t } = useTranslation()
  const { saveConnection, testConnectionInput, connectConnection, loading } = useConnectionStore()
  const { drivers, loadDrivers } = useDriverStore()

  useEffect(() => { void loadDrivers() }, [loadDrivers])

  if (!connection && !isNew) {
    return (
      <section className="grid min-h-0 flex-1 place-items-center p-6 text-center">
        <div className="grid max-w-xs gap-2 text-sm text-muted-foreground">
          <Database className="mx-auto size-6" />
          <p className="font-medium text-foreground">{t('connection.selectToEdit')}</p>
          <p className="text-xs leading-5">{t('connection.selectToEditHint')}</p>
          <Button type="button" size="sm" onClick={onNew}>
            <Plus />
            {t('connection.new')}
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center border-b px-4">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{isNew ? t('connection.newTitle') : t('connection.editTitle')}</h2>
          <p className="truncate text-[11px] text-muted-foreground">{t('connection.dialogSubtitle')}</p>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        <ConnectionForm
          key={connection?.id || '__new__'}
          connection={connection}
          layout="panel"
          driverDefinitions={drivers}
          loading={loading}
          onDirtyChange={onDirtyChange}
          onCancel={onCancel}
          onTest={testConnectionInput}
          onSaveOnly={async (input) => {
            const saved = await saveConnection(input)
            onSaved(saved)
          }}
          onSaveAndConnect={async (input) => {
            const saved = await saveConnection(input)
            await connectConnection(saved.id, { selectForBrowsing: false })
            onSaved(saved)
          }}
        />
      </div>
    </section>
  )
}
