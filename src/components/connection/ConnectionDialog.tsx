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
  const { saveConnection, testConnectionInput, connectConnection, loading } = useConnectionStore()
  const { drivers, loadDrivers } = useDriverStore()

  useEffect(() => {
    if (open) {
      loadDrivers()
    }
  }, [loadDrivers, open])

  return (
    <>
      {trigger ? (
        <span
          onClick={(event) => {
            event.stopPropagation()
            setOpen(true)
          }}
        >
          {trigger}
        </span>
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
                  配置 PostgreSQL、MySQL、Oracle 或自定义驱动的数据源。
                </p>
              </div>
            </div>
            <div className="min-h-0 overflow-auto p-4">
              <p className="mb-4 text-xs text-muted-foreground">
                PostgreSQL 和 MySQL 使用内置驱动；Oracle 需要本地 ojdbc，连接、查询、对象浏览、DDL/source 和补全可用。
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
          </div>
        </div>
      )}
    </>
  )
}
