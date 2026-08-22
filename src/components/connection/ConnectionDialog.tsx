import { useEffect, useState, type ReactNode } from 'react'
import { Plus, X } from 'lucide-react'
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
import { DatabaseVendorIcon } from '@/components/common/DatabaseVendorIcon'
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
    // Prime the shared catalogue before the dialog is opened. This keeps the
    // form from switching driver definitions while its opening transition runs.
    void loadDrivers()
  }, [loadDrivers])

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
        nativeButton={false}
        render={
          <span onClick={(event) => event.stopPropagation()}>{dialogTrigger}</span>
        }
      />
      <DialogContent
        className="flex h-[min(43rem,calc(100vh-3rem))] max-w-[60rem] flex-col gap-0 overflow-hidden rounded-md p-0 sm:max-w-[60rem] data-open:animate-none data-closed:animate-none"
        showCloseButton={false}
      >
        <DialogHeader className="ide-toolbar flex h-10 shrink-0 flex-row items-center justify-between gap-3 border-b px-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid size-7 shrink-0 place-items-center rounded bg-primary/15 text-primary">
                  <DatabaseVendorIcon driverType={connection?.driverType ?? 'postgres'} className="size-4" />
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
        <div className="min-h-0 flex-1 overflow-hidden">
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
                  await connectConnection(saved.id, { password: input.savePassword ? null : input.password })
                  setOpen(false)
                }}
              />
        </div>
      </DialogContent>
    </Dialog>
  )
}
