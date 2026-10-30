import { isValidElement, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ModuleBoundary } from '@/components/common/ModuleBoundary'

import { useConnectionStore } from '@/stores/connectionStore'
import { useDriverStore } from '@/stores/driverStore'
import type { ConnectionConfig } from '@/types/connection'

const ConnectionForm = lazy(() => import('@/components/connection/ConnectionForm').then(module => ({ default: module.ConnectionForm })))

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
  const closeRequest = useRef<(() => void) | null>(null)
  const { saveConnection, testConnectionInput, connectConnection, loading } = useConnectionStore()
  const { drivers, loadDrivers } = useDriverStore()

  const isOpen = open ?? uncontrolledOpen
  useEffect(() => { if (isOpen) void loadDrivers() }, [isOpen, loadDrivers])
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
        if (!nextOpen && closeRequest.current) closeRequest.current()
        else setDialogOpen(nextOpen)
      }}
    >
      {!hideTrigger && <DialogTrigger
        onClick={event => event.stopPropagation()}
        nativeButton={isValidElement(dialogTrigger)}
        render={
          isValidElement(dialogTrigger) ? dialogTrigger : <span>{dialogTrigger}</span>
        }
      />}
      <DialogContent
        className="connection-workflow flex h-[min(600px,calc(100dvh-2rem))] w-[min(900px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden rounded-xl border-border-strong bg-surface p-0 sm:max-w-none data-open:animate-none data-closed:animate-none"
        overlayClassName="bg-[hsl(var(--overlay)/0.36)] backdrop-blur-none"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{connection ? t('connection.editTitle') : t('connection.newTitle')}</DialogTitle>
        <div className="min-h-0 flex-1 overflow-hidden">
          {isOpen && <ModuleBoundary>
            <Suspense fallback={<div className="flex h-full flex-col"><p role="status" className="flex-1 p-5 text-sm">{t('common.loading')}</p><div className="border-t p-4"><Button variant="ghost" onClick={() => setDialogOpen(false)}>{t('common.cancel')}</Button></div></div>}>
              <ConnectionForm
                connection={connection}
                driverDefinitions={drivers}
                loading={loading}
                closeRequestRef={closeRequest}
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
            </Suspense>
          </ModuleBoundary>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
