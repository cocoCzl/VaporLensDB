import { useEffect, useState, type ReactNode } from 'react'
import { Database, Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ConnectionForm } from '@/components/connection/ConnectionForm'
import { useConnectionStore } from '@/stores/connectionStore'
import { useDriverStore } from '@/stores/driverStore'
import type { ConnectionConfig } from '@/types/connection'

interface ConnectionDialogProps {
  connection?: ConnectionConfig | null
  triggerLabel?: string
  trigger?: ReactNode
}

export function ConnectionDialog({
  connection = null,
  triggerLabel,
  trigger,
}: ConnectionDialogProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { saveConnection, testConnectionInput, connectConnection, loading } = useConnectionStore()
  const { drivers, loadDrivers } = useDriverStore()

  useEffect(() => {
    if (open) {
      loadDrivers()
    }
  }, [loadDrivers, open])

  const dialogTrigger = trigger ?? (
    <Button
      type="button"
      size={connection ? 'xs' : 'default'}
      variant={connection ? 'ghost' : 'default'}
    >
      {!connection && <Plus />}
      {triggerLabel ?? (connection ? t('connection.edit') : t('connection.new'))}
    </Button>
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <span onClick={(event) => event.stopPropagation()}>{dialogTrigger}</span>
        }
      />
      <DialogContent className="flex max-h-[calc(100vh-4rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl" showCloseButton={false}>
        <DialogHeader className="flex h-14 shrink-0 flex-row items-center justify-between gap-3 border-b px-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/15 text-primary">
                  <Database className="size-4" />
                </div>
                <div className="min-w-0">
                  <DialogTitle>
                    {connection ? t('connection.editTitle') : t('connection.newTitle')}
                  </DialogTitle>
                  <DialogDescription className="truncate text-xs">
                    {t('connection.dialogSubtitle')}
                  </DialogDescription>
                </div>
              </div>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                title={t('common.cancel')}
                aria-label={t('common.cancel')}
                onClick={() => setOpen(false)}
              >
                <X />
              </Button>
        </DialogHeader>
        <div className="min-h-0 overflow-auto p-4">
              <p className="mb-4 text-xs text-muted-foreground">
                {t('connection.driverHelp')}
              </p>
              <ConnectionForm
                connection={connection}
                driverDefinitions={drivers}
                loading={loading}
                onCancel={() => setOpen(false)}
                onTest={testConnectionInput}
                onSaveOnly={async (input) => {
                  await saveConnection(input)
                  setOpen(false)
                }}
                onSaveAndConnect={async (input) => {
                  const saved = await saveConnection(input)
                  await connectConnection(saved.id)
                  setOpen(false)
                }}
              />
        </div>
      </DialogContent>
    </Dialog>
  )
}
