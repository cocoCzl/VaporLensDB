import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { ConnectionConfig } from '@/types/connection'

interface RenameConnectionDialogProps {
  connection: ConnectionConfig | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (connection: ConnectionConfig, name: string) => Promise<void>
}

export function RenameConnectionDialog({ connection, open, onOpenChange, onSave }: RenameConnectionDialogProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(connection?.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => inputRef.current?.select())
  }, [open])

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('connection.renameRequired'))
      return
    }
    if (!connection) return
    setSaving(true)
    try {
      await onSave(connection, trimmed)
      onOpenChange(false)
    } catch {
      // The shared notification surface reports persistence failures.
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 p-5" showCloseButton={false} aria-describedby={undefined}>
        <DialogHeader><DialogTitle>{t('connection.renameTitle')}</DialogTitle></DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); void submit() }}>
          <Input
            ref={inputRef}
            value={name}
            aria-label={t('connectionForm.name')}
            onChange={(event) => { setName(event.target.value); setError(null) }}
            disabled={saving}
          />
          {error && <p className="mt-2 text-xs text-danger" role="alert">{error}</p>}
          <DialogFooter className="mt-5">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={saving}>{t('common.save')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
