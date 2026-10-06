import { useTranslation } from 'react-i18next'
import { useSqlFileChoice } from '@/lib/sqlFileChoice'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
export function SqlFileDialog() {
  const { t } = useTranslation()
  const pending = useSqlFileChoice((state) => state.pending)
  if (!pending) return null
  return <Dialog open onOpenChange={(open) => { if (!open) pending.resolve('cancel') }}>
    <DialogContent><DialogHeader><DialogTitle>{t(`sqlFile.${pending.message}`)}</DialogTitle><DialogDescription>{t(`sqlFile.${pending.message}Description`)}</DialogDescription></DialogHeader>
      <p className="break-all text-sm">{pending.detail}</p><DialogFooter>{pending.choices.map((choice) => <Button key={choice} variant={choice === 'save' ? 'default' : 'outline'} onClick={() => pending.resolve(choice)}>{t(`sqlFile.${choice}`)}</Button>)}</DialogFooter>
    </DialogContent>
  </Dialog>
}
