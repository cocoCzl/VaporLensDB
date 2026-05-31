import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConnectionForm } from '@/components/connection/ConnectionForm'
import { useConnectionStore } from '@/stores/connectionStore'
import { useDriverStore } from '@/stores/driverStore'
import type { ConnectionConfig } from '@/types/connection'

interface ConnectionDialogProps {
  connection?: ConnectionConfig | null
  triggerLabel?: string
}

export function ConnectionDialog({ connection = null, triggerLabel }: ConnectionDialogProps) {
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
      <Button
        type="button"
        size={connection ? 'sm' : 'default'}
        variant={connection ? 'ghost' : 'default'}
        onClick={() => setOpen(true)}
      >
        {!connection && <Plus />}
        {triggerLabel ?? (connection ? '编辑' : '新建连接')}
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4">
          <div className="w-full max-w-xl rounded-lg border bg-background p-4 shadow-lg">
            <div className="mb-4">
              <h2 className="text-base font-medium">
                {connection ? '编辑连接' : '新建连接'}
              </h2>
              <p className="text-xs text-muted-foreground">
                内置 PostgreSQL / MySQL，Oracle 和自定义库通过外部驱动配置接入。
              </p>
            </div>
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
      )}
    </>
  )
}
