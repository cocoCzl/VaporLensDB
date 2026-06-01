import { useEffect, useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
  const [open, setOpen] = useState(false)
  const { saveConnection, testConnectionInput, loading, error } = useConnectionStore()
  const { drivers, loadDrivers } = useDriverStore()

  useEffect(() => {
    if (open) {
      loadDrivers()
    }
  }, [loadDrivers, open])

  return (
    <>
      {trigger ? (
        <span onClick={() => setOpen(true)}>{trigger}</span>
      ) : (
        <Button
          type="button"
          size={connection ? 'xs' : 'default'}
          variant={connection ? 'ghost' : 'default'}
          onClick={() => setOpen(true)}
        >
          {!connection && <Plus />}
          {triggerLabel ?? (connection ? '编辑' : '新建连接')}
        </Button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border bg-card shadow-2xl">
            <div className="flex h-14 items-center gap-3 border-b px-4">
              <div className="grid size-8 place-items-center rounded-md bg-primary/15 text-primary">
                <Plus className="size-4" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold">
                  {connection ? '编辑连接' : '新建连接'}
                </h2>
                <p className="text-xs text-muted-foreground">
                  配置数据源、驱动和认证信息。
                </p>
              </div>
            </div>
            <div className="min-h-0 overflow-auto p-4">
              <p className="mb-4 text-xs text-muted-foreground">
                内置 PostgreSQL / MySQL，Oracle 和自定义库通过外部驱动配置接入。
              </p>
              <ConnectionForm
                connection={connection}
                driverDefinitions={drivers}
                loading={loading}
                onCancel={() => setOpen(false)}
                onTest={testConnectionInput}
                onSubmit={async (input) => {
                  await saveConnection(input)
                  setOpen(false)
                }}
              />
              {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
