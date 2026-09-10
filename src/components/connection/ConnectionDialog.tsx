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
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Render the dialog without an inline trigger for global action surfaces. */
  hideTrigger?: boolean
}

export function ConnectionDialog({
  connection = null,
  triggerLabel,
  trigger,
  open,
  onOpenChange,
  hideTrigger = false,
}: ConnectionDialogProps) {
  const { t } = useTranslation()
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const [headerDriverType, setHeaderDriverType] = useState(connection?.driverType ?? 'postgres')
  const { saveConnection, testConnectionInput, connectConnection, loading } = useConnectionStore()
  const { drivers, loadDrivers } = useDriverStore()

  useEffect(() => {
    // Prime the shared catalogue before the dialog is opened. This keeps the
    // form from switching driver definitions while its opening transition runs.
    void loadDrivers()
  }, [loadDrivers])

  const isOpen = open ?? uncontrolledOpen
  const setDialogOpen = (nextOpen: boolean) => {
    if (open === undefined) setUncontrolledOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }
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
    <Dialog
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setHeaderDriverType(connection?.driverType ?? 'postgres')
        setDialogOpen(nextOpen)
      }}
    >
      {!hideTrigger && <DialogTrigger
        nativeButton={false}
        render={
          <span onClick={(event) => event.stopPropagation()}>{dialogTrigger}</span>
        }
      />}
      <DialogContent
        className="flex h-[min(50rem,calc(100vh-3rem))] max-w-[50rem] flex-col gap-0 overflow-hidden rounded-xl border-border-strong bg-surface p-0 shadow-[0_26px_60px_-28px_hsl(var(--shadow-floating)/0.46)] sm:max-w-[50rem] data-open:animate-none data-closed:animate-none"
        overlayClassName="bg-[hsl(var(--overlay)/0.36)] backdrop-blur-none"
        showCloseButton={false}
      >
        <DialogHeader className="flex h-16 shrink-0 flex-row items-center justify-between gap-3 border-b border-border/75 bg-surface px-7">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-[10px] border border-primary/12 bg-primary/[0.09] text-primary">
                  <DatabaseVendorIcon driverType={headerDriverType} className="size-[22px]" />
                </div>
                <div className="min-w-0">
                  <DialogTitle className="text-[19px] font-[650] tracking-[-0.025em]">
                    {connection ? t('connection.editTitle') : t('connection.newTitle')}
                  </DialogTitle>
                  {!connection && <DialogDescription className="mt-0.5 text-[13px] leading-4">
                    {t('connection.newDescription')}
                  </DialogDescription>}
                </div>
              </div>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="rounded-md text-muted-foreground hover:bg-primary/[0.06] hover:text-foreground"
                title={t('common.cancel')}
                aria-label={t('common.cancel')}
                onClick={() => setDialogOpen(false)}
              >
                <X />
              </Button>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden">
              <ConnectionForm
                connection={connection}
                driverDefinitions={drivers}
                loading={loading}
                onDriverTypeChange={setHeaderDriverType}
                onCancel={() => setDialogOpen(false)}
                onTest={testConnectionInput}
                onSaveOnly={async (input) => {
                  await saveConnection(input)
                  setDialogOpen(false)
                }}
                onSaveAndConnect={async (input) => {
                  const saved = await saveConnection(input)
                  await connectConnection(saved.id, { password: input.savePassword ? null : input.password })
                  setDialogOpen(false)
                }}
              />
        </div>
      </DialogContent>
    </Dialog>
  )
}
