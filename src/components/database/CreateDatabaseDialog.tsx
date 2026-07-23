import { useEffect, useMemo, useState } from 'react'
import { Database, Loader2, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { executeQuery } from '@/ipc/query'
import { normalizeAppError } from '@/ipc/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useConnectionStore } from '@/stores/connectionStore'
import { useMetadataStore } from '@/stores/metadataStore'
import { useUiStore } from '@/stores/uiStore'

export function CreateDatabaseDialog() {
  const { t } = useTranslation()
  const browsingConnectionId = useConnectionStore((state) => state.browsingConnectionId)
  const connections = useConnectionStore((state) => state.connections)
  const statuses = useConnectionStore((state) => state.statuses)
  const connectConnection = useConnectionStore((state) => state.connectConnection)
  const clearConnection = useMetadataStore((state) => state.clearConnection)
  const loadDatabases = useMetadataStore((state) => state.loadDatabases)
  const setCatalogSchemaPath = useMetadataStore((state) => state.setCatalogSchemaPath)
  const requestConnectionRefresh = useMetadataStore((state) => state.requestConnectionRefresh)
  const notify = useUiStore((state) => state.notify)
  const notifyError = useUiStore((state) => state.notifyError)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [charset, setCharset] = useState('')
  const [collation, setCollation] = useState('')
  const [template, setTemplate] = useState('')
  const [tablespace, setTablespace] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const connection = connections.find((item) => item.id === browsingConnectionId) ?? null
  const supported = connection?.driverType === 'mysql' || connection?.driverType === 'postgres'
  const connected = connection ? statuses[connection.id]?.status === 'connected' : false
  const sql = useMemo(() => buildCreateDatabaseSql(connection?.driverType ?? null, name, { charset, collation, template, tablespace }), [connection?.driverType, name, charset, collation, template, tablespace])

  function locateDatabase(target: { id: string; driverType: string }, database: string) {
    const isMysql = target.driverType === 'mysql'
    setCatalogSchemaPath({
      connectionId: target.id,
      database,
      schema: isMysql ? database : null,
      schemaListAvailable: isMysql,
    })
  }

  useEffect(() => {
    const openDialog = () => setOpen(true)
    window.addEventListener('vaporlensdb:open-create-database', openDialog)
    return () => window.removeEventListener('vaporlensdb:open-create-database', openDialog)
  }, [])

  async function createDatabase() {
    if (!connection || !supported || !sql || busy) return
    setBusy(true)
    try {
      if (!connected) await connectConnection(connection.id, { selectForBrowsing: false })
      const existingDatabases = await loadDatabases(connection.id, true)
      const existing = existingDatabases.find((database) => database.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase())
      if (existing) {
        locateDatabase(connection, existing.name)
        requestConnectionRefresh(connection.id)
        notify({ kind: 'warning', title: t('databaseCreate.alreadyExists'), message: existing.name })
        setConfirming(false)
        return
      }
      await executeQuery({ connectionId: connection.id, sql, queryId: crypto.randomUUID() })
      clearConnection(connection.id)
      locateDatabase(connection, name.trim())
      await loadDatabases(connection.id, true)
      requestConnectionRefresh(connection.id)
      notify({ kind: 'success', title: t('databaseCreate.success'), message: name.trim() })
      setOpen(false)
      setName('')
      setCharset('')
      setCollation('')
      setTemplate('')
      setTablespace('')
      setConfirming(false)
    } catch (error) {
      notifyError(normalizeAppError(error), t('databaseCreate.failed'))
    } finally {
      setBusy(false)
    }
  }

  function close() {
    if (busy) return
    setConfirming(false)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => nextOpen || close()}>
      <DialogTrigger render={<Button type="button" size="xs" variant="ghost" disabled={!supported}><Plus className="size-3.5" />{t('databaseCreate.action')}</Button>} />
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0" showCloseButton={false}>
        <DialogHeader className="border-b px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid size-8 place-items-center rounded-md bg-primary/10 text-primary"><Database className="size-4" /></div>
            <div>
              <DialogTitle>{t('databaseCreate.title')}</DialogTitle>
              <DialogDescription>{connection ? `${t('databaseCreate.target')}: ${connection.name} · ${connection.driverType}` : t('databaseCreate.unsupported')}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="grid gap-4 p-5">
          {!supported ? (
            <div className="rounded border border-dashed p-3 text-xs text-muted-foreground">{t('databaseCreate.unsupported')}</div>
          ) : (
            <>
              <label className="grid gap-1.5 text-xs font-medium">
                {t('databaseCreate.name')}
                <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="analytics" />
              </label>
              <details className="group rounded border bg-muted/20" open={confirming ? true : undefined}>
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium">{t('databaseCreate.advanced')}</summary>
                <div className="grid gap-3 border-t p-3 sm:grid-cols-2">
                  {connection.driverType === 'mysql' ? <>
                    <OptionField label={t('databaseCreate.charset')} value={charset} onChange={setCharset} options={MYSQL_CHARSETS} />
                    <OptionField label={t('databaseCreate.collation')} value={collation} onChange={setCollation} options={MYSQL_COLLATIONS} />
                  </> : <>
                    <OptionField label={t('databaseCreate.encoding')} value={charset} onChange={setCharset} options={POSTGRES_ENCODINGS} />
                    <OptionField label={t('databaseCreate.template')} value={template} onChange={setTemplate} options={POSTGRES_TEMPLATES} />
                    <OptionField label={t('databaseCreate.tablespace')} value={tablespace} onChange={setTablespace} options={POSTGRES_TABLESPACES} />
                  </>}
                </div>
              </details>
              <div className="rounded border bg-muted/30 p-3">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t('databaseCreate.generatedSql')}</div>
                <pre className="overflow-auto font-mono text-xs">{sql || '—'}</pre>
              </div>
            </>
          )}
        </div>
        {confirming && supported && (
          <div className="mx-5 mb-3 rounded border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
            <div className="font-semibold">{t('databaseCreate.confirmTitle')}</div>
            <p className="mt-1 text-muted-foreground">{t('databaseCreate.confirmHint', { name: connection?.name ?? '' })}</p>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={confirming ? () => setConfirming(false) : close}>
            {confirming ? t('databaseCreate.review') : t('common.cancel')}
          </Button>
          <Button type="button" disabled={!sql || !supported || busy} onClick={() => confirming ? void createDatabase() : setConfirming(true)}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {confirming ? t('databaseCreate.confirmCreate') : t('databaseCreate.review')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const MYSQL_CHARSETS = ['utf8mb4', 'utf8', 'latin1']
const MYSQL_COLLATIONS = ['utf8mb4_unicode_ci', 'utf8mb4_0900_ai_ci', 'utf8_general_ci', 'latin1_swedish_ci']
const POSTGRES_ENCODINGS = ['UTF8', 'LATIN1', 'SQL_ASCII']
const POSTGRES_TEMPLATES = ['template0', 'template1']
const POSTGRES_TABLESPACES = ['pg_default', 'pg_global']

function OptionField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label className="grid gap-1 text-[11px] text-muted-foreground">{label}
    <select className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">—</option>
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  </label>
}

function buildCreateDatabaseSql(driver: string | null, rawName: string, options: { charset: string; collation: string; template: string; tablespace: string }) {
  const name = rawName.trim()
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(name)) return ''
  const charset = driver === 'mysql' ? allowedOption(options.charset, MYSQL_CHARSETS) : allowedOption(options.charset, POSTGRES_ENCODINGS)
  const collation = allowedOption(options.collation, MYSQL_COLLATIONS)
  const template = allowedOption(options.template, POSTGRES_TEMPLATES)
  const tablespace = allowedOption(options.tablespace, POSTGRES_TABLESPACES)
  if (driver === 'mysql') {
    return ['CREATE DATABASE', `\`${name}\``, charset ? `CHARACTER SET ${charset}` : '', collation ? `COLLATE ${collation}` : ''].filter(Boolean).join(' ')
  }
  if (driver === 'postgres') {
    return ['CREATE DATABASE', `"${name}"`, charset ? `ENCODING '${escapeLiteral(charset)}'` : '', template ? `TEMPLATE "${template}"` : '', tablespace ? `TABLESPACE "${tablespace}"` : ''].filter(Boolean).join(' ')
  }
  return ''
}

function escapeLiteral(value: string) { return value.replace(/'/g, "''") }
function allowedOption(value: string, options: string[]) {
  return options.includes(value) ? value : ''
}
