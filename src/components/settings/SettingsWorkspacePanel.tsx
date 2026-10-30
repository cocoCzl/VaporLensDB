import { DriverWorkspace } from '@/components/connection/DriverWorkspace'
import {
  Check,
  Database,
  Download,
  HardDrive,
  Loader2,
  Moon,
  Save,
  Settings,
  Sun,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { downloadDir, join } from '@tauri-apps/api/path'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { Button } from '@/components/ui/button'
import {
  createDbeaverImportSession,
  dbeaverPreviewToConnectionInput,
  dbeaverImportErrorMessage,
  getDbeaverImportableConnections,
  previewDbeaverConfiguration,
  summarizeDbeaverImportSession,
  type DbeaverImportItemState,
  type DbeaverImportPreview,
  type DbeaverImportSessionState,
} from '@/lib/dbeaverImport'
import { normalizeAppError } from '@/ipc/client'
import { writeStorageString } from '@/lib/safeStorage'
import { exportDiagnosticsPackage } from '@/ipc/diagnostics'
import { healthCheck, type HealthCheckResponse } from '@/ipc/health'
import { setApplicationMenuLanguage } from '@/ipc/settings'
import { useConnectionStore } from '@/stores/connectionStore'
import { useQueryHistoryStore } from '@/stores/queryHistoryStore'
import { useUiStore } from '@/stores/uiStore'
import type { ConnectionInput } from '@/types/connection'
import type { LucideIcon } from 'lucide-react'

type SettingsDraft = {
  theme: 'light' | 'dark' | 'system'
  language: 'zh' | 'en'
  queryMaxRows: number
  dataPreviewDefaultRows: number
  editorFontSize: number
  exportDirectory: string | null
  maxLiveSessions: number
  idleReclaimMinutes: number | null
}

const DEFAULT_QUERY_MAX_ROWS = 5_000
const DEFAULT_DATA_PREVIEW_ROWS = 200
const DEFAULT_EDITOR_FONT_SIZE = 13

export function SettingsWorkspacePanel() {
  const { t, i18n } = useTranslation()
  const saveConnection = useConnectionStore((state) => state.saveConnection)
  const theme = useUiStore((state) => state.theme)
  const setTheme = useUiStore((state) => state.setTheme)
  const queryMaxRows = useUiStore((state) => state.queryMaxRows)
  const setQueryMaxRows = useUiStore((state) => state.setQueryMaxRows)
  const dataPreviewDefaultRows = useUiStore((state) => state.dataPreviewDefaultRows)
  const setDataPreviewDefaultRows = useUiStore((state) => state.setDataPreviewDefaultRows)
  const editorFontSize = useUiStore((state) => state.editorFontSize)
  const setEditorFontSize = useUiStore((state) => state.setEditorFontSize)
  const exportDirectory = useUiStore((state) => state.exportDirectory)
  const setExportDirectory = useUiStore((state) => state.setExportDirectory)
  const maxLiveSessions = useUiStore((state) => state.maxLiveSessions)
  const idleReclaimMinutes = useUiStore((state) => state.idleReclaimMinutes)
  const setConnectionSessionPolicy = useUiStore((state) => state.setConnectionSessionPolicy)
  const notify = useUiStore((state) => state.notify)
  const notifyError = useUiStore((state) => state.notifyError)
  const history = useQueryHistoryStore((state) => state.entries)
  const historyLoading = useQueryHistoryStore((state) => state.loading)
  const loadHistory = useQueryHistoryStore((state) => state.loadHistory)
  const clearHistory = useQueryHistoryStore((state) => state.clear)
  const activeSection = useUiStore((state) => state.settingsSection)
  const setActiveSection = useUiStore((state) => state.setSettingsSection)
  const [confirmClearHistory, setConfirmClearHistory] = useState(false)
  const [includeDiagnosticsSqlText, setIncludeDiagnosticsSqlText] = useState(false)
  const [diagnosticsExporting, setDiagnosticsExporting] = useState(false)
  const [health, setHealth] = useState<HealthCheckResponse | null>(null)
  const [healthUnavailable, setHealthUnavailable] = useState(false)
  const [draft, setDraft] = useState<SettingsDraft>(() =>
    settingsDraftFromCurrent(theme, i18n.language, queryMaxRows, dataPreviewDefaultRows, editorFontSize, exportDirectory, maxLiveSessions, idleReclaimMinutes),
  )
  const hasSettingsChanges =
    draft.theme !== theme ||
    draft.language !== normalizedLanguage(i18n.language) ||
    draft.queryMaxRows !== queryMaxRows ||
    draft.dataPreviewDefaultRows !== dataPreviewDefaultRows ||
    draft.editorFontSize !== editorFontSize ||
    draft.exportDirectory !== exportDirectory
    || draft.maxLiveSessions !== maxLiveSessions || draft.idleReclaimMinutes !== idleReclaimMinutes

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  useEffect(() => {
    let cancelled = false
    healthCheck()
      .then((value) => {
        if (!cancelled) {
          setHealth(value)
          setHealthUnavailable(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHealthUnavailable(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  async function handleClearHistory() {
    if (history.length === 0 || historyLoading) {
      return
    }

    if (!confirmClearHistory) {
      setConfirmClearHistory(true)
      window.setTimeout(() => setConfirmClearHistory(false), 3000)
      return
    }

    const cleared = await clearHistory()
    setConfirmClearHistory(false)
    if (cleared) {
      notify({ kind: 'success', title: t('sql.historyCleared') })
    }
  }

  async function handleExportDiagnostics() {
    if (diagnosticsExporting) {
      return
    }

    setDiagnosticsExporting(true)
    try {
      const baseDir = exportDirectory ?? await downloadDir()
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const outputPath = await join(baseDir, `vaporlensdb-diagnostics-${stamp}.json`)
      const exported = await exportDiagnosticsPackage({
        outputPath,
        includeSqlText: includeDiagnosticsSqlText,
      })
      notify({
        kind: 'success',
        title: t('settings.diagnostics.exportComplete'),
        message: exported.path,
      })
    } catch (error) {
      notifyError(normalizeAppError(error), t('settings.diagnostics.exportFailed'))
    } finally {
      setDiagnosticsExporting(false)
    }
  }

  async function chooseExportDirectory() {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: draft.exportDirectory ?? undefined,
    })
    if (typeof selected === 'string') {
      updateDraft({ exportDirectory: selected })
    }
  }

  function updateDraft(patch: Partial<SettingsDraft>) {
    setDraft((current) => ({ ...current, ...patch }))
  }

  function discardSettingsDraft() {
    setDraft(settingsDraftFromCurrent(theme, i18n.language, queryMaxRows, dataPreviewDefaultRows, editorFontSize, exportDirectory, maxLiveSessions, idleReclaimMinutes))
  }

  function restoreDefaultSettingsDraft() {
    setDraft((current) => ({
      ...current,
      queryMaxRows: DEFAULT_QUERY_MAX_ROWS,
      dataPreviewDefaultRows: DEFAULT_DATA_PREVIEW_ROWS,
      editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
      exportDirectory: null,
      maxLiveSessions: 5,
      idleReclaimMinutes: 30,
    }))
  }

  function applySettingsDraft() {
    setTheme(draft.theme)
    setQueryMaxRows(draft.queryMaxRows)
    setDataPreviewDefaultRows(draft.dataPreviewDefaultRows)
    setEditorFontSize(draft.editorFontSize)
    setExportDirectory(draft.exportDirectory)
    setConnectionSessionPolicy(draft.maxLiveSessions, draft.idleReclaimMinutes)
    writeStorageString('vaporlensdb.language', draft.language, () => {
      notify({ kind: 'warning', title: t('settings.language.persistenceFailed') })
    })
    void i18n.changeLanguage(draft.language)
    setApplicationMenuLanguage(draft.language).catch(() => {
      // Native menu sync is best-effort and should not block settings changes.
    })
  }

  return (
    <section className="ide-workspace @container/settings flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="grid min-h-full min-w-0 @min-[850px]/settings:grid-cols-[13.5rem_minmax(0,1fr)]">
          <nav className="ide-settings-nav grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] content-start gap-1 border-b p-2 @min-[850px]/settings:block @min-[850px]/settings:border-r @min-[850px]/settings:border-b-0" aria-label={t('settings.title')}>
            <SettingsNavButton
              active={activeSection === 'general'}
              icon={Settings}
              title={t('settings.general')}
              detail={t('settings.generalHint')}
              onClick={() => setActiveSection('general')}
            />
            <SettingsNavButton
              active={activeSection === 'drivers'}
              icon={HardDrive}
              title={t('drivers.title')}
              detail={t('drivers.navHint')}
              onClick={() => setActiveSection('drivers')}
            />
            <SettingsNavButton
              active={activeSection === 'import'}
              icon={Upload}
              title={t('dbeaver.title')}
              detail={t('dbeaver.navHint')}
              onClick={() => setActiveSection('import')}
            />
            <SettingsNavButton
              active={activeSection === 'diagnostics'}
              icon={Download}
              title={t('settings.diagnostics.title')}
              detail={t('settings.diagnostics.navHint')}
              onClick={() => setActiveSection('diagnostics')}
            />
          </nav>

          <div className="min-w-0 p-4 md:px-6 md:py-5">
            {activeSection === 'general' && (
              <div className="mx-auto grid max-w-[54rem] gap-5">
                <div className="flex min-h-9 flex-wrap items-center justify-between gap-3 border-b border-border/70 px-1 pb-3 text-xs">
                  <span className={hasSettingsChanges ? 'text-warning' : 'text-muted-foreground'}>
                    {hasSettingsChanges ? t('settings.unsavedChanges') : t('settings.noUnsavedChanges')}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="px-3 text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                      disabled={!hasSettingsChanges}
                      onClick={discardSettingsDraft}
                    >
                      <X className="size-3.5" />
                      {t('settings.discard')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-border/80 bg-background/70 px-3 hover:bg-muted/70"
                      onClick={restoreDefaultSettingsDraft}
                    >
                      {t('settings.restoreDefaults')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="px-3"
                      disabled={!hasSettingsChanges}
                      onClick={applySettingsDraft}
                    >
                      <Check className="size-3.5" />
                      {t('settings.apply')}
                    </Button>
                  </div>
                </div>
                <SettingsCard title={t('settings.theme.label')} icon={Settings}>
                  <div className="grid grid-cols-3 gap-0.5 rounded-md border border-border/80 bg-surface-secondary/60 p-0.5">
                    <ThemeButton active={draft.theme === 'system'} label={t('settings.theme.system')} icon={Settings} onClick={() => updateDraft({ theme: 'system' })} />
                    <ThemeButton active={draft.theme === 'dark'} label={t('settings.theme.dark')} icon={Moon} onClick={() => updateDraft({ theme: 'dark' })} />
                    <ThemeButton active={draft.theme === 'light'} label={t('settings.theme.light')} icon={Sun} onClick={() => updateDraft({ theme: 'light' })} />
                  </div>
                  <div className="grid gap-1 text-xs">
                    <span className="font-semibold text-foreground">{t('settings.language.label')}</span>
                    <div className="grid grid-cols-2 gap-0.5 rounded-md border border-border/80 bg-surface-secondary/60 p-0.5">
                      <SegmentButton
                        active={draft.language === 'zh'}
                        label={t('settings.language.zh')}
                        onClick={() => updateDraft({ language: 'zh' })}
                      />
                      <SegmentButton
                        active={draft.language === 'en'}
                        label={t('settings.language.en')}
                        onClick={() => updateDraft({ language: 'en' })}
                      />
                    </div>
                  </div>
                </SettingsCard>

                <SettingsCard title={t('settings.editorAndResult')} icon={Database}>
                  <div className="grid gap-2">
                    <NumberSetting
                      label={t('settings.queryMaxRows')}
                      value={draft.queryMaxRows}
                      min={100}
                      max={1_000_000}
                      step={100}
                      defaultValue={DEFAULT_QUERY_MAX_ROWS}
                      presets={[100, 1_000, 5_000, 10_000, 50_000]}
                      onChange={(value) => updateDraft({ queryMaxRows: value })}
                    />
                    <NumberSetting
                      label={t('settings.dataPreviewRows')}
                      value={draft.dataPreviewDefaultRows}
                      min={1}
                      max={10_000}
                      step={50}
                      defaultValue={DEFAULT_DATA_PREVIEW_ROWS}
                      presets={[50, 100, 200, 500, 1_000]}
                      onChange={(value) => updateDraft({ dataPreviewDefaultRows: value })}
                    />
                    <NumberSetting
                      label={t('settings.editorFontSize')}
                      value={draft.editorFontSize}
                      min={10}
                      max={24}
                      step={1}
                      defaultValue={DEFAULT_EDITOR_FONT_SIZE}
                      presets={[10, 12, 13, 14, 16, 18]}
                      showRange
                      onChange={(value) => updateDraft({ editorFontSize: value })}
                    />
                  </div>
                </SettingsCard>

                <SettingsCard title={t('settings.connectionSessions.title')} icon={Database}>
                  <div className="grid gap-2">
                    <NumberSetting label={t('settings.connectionSessions.max')} value={draft.maxLiveSessions} min={1} max={20} step={1} defaultValue={5} presets={[1, 3, 5, 10, 20]} onChange={(value) => updateDraft({ maxLiveSessions: value })} />
                    <div className="flex items-center justify-between gap-3 border-b border-border-subtle/75 py-3 text-xs"><div><div className="font-semibold">{t('settings.connectionSessions.idle')}</div><p className="mt-1 text-muted-foreground">{t('settings.connectionSessions.hint')}</p></div><Button type="button" size="sm" variant={draft.idleReclaimMinutes === null ? 'secondary' : 'outline'} onClick={() => updateDraft({ idleReclaimMinutes: draft.idleReclaimMinutes === null ? 30 : null })}>{draft.idleReclaimMinutes === null ? t('settings.connectionSessions.enable') : t('settings.connectionSessions.disable')}</Button></div>
                    {draft.idleReclaimMinutes !== null && <NumberSetting label={t('settings.connectionSessions.minutes')} value={draft.idleReclaimMinutes} min={5} max={120} step={5} defaultValue={30} presets={[5, 15, 30, 60, 120]} onChange={(value) => updateDraft({ idleReclaimMinutes: value })} />}
                  </div>
                </SettingsCard>

                <SettingsCard title={t('settings.exportDirectory.title')} icon={Download}>
                  <div className="flex items-center justify-between gap-3 py-3 text-xs">
                    <div className="min-w-0">
                      <div className="font-semibold text-foreground">{t('settings.exportDirectory.label')}</div>
                      <p className="mt-1 truncate font-mono text-muted-foreground" title={draft.exportDirectory ?? t('settings.exportDirectory.systemDefault')}>
                        {draft.exportDirectory ?? t('settings.exportDirectory.systemDefault')}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => updateDraft({ exportDirectory: null })}>
                        {t('settings.exportDirectory.restore')}
                      </Button>
                      <Button type="button" size="sm" onClick={() => void chooseExportDirectory()}>
                        {t('settings.exportDirectory.choose')}
                      </Button>
                    </div>
                  </div>
                </SettingsCard>

                <SettingsCard title={t('sql.history')} icon={Trash2}>
                  <div className="flex items-center justify-between gap-3 py-3 text-xs">
                    <div className="min-w-0">
                      <div className="font-semibold text-foreground">{t('sql.history')}</div>
                      <p className="mt-1 text-muted-foreground">
                        {t('settings.historyCount', { count: history.length })}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={confirmClearHistory ? 'destructive' : 'outline'}
                      disabled={history.length === 0 || historyLoading}
                      onClick={() => {
                        void handleClearHistory()
                      }}
                    >
                      <Trash2 className="size-3.5" />
                      {confirmClearHistory ? t('common.confirmClear') : t('common.clear')}
                    </Button>
                  </div>
                </SettingsCard>
              </div>
            )}

            {activeSection === 'drivers' && <DriverDefinitionsSettings />}

            {activeSection === 'import' && (
              <div className="mx-auto max-w-5xl">
                <DbeaverImportSettings
                  onImportConnection={saveConnection}
                  onNotify={notify}
                  onNotifyError={notifyError}
                />
              </div>
            )}

            {activeSection === 'diagnostics' && (
              <div className="mx-auto grid max-w-5xl gap-4">
                <SettingsCard title={t('settings.diagnostics.title')} icon={Download}>
                  <div className="flex items-start justify-between gap-4">
                    <p className="max-w-2xl text-xs text-muted-foreground">
                      {t('settings.diagnostics.description')}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={diagnosticsExporting}
                      onClick={() => {
                        void handleExportDiagnostics()
                      }}
                    >
                      {diagnosticsExporting ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Download className="size-3.5" />
                      )}
                      {t('settings.diagnostics.export')}
                    </Button>
                  </div>
                  <label className="flex items-start gap-2 rounded-md border bg-background/60 px-3 py-3 text-xs">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 accent-primary"
                      checked={includeDiagnosticsSqlText}
                      onChange={(event) => setIncludeDiagnosticsSqlText(event.target.checked)}
                    />
                    <span className="min-w-0">
                      <span className="block font-medium text-foreground">
                        {t('settings.diagnostics.includeSqlText')}
                      </span>
                      <span className="mt-0.5 block text-muted-foreground">
                        {t('settings.diagnostics.includeSqlTextHint')}
                      </span>
                    </span>
                  </label>
                </SettingsCard>

                <SettingsCard title={t('settings.systemInfo')} icon={HardDrive}>
                  <div className="grid gap-2 grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))]">
                    <SettingFact
                      label={t('settings.backendVersion')}
                      value={health ? `${health.app} ${health.version}` : healthUnavailable ? t('settings.unavailable') : t('common.loading')}
                    />
                    <SettingFact
                      label={t('settings.configStore')}
                      value={health?.configPath ?? (healthUnavailable ? t('settings.unavailable') : t('common.loading'))}
                    />
                    <SettingFact
                      label={t('settings.configSchema')}
                      value={
                        health
                          ? t('settings.configSchemaValue', { version: health.configSchemaVersion })
                          : healthUnavailable
                            ? t('settings.unavailable')
                            : t('common.loading')
                      }
                    />
                    <SettingFact
                      label={t('settings.passwordStorage')}
                      value={health?.passwordStorage ?? (healthUnavailable ? t('settings.unavailable') : t('common.loading'))}
                    />
                    <SettingFact
                      label={t('settings.keyBackend')}
                      value={health?.keyBackend ?? (healthUnavailable ? t('settings.unavailable') : t('common.loading'))}
                    />
                  </div>
                </SettingsCard>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

export function DriverDefinitionsSettings() {
  return <div className="h-[min(600px,calc(100dvh-10rem))] min-h-80 overflow-hidden rounded-lg border bg-surface"><DriverWorkspace /></div>
}

export function DbeaverImportSettings({
  onImportConnection,
  onNotify,
  onNotifyError,
}: {
  onImportConnection: (input: ConnectionInput) => Promise<unknown>
  onNotify: (notification: { kind: 'success' | 'error' | 'info' | 'warning'; title: string; message?: string }) => void
  onNotifyError: (error: { code: string; message: string; detail?: string }, title?: string) => void
}) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<DbeaverImportPreview | null>(null)
  const [session, setSession] = useState<DbeaverImportSessionState | null>(null)
  const [importing, setImporting] = useState(false)
  const [report, setReport] = useState<{ imported: number; failed: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const importingRef = useRef(false)

  async function handlePreview(files: FileList | null) {
    if (importingRef.current) {
      return
    }

    setReport(null)
    if (!files?.length) {
      return
    }

    try {
      const nextPreview = await previewDbeaverConfiguration(Array.from(files))
      setPreview(nextPreview)
      setSession(createDbeaverImportSession(nextPreview))
      onNotify({
        kind: nextPreview.connections.length > 0 ? 'info' : 'warning',
        title: t('dbeaver.previewComplete'),
        message: t('dbeaver.previewSummary', { supported: nextPreview.connections.length, skipped: nextPreview.skipped.length }),
      })
    } catch (error) {
      setPreview(null)
      setSession(null)
      onNotifyError(
        {
          code: 'DBEAVER_IMPORT_PREVIEW_FAILED',
          message: dbeaverImportErrorMessage(error) || t('dbeaver.previewFailedMessage'),
        },
        t('dbeaver.previewFailed'),
      )
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  async function importSupportedConnections() {
    if (!preview || !session || importingRef.current) {
      return
    }

    const connectionsToImport = getDbeaverImportableConnections(preview, session)
    if (connectionsToImport.length === 0) {
      return
    }

    importingRef.current = true
    setImporting(true)
    const nextSession: DbeaverImportSessionState = { ...session }

    try {
      for (const connection of connectionsToImport) {
        nextSession[connection.id] = { status: 'importing' }
        setSession({ ...nextSession })
        try {
          await onImportConnection(dbeaverPreviewToConnectionInput(connection))
          nextSession[connection.id] = { status: 'succeeded' }
        } catch (error) {
          nextSession[connection.id] = {
            status: 'failed',
            errorMessage: dbeaverImportErrorMessage(error),
          }
        }
        setSession({ ...nextSession })
      }

      const summary = summarizeDbeaverImportSession(preview, nextSession)
      setReport({ imported: summary.imported, failed: summary.failed })
      onNotify({
        kind: summary.failed === 0 ? 'success' : 'warning',
        title: t('dbeaver.importComplete'),
        message: t('dbeaver.importSummary', {
          imported: summary.imported,
          failed: summary.failed,
          skipped: preview.skipped.length,
        }),
      })
    } finally {
      importingRef.current = false
      setImporting(false)
    }
  }

  const sessionSummary = preview && session ? summarizeDbeaverImportSession(preview, session) : null
  const importableConnections = preview && session ? getDbeaverImportableConnections(preview, session) : []
  const importLabel = importing
    ? t('dbeaver.importing')
    : sessionSummary?.pending === 0 && sessionSummary.failed > 0
      ? t('dbeaver.retryFailed')
      : sessionSummary?.pending === 0 && sessionSummary?.failed === 0 && sessionSummary.imported > 0
        ? t('dbeaver.imported')
        : t('dbeaver.import')

  return (
    <SettingsCard title={t('dbeaver.title')} icon={Upload}>
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-2xl text-xs text-muted-foreground">{t('dbeaver.description')}</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={importing}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="size-3.5" />
          {t('dbeaver.choose')}
        </Button>
      </div>
      <input
        ref={fileInputRef}
        className="hidden"
        type="file"
        multiple
        accept=".json,.xml"
        onChange={(event) => {
          void handlePreview(event.target.files)
        }}
      />

      {preview && (
        <div className="grid gap-3 rounded-md border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{preview.sourceName}</div>
              <div className="text-xs text-muted-foreground">
                {t('dbeaver.previewSummary', { supported: preview.connections.length, skipped: preview.skipped.length })}
                {' · '}{t('dbeaver.passwordSummary', { count: preview.passwordEntries })}
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={importing || importableConnections.length === 0}
              onClick={() => {
                void importSupportedConnections()
              }}
            >
              <Save className="size-3.5" />
              {importLabel}
            </Button>
          </div>

          <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))]">
            <PreviewList title={t('dbeaver.previewConnections')}>
              {preview.connections.length === 0 ? (
                <PreviewEmpty label={t('dbeaver.noImportableConnections')} />
              ) : (
                preview.connections.slice(0, 8).map((connection) => (
                  <DbeaverImportPreviewItem
                    key={connection.id}
                    connection={connection}
                    state={session?.[connection.id] ?? { status: 'pending' }}
                    t={t}
                  />
                ))
              )}
            </PreviewList>

            <PreviewList title={t('dbeaver.previewDriverTemplates')}>
              {preview.driverTemplates.map((template) => (
                <div key={template.sourceDriver} className="flex items-center justify-between gap-2 rounded border bg-background/70 px-2 py-1.5 text-xs">
                  <span className="min-w-0 truncate">{template.sourceDriver === 'unknown' ? t('dbeaver.unknownDriver') : template.sourceDriver}</span>
                  <span
                    className={
                      template.status === 'supported'
                        ? 'shrink-0 text-[10px] text-success'
                        : 'shrink-0 text-[10px] text-warning'
                    }
                  >
                    {template.mappedDriverDefinitionId ?? t('dbeaver.unsupported')}
                  </span>
                </div>
              ))}
            </PreviewList>
          </div>

          {preview.skipped.length > 0 && (
            <PreviewList title={t('dbeaver.previewImportReport')}>
              {preview.skipped.slice(0, 6).map((skipped) => (
                <div key={`${skipped.name}:${skipped.sourceDriver}`} className="rounded border border-warning/30 bg-warning-bg px-2 py-1.5 text-xs text-warning-foreground">
                  <div className="truncate font-medium">{skipped.name}</div>
                  <div className="truncate text-[11px]">
                    {t(`dbeaver.${skipped.reason}`)} · {skipped.sourceDriver || t('dbeaver.unknownDriver')}
                  </div>
                </div>
              ))}
            </PreviewList>
          )}

          {report && (
            <div className="rounded border bg-background/70 px-2 py-1.5 text-xs text-muted-foreground">
              {t('dbeaver.importSummary', {
                imported: report.imported,
                failed: report.failed,
                skipped: preview.skipped.length,
              })}
            </div>
          )}
        </div>
      )}
    </SettingsCard>
  )
}

function DbeaverImportPreviewItem({
  connection,
  state,
  t,
}: {
  connection: DbeaverImportPreview['connections'][number]
  state: DbeaverImportItemState
  t: TFunction
}) {
  const statusLabel = {
    pending: t('dbeaver.itemPending'),
    importing: t('dbeaver.itemImporting'),
    succeeded: t('dbeaver.itemImported'),
    failed: t('dbeaver.itemFailed'),
  }[state.status]

  return (
    <div className="rounded border bg-background/70 px-2 py-1.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium">{connection.name}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground">{statusLabel}</span>
      </div>
      <div className="mt-1 truncate text-[11px] text-muted-foreground">
        {connection.host ?? connection.connectionUrl ?? t('dbeaver.urlOnly')}
        {connection.database ? ` / ${connection.database}` : ''} ·{' '}
        {connection.passwordStatus === 'manualEntryRequired'
          ? t('dbeaver.passwordManualEntry')
          : t('dbeaver.noPassword')}
      </div>
      {connection.groupPath && (
        <div className="mt-1 truncate text-[10px] text-muted-foreground">
          {t('connectionForm.group')}: {connection.groupPath}
        </div>
      )}
      {state.status === 'failed' && state.errorMessage && (
        <div className="mt-1 whitespace-pre-wrap break-words text-[10px] text-warning-foreground">
          {state.errorMessage}
        </div>
      )}
    </div>
  )
}

function SettingsNavButton({
  active,
  icon: Icon,
  title,
  detail,
  onClick,
}: {
  active: boolean
  icon: LucideIcon
  title: string
  detail: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={[
        'ide-settings-nav-item mb-0.5 grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors',
        active
          ? 'bg-accent-selected text-accent-foreground shadow-[inset_2px_0_0_hsl(var(--primary))]'
          : 'text-muted-foreground hover:bg-background/75 hover:text-foreground',
      ].join(' ')}
      title={detail}
      onClick={onClick}
    >
      <Icon className="size-3.5" />
      <span className="min-w-0 [overflow-wrap:anywhere] font-medium">{title}</span>
    </button>
  )
}

function SettingsCard({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <section className="grid gap-3 border-t border-border/65 pt-5">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function ThemeButton({
  active,
  label,
  icon: Icon,
  onClick,
}: {
  active: boolean
  label: string
  icon: LucideIcon
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={[
        'flex h-8 items-center justify-center gap-1.5 rounded border text-xs font-medium transition-[color,background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
        active
          ? 'border-primary/35 bg-accent-selected text-accent-foreground shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.12)]'
          : 'border-transparent text-muted-foreground hover:bg-background/75 hover:text-foreground',
      ].join(' ')}
      onClick={onClick}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  )
}

function SegmentButton({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={[
        'h-8 rounded border text-xs font-medium transition-[color,background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
        active
          ? 'border-primary/35 bg-accent-selected text-accent-foreground shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.12)]'
          : 'border-transparent text-muted-foreground hover:bg-background/75 hover:text-foreground',
      ].join(' ')}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function SettingFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-md border bg-background/60 px-3 py-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono text-[11px] text-foreground" title={value}>
        {value}
      </span>
    </div>
  )
}

function NumberSetting({
  label,
  value,
  min,
  max,
  step,
  defaultValue,
  presets,
  showRange = false,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  defaultValue: number
  presets: number[]
  showRange?: boolean
  onChange: (value: number) => void
}) {
  const { t } = useTranslation()
  const normalizedPresets = presets.filter((preset) => preset >= min && preset <= max)

  function changeValue(nextValue: number) {
    if (!Number.isFinite(nextValue)) {
      return
    }
    onChange(Math.min(max, Math.max(min, Math.round(nextValue))))
  }

  return (
    <div className="grid gap-3 border-b border-border-subtle/75 py-3 text-xs last:border-b-0 @min-[1100px]/settings:grid-cols-[minmax(150px,0.7fr)_minmax(220px,1fr)_minmax(180px,auto)] @min-[1100px]/settings:items-center">
      <div className="min-w-0">
        <label className="block truncate font-semibold text-foreground" htmlFor={`setting-${label}`}>
          {label}
        </label>
        <div className="mt-1 text-[11px] text-muted-foreground">
          {t('settings.defaultHint', { value: defaultValue.toLocaleString() })}
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap gap-1.5">
        {normalizedPresets.map((preset) => (
          <button
            key={preset}
            type="button"
            className={[
              'h-7 min-w-14 rounded-md border px-2 font-mono text-[11px] transition-colors',
              value === preset
                ? 'border-primary/55 bg-accent-selected text-accent-foreground'
                : 'bg-surface text-muted-foreground hover:border-border hover:bg-surface-secondary hover:text-foreground',
            ].join(' ')}
            onClick={() => changeValue(preset)}
          >
            {preset.toLocaleString()}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:max-w-72 lg:justify-self-end">
        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap lg:justify-end">
          <input
            id={`setting-${label}`}
            className="h-8 w-28 rounded-md border bg-card px-2 text-right font-mono text-xs outline-none transition-colors focus:border-ring"
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(event) => changeValue(Number(event.target.value))}
          />
          <Button type="button" size="xs" variant="outline" onClick={() => changeValue(defaultValue)}>
            {t('settings.defaultValue')}
          </Button>
        </div>
        {showRange && (
          <input
            className="w-full accent-primary"
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(event) => changeValue(Number(event.target.value))}
          />
        )}
      </div>
    </div>
  )
}

function settingsDraftFromCurrent(
  theme: SettingsDraft['theme'],
  language: string,
  queryMaxRows: number,
  dataPreviewDefaultRows: number,
  editorFontSize: number,
  exportDirectory: string | null,
  maxLiveSessions: number,
  idleReclaimMinutes: number | null,
): SettingsDraft {
  return {
    theme,
    language: normalizedLanguage(language),
    queryMaxRows,
    dataPreviewDefaultRows,
    editorFontSize,
    exportDirectory,
    maxLiveSessions,
    idleReclaimMinutes,
  }
}

function normalizedLanguage(language: string): SettingsDraft['language'] {
  return language.startsWith('en') ? 'en' : 'zh'
}

function PreviewList({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <div className="text-[11px] font-medium text-muted-foreground">{title}</div>
      {children}
    </div>
  )
}

function PreviewEmpty({ label }: { label: string }) {
  return <div className="rounded border border-dashed px-2 py-2 text-center text-xs text-muted-foreground">{label}</div>
}
