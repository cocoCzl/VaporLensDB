import {
  Check,
  Database,
  Download,
  HardDrive,
  Loader2,
  Moon,
  Plus,
  Save,
  Search,
  Settings,
  Sun,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { downloadDir, join } from '@tauri-apps/api/path'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  dbeaverPreviewToConnectionInput,
  previewDbeaverConfiguration,
  type DbeaverImportPreview,
} from '@/lib/dbeaverImport'
import { normalizeAppError } from '@/ipc/client'
import { exportDiagnosticsPackage } from '@/ipc/diagnostics'
import { healthCheck, type HealthCheckResponse } from '@/ipc/health'
import { useConnectionStore } from '@/stores/connectionStore'
import { useDriverStore } from '@/stores/driverStore'
import { useQueryHistoryStore } from '@/stores/queryHistoryStore'
import { useUiStore } from '@/stores/uiStore'
import type { ConnectionInput } from '@/types/connection'
import type { DriverDefinition } from '@/types/driver'
import type { LucideIcon } from 'lucide-react'

type SettingsSection = 'general' | 'drivers' | 'import' | 'diagnostics'
type SettingsDraft = {
  theme: 'light' | 'dark' | 'system'
  language: 'zh' | 'en'
  queryMaxRows: number
  dataPreviewDefaultRows: number
  editorFontSize: number
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
  const notify = useUiStore((state) => state.notify)
  const notifyError = useUiStore((state) => state.notifyError)
  const history = useQueryHistoryStore((state) => state.entries)
  const historyLoading = useQueryHistoryStore((state) => state.loading)
  const loadHistory = useQueryHistoryStore((state) => state.loadHistory)
  const clearHistory = useQueryHistoryStore((state) => state.clear)
  const [activeSection, setActiveSection] = useState<SettingsSection>('general')
  const [confirmClearHistory, setConfirmClearHistory] = useState(false)
  const [includeDiagnosticsSqlText, setIncludeDiagnosticsSqlText] = useState(false)
  const [diagnosticsExporting, setDiagnosticsExporting] = useState(false)
  const [health, setHealth] = useState<HealthCheckResponse | null>(null)
  const [healthUnavailable, setHealthUnavailable] = useState(false)
  const [draft, setDraft] = useState<SettingsDraft>(() =>
    settingsDraftFromCurrent(theme, i18n.language, queryMaxRows, dataPreviewDefaultRows, editorFontSize),
  )
  const hasSettingsChanges =
    draft.theme !== theme ||
    draft.language !== normalizedLanguage(i18n.language) ||
    draft.queryMaxRows !== queryMaxRows ||
    draft.dataPreviewDefaultRows !== dataPreviewDefaultRows ||
    draft.editorFontSize !== editorFontSize

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
      const baseDir = await downloadDir()
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

  function updateDraft(patch: Partial<SettingsDraft>) {
    setDraft((current) => ({ ...current, ...patch }))
  }

  function discardSettingsDraft() {
    setDraft(settingsDraftFromCurrent(theme, i18n.language, queryMaxRows, dataPreviewDefaultRows, editorFontSize))
  }

  function restoreDefaultSettingsDraft() {
    setDraft((current) => ({
      ...current,
      queryMaxRows: DEFAULT_QUERY_MAX_ROWS,
      dataPreviewDefaultRows: DEFAULT_DATA_PREVIEW_ROWS,
      editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
    }))
  }

  function applySettingsDraft() {
    setTheme(draft.theme)
    setQueryMaxRows(draft.queryMaxRows)
    setDataPreviewDefaultRows(draft.dataPreviewDefaultRows)
    setEditorFontSize(draft.editorFontSize)
    window.localStorage.setItem('vaporlensdb.language', draft.language)
    void i18n.changeLanguage(draft.language)
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{t('settings.title')}</h1>
          <p className="truncate text-xs text-muted-foreground">{t('settings.subtitle')}</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="grid min-h-full grid-cols-[220px_minmax(0,1fr)]">
          <nav className="border-r bg-card/50 p-3">
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

          <div className="min-w-0 p-6">
            {activeSection === 'general' && (
              <div className="mx-auto grid max-w-5xl gap-4">
                <div className="flex min-h-10 items-center justify-between gap-3 rounded-md border bg-card/60 px-3 py-2 text-xs">
                  <span className={hasSettingsChanges ? 'text-amber-600' : 'text-muted-foreground'}>
                    {hasSettingsChanges ? t('settings.unsavedChanges') : t('settings.noUnsavedChanges')}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="rounded-full px-3 text-muted-foreground hover:bg-muted/70 hover:text-foreground"
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
                      className="rounded-full border-border/80 bg-background/70 px-3 shadow-sm hover:bg-muted/70"
                      onClick={restoreDefaultSettingsDraft}
                    >
                      {t('settings.restoreDefaults')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="rounded-full px-3 shadow-sm"
                      disabled={!hasSettingsChanges}
                      onClick={applySettingsDraft}
                    >
                      <Check className="size-3.5" />
                      {t('settings.apply')}
                    </Button>
                  </div>
                </div>
                <SettingsCard title={t('settings.theme.label')} icon={Settings}>
                  <div className="grid grid-cols-3 gap-0.5 rounded-md border bg-muted/35 p-0.5 shadow-inner shadow-black/[0.025]">
                    <ThemeButton active={draft.theme === 'system'} label={t('settings.theme.system')} icon={Settings} onClick={() => updateDraft({ theme: 'system' })} />
                    <ThemeButton active={draft.theme === 'dark'} label={t('settings.theme.dark')} icon={Moon} onClick={() => updateDraft({ theme: 'dark' })} />
                    <ThemeButton active={draft.theme === 'light'} label={t('settings.theme.light')} icon={Sun} onClick={() => updateDraft({ theme: 'light' })} />
                  </div>
                  <div className="grid gap-1 text-xs">
                    <span className="font-semibold text-foreground">{t('settings.language.label')}</span>
                    <div className="grid grid-cols-2 gap-0.5 rounded-md border bg-muted/35 p-0.5 shadow-inner shadow-black/[0.025]">
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

                <SettingsCard title={t('sql.history')} icon={Trash2}>
                  <div className="flex items-center justify-between gap-3 rounded-md border bg-background/60 p-3 text-xs">
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
                  <div className="grid gap-2 md:grid-cols-2">
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

function DriverDefinitionsSettings() {
  const { t } = useTranslation()
  const drivers = useDriverStore((state) => state.drivers)
  const loading = useDriverStore((state) => state.loading)
  const loadDrivers = useDriverStore((state) => state.loadDrivers)
  const saveDriver = useDriverStore((state) => state.saveDriver)
  const deleteDriver = useDriverStore((state) => state.deleteDriver)
  const importJdbcArtifacts = useDriverStore((state) => state.importJdbcArtifacts)
  const removeJdbcArtifact = useDriverStore((state) => state.removeJdbcArtifact)
  const validateDriver = useDriverStore((state) => state.validateDriver)
  const [editing, setEditing] = useState<DriverDefinition | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [artifactPathInput, setArtifactPathInput] = useState('')
  const [validationMessage, setValidationMessage] = useState<{ valid: boolean; message: string } | null>(null)
  const [query, setQuery] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    void loadDrivers()
  }, [loadDrivers])

  const jdbcDrivers = useMemo(
    () => drivers.filter((driver) => isVisibleJdbcDriver(driver)),
    [drivers],
  )
  const filteredDrivers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) {
      return jdbcDrivers
    }
    return jdbcDrivers.filter((driver) =>
      [driver.name, driver.driverType, driver.backend, driver.status, driver.jdbcDriverClass, driver.urlTemplate]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery),
    )
  }, [jdbcDrivers, query])

  async function handleSave() {
    if (!editing || !editing.name.trim()) {
      return
    }
    const saved = await saveDriver(normalizeDriverDefinition(editing))
    if (saved) {
      setEditing(saved)
      setValidationMessage(null)
    }
  }

  async function handleImportJdbcArtifacts(files: FileList | null) {
    if (!editing || !canManageJdbcArtifacts(editing) || !files?.length) {
      return
    }
    const paths = Array.from(files)
      .map((file) => filePath(file))
      .filter(Boolean)
    const saved = await importJdbcArtifacts(editing.id, paths)
    if (saved) {
      setEditing(saved)
      setValidationMessage(null)
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  async function handleRemoveJdbcArtifact(path: string) {
    if (!editing || !canManageJdbcArtifacts(editing)) {
      return
    }
    const saved = await removeJdbcArtifact(editing.id, path)
    if (saved) {
      setEditing(saved)
      setValidationMessage(null)
    }
  }

  async function handleImportJdbcArtifactPaths() {
    if (!editing || !canManageJdbcArtifacts(editing) || !editing.id) {
      return
    }
    const paths = artifactPathInput
      .split(/\r?\n/)
      .map((path) => path.trim())
      .filter(Boolean)
    if (paths.length === 0) {
      return
    }
    const saved = await importJdbcArtifacts(editing.id, paths)
    if (saved) {
      setEditing(saved)
      setArtifactPathInput('')
      setValidationMessage(null)
    }
  }

  async function handleValidateDriver() {
    if (!editing || editing.driverType === 'postgres' || editing.driverType === 'mysql') {
      return
    }
    const result = await validateDriver(normalizeDriverDefinition(editing))
    setValidationMessage(result)
  }

  async function handleDelete(driver: DriverDefinition) {
    if (driver.builtIn || loading) {
      return
    }
    if (confirmDeleteId !== driver.id) {
      setConfirmDeleteId(driver.id)
      window.setTimeout(() => setConfirmDeleteId(null), 3000)
      return
    }
    const deleted = await deleteDriver(driver.id)
    if (deleted) {
      setConfirmDeleteId(null)
      if (editing?.id === driver.id) {
        setEditing(null)
      }
    }
  }

  function createCustomDriver() {
    setEditing(newCustomDriverDefinition())
    setArtifactPathInput('')
    setValidationMessage(null)
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{t('drivers.title')}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('drivers.summary', { count: jdbcDrivers.length })}
          </p>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={createCustomDriver}>
          <Plus className="size-3.5" />
          {t('drivers.add')}
        </Button>
      </div>

      <div className="grid min-h-[640px] grid-cols-[320px_minmax(0,1fr)] overflow-hidden rounded-md border bg-card">
        <aside className="flex min-h-0 flex-col border-r">
          <div className="shrink-0 border-b p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-8 pl-8 text-xs"
                value={query}
                placeholder={t('drivers.search')}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            <div className="grid gap-1">
              {filteredDrivers.map((driver) => (
                <button
                  key={driver.id}
                  type="button"
                  className={[
                    'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-2 py-2 text-left text-xs transition-colors',
                    editing?.id === driver.id
                      ? 'border-primary bg-primary/10'
                      : 'border-transparent bg-background/60 hover:border-border hover:bg-muted/55',
                  ].join(' ')}
                  onClick={() => {
                    setEditing(driver)
                    setArtifactPathInput('')
                    setValidationMessage(null)
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{driver.name}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {driverRuntimeLabel(driver)} · {driver.status}
                    </span>
                  </span>
                  <span className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {driverOriginLabel(driver, t)}
                  </span>
                </button>
              ))}
              {filteredDrivers.length === 0 && (
                <div className="rounded-md border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">
                  {t('drivers.noMatches')}
                </div>
              )}
            </div>
          </div>
        </aside>

        <div className="min-h-0 overflow-auto p-4">
          {editing ? (
            <DriverDefinitionEditor
              driver={editing}
              loading={loading}
              confirmDelete={confirmDeleteId === editing.id}
              artifactPathInput={artifactPathInput}
              validationMessage={validationMessage}
              fileInputRef={fileInputRef}
              onChange={setEditing}
              onClose={() => setEditing(null)}
              onArtifactPathInputChange={setArtifactPathInput}
              onImportJdbcArtifacts={handleImportJdbcArtifacts}
              onRemoveJdbcArtifact={handleRemoveJdbcArtifact}
              onImportJdbcArtifactPaths={handleImportJdbcArtifactPaths}
              onValidate={handleValidateDriver}
              onDelete={handleDelete}
              onSave={handleSave}
            />
          ) : (
            <div className="grid h-full min-h-96 place-items-center rounded-md border border-dashed text-center">
              <div className="px-6">
                <HardDrive className="mx-auto mb-2 size-8 text-muted-foreground" />
                <div className="text-sm font-medium">{t('drivers.emptySelection')}</div>
                <p className="mt-1 text-xs text-muted-foreground">{t('drivers.emptySelectionHint')}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DriverDefinitionEditor({
  driver,
  loading,
  confirmDelete,
  artifactPathInput,
  validationMessage,
  fileInputRef,
  onChange,
  onClose,
  onArtifactPathInputChange,
  onImportJdbcArtifacts,
  onRemoveJdbcArtifact,
  onImportJdbcArtifactPaths,
  onValidate,
  onDelete,
  onSave,
}: {
  driver: DriverDefinition
  loading: boolean
  confirmDelete: boolean
  artifactPathInput: string
  validationMessage: { valid: boolean; message: string } | null
  fileInputRef: MutableRefObject<HTMLInputElement | null>
  onChange: (driver: DriverDefinition) => void
  onClose: () => void
  onArtifactPathInputChange: (value: string) => void
  onImportJdbcArtifacts: (files: FileList | null) => Promise<void>
  onRemoveJdbcArtifact: (path: string) => Promise<void>
  onImportJdbcArtifactPaths: () => Promise<void>
  onValidate: () => Promise<void>
  onDelete: (driver: DriverDefinition) => Promise<void>
  onSave: () => Promise<void>
}) {
  const { t } = useTranslation()
  const readOnly = driver.builtIn
  const canManageArtifacts = canManageJdbcArtifacts(driver)

  return (
    <div className="grid gap-4">
      <div className="flex items-start justify-between gap-3 border-b pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <HardDrive className="size-4 text-primary" />
            <h3 className="truncate text-sm font-semibold">
              {readOnly ? t('drivers.viewBuiltIn') : t('drivers.editCustom')}
            </h3>
            <span className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {driverOriginLabel(driver, t)}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {readOnly ? t('drivers.builtInHint') : t('drivers.customHint')}
          </p>
        </div>
        <Button type="button" size="icon-sm" variant="ghost" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DriverField label={t('drivers.name')}>
          <input
            className="ide-input"
            value={driver.name}
            disabled={readOnly}
            onChange={(event) => onChange({ ...driver, name: event.target.value })}
          />
        </DriverField>
        <DriverField label={t('drivers.runtime')}>
          <div className="flex h-8 items-center rounded-md border bg-muted/35 px-2 text-sm text-muted-foreground">
            {driverRuntimeLabel(driver)}
          </div>
        </DriverField>
        <DriverField label={t('drivers.driverClass')}>
          <input
            className="ide-input"
            value={driver.jdbcDriverClass ?? ''}
            disabled={readOnly}
            onChange={(event) => onChange({ ...driver, jdbcDriverClass: event.target.value })}
          />
        </DriverField>
        <DriverField label={t('drivers.urlTemplate')}>
          <input
            className="ide-input"
            value={driver.urlTemplate ?? ''}
            disabled={readOnly}
            onChange={(event) => onChange({ ...driver, urlTemplate: event.target.value })}
          />
        </DriverField>
      </div>

      <SettingsCard title={t('drivers.driverFiles')} icon={Upload}>
        <input
          ref={fileInputRef}
          className="hidden"
          type="file"
          accept=".jar,application/java-archive"
          multiple
          onChange={(event) => {
            void onImportJdbcArtifacts(event.target.files)
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canManageArtifacts || loading || !driver.id}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="size-3.5" />
            {t('drivers.importJar')}
          </Button>
          <span className="text-xs text-muted-foreground">
            {driver.driverArtifacts.length
              ? t('drivers.managedJarCount', { count: driver.driverArtifacts.length })
              : t('drivers.noneImported')}
          </span>
        </div>

        {driver.driverArtifacts.length > 0 && (
          <div className="grid gap-1">
            {driver.driverArtifacts.map((path) => (
              <div
                key={path}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded border bg-background/70 px-2 py-1"
              >
                <span className="truncate font-mono text-xs" title={path}>
                  {fileName(path)}
                </span>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  disabled={!canManageArtifacts || loading}
                  title={t('drivers.removeJar')}
                  onClick={() => {
                    void onRemoveJdbcArtifact(path)
                  }}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {canManageArtifacts && (
          <div className="grid gap-2">
            <textarea
              className="ide-input min-h-20 resize-y text-xs"
              value={artifactPathInput}
              placeholder="/absolute/path/to/vendor-driver.jar"
              onChange={(event) => onArtifactPathInputChange(event.target.value)}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-fit"
              disabled={loading || !driver.id || !artifactPathInput.trim()}
              onClick={() => {
                void onImportJdbcArtifactPaths()
              }}
            >
              <Upload className="size-3.5" />
              {t('drivers.importPath')}
            </Button>
          </div>
        )}
      </SettingsCard>

      <DriverField label={t('drivers.metadataSql')}>
        <textarea
          className="ide-input min-h-36 resize-y font-mono text-xs"
          value={driver.metadataDialectSql ?? ''}
          disabled={readOnly}
          onChange={(event) => onChange({ ...driver, metadataDialectSql: event.target.value })}
        />
      </DriverField>

      {!readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={() => {
                void onValidate()
              }}
            >
              <HardDrive className="size-3.5" />
              {t('drivers.validate')}
            </Button>
            {validationMessage && (
              <div
                className={[
                  'rounded border px-2 py-1 text-xs',
                  validationMessage.valid
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'
                    : 'border-destructive/35 bg-destructive/10 text-destructive',
                ].join(' ')}
              >
                {validationMessage.message}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant={confirmDelete ? 'destructive' : 'outline'}
              disabled={loading || !driver.id}
              onClick={() => {
                void onDelete(driver)
              }}
            >
              <Trash2 className="size-3.5" />
              {confirmDelete ? t('common.confirm') : t('common.delete')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={loading || !driver.name.trim()}
              onClick={() => {
                void onSave()
              }}
            >
              <Save className="size-3.5" />
              {t('common.save')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function DbeaverImportSettings({
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
  const [importing, setImporting] = useState(false)
  const [report, setReport] = useState<{ imported: number; failed: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  async function handlePreview(files: FileList | null) {
    setReport(null)
    if (!files?.length) {
      return
    }

    try {
      const nextPreview = await previewDbeaverConfiguration(Array.from(files))
      setPreview(nextPreview)
      onNotify({
        kind: nextPreview.connections.length > 0 ? 'info' : 'warning',
        title: t('dbeaver.previewComplete'),
        message: `${nextPreview.connections.length} supported / ${nextPreview.skipped.length} skipped`,
      })
    } catch (error) {
      setPreview(null)
      onNotifyError(
        {
          code: 'DBEAVER_IMPORT_PREVIEW_FAILED',
          message: error instanceof Error ? error.message : t('dbeaver.previewFailedMessage'),
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
    if (!preview || preview.connections.length === 0) {
      return
    }

    setImporting(true)
    let imported = 0
    let failed = 0
    for (const connection of preview.connections) {
      try {
        await onImportConnection(dbeaverPreviewToConnectionInput(connection))
        imported += 1
      } catch {
        failed += 1
      }
    }
    setImporting(false)
    setReport({ imported, failed })
    onNotify({
      kind: failed === 0 ? 'success' : 'warning',
      title: t('dbeaver.importComplete'),
      message: `${imported} imported / ${failed} failed / ${preview.skipped.length} skipped`,
    })
  }

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
                {preview.connections.length} supported · {preview.skipped.length} skipped ·{' '}
                {preview.passwordEntries} passwords need manual entry
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={importing || preview.connections.length === 0}
              onClick={() => {
                void importSupportedConnections()
              }}
            >
              <Save className="size-3.5" />
              {importing ? t('dbeaver.importing') : t('dbeaver.import')}
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <PreviewList title="Connections">
              {preview.connections.length === 0 ? (
                <PreviewEmpty label={t('dbeaver.noImportableConnections')} />
              ) : (
                preview.connections.slice(0, 8).map((connection) => (
                  <div key={connection.id} className="rounded border bg-background/70 px-2 py-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">{connection.name}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {connection.driverType}
                      </span>
                    </div>
                    <div className="mt-1 truncate text-[11px] text-muted-foreground">
                      {connection.host ?? connection.connectionUrl ?? 'URL only'}
                      {connection.database ? ` / ${connection.database}` : ''} ·{' '}
                      {connection.passwordStatus === 'manualEntryRequired'
                        ? 'password manual entry'
                        : 'no password'}
                    </div>
                  </div>
                ))
              )}
            </PreviewList>

            <PreviewList title="Driver templates">
              {preview.driverTemplates.map((template) => (
                <div key={template.sourceDriver} className="flex items-center justify-between gap-2 rounded border bg-background/70 px-2 py-1.5 text-xs">
                  <span className="min-w-0 truncate">{template.sourceDriver}</span>
                  <span
                    className={
                      template.status === 'supported'
                        ? 'shrink-0 text-[10px] text-emerald-600'
                        : 'shrink-0 text-[10px] text-amber-600'
                    }
                  >
                    {template.mappedDriverDefinitionId ?? 'unsupported'}
                  </span>
                </div>
              ))}
            </PreviewList>
          </div>

          {preview.skipped.length > 0 && (
            <PreviewList title="Import report">
              {preview.skipped.slice(0, 6).map((skipped) => (
                <div key={`${skipped.name}:${skipped.sourceDriver}`} className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700">
                  <div className="truncate font-medium">{skipped.name}</div>
                  <div className="truncate text-[11px]">
                    {skipped.reason} · {skipped.sourceDriver ?? 'unknown'}
                  </div>
                </div>
              ))}
            </PreviewList>
          )}

          {report && (
            <div className="rounded border bg-background/70 px-2 py-1.5 text-xs text-muted-foreground">
              Import report: {report.imported} imported / {report.failed} failed /{' '}
              {preview.skipped.length} skipped.
            </div>
          )}
        </div>
      )}
    </SettingsCard>
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
        'mb-1 grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors',
        active
          ? 'bg-primary/15 text-primary ring-1 ring-primary/30'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      ].join(' ')}
      onClick={onClick}
    >
      <Icon className="size-4" />
      <span className="min-w-0">
        <span className="block truncate font-semibold">{title}</span>
        <span className="block truncate text-[11px] opacity-75">{detail}</span>
      </span>
    </button>
  )
}

function SettingsCard({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <section className="grid gap-3 rounded-md border bg-card p-4">
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
        'flex h-9 items-center justify-center gap-1.5 rounded-[calc(var(--radius)-2px)] border text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
        active
          ? 'border-primary/35 bg-primary/15 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.12)]'
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
        'h-9 rounded-[calc(var(--radius)-2px)] border text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
        active
          ? 'border-primary/35 bg-primary/15 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.12)]'
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
    <div className="grid gap-3 rounded-md border bg-background/65 px-3 py-3 text-xs shadow-sm ring-1 ring-transparent transition-colors hover:border-border/80 hover:bg-background/85 lg:grid-cols-[minmax(150px,0.7fr)_minmax(220px,1fr)_minmax(180px,auto)] lg:items-center">
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
                ? 'border-primary/55 bg-primary/15 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.18)]'
                : 'bg-card/70 text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground',
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
): SettingsDraft {
  return {
    theme,
    language: normalizedLanguage(language),
    queryMaxRows,
    dataPreviewDefaultRows,
    editorFontSize,
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

function DriverField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function newCustomDriverDefinition(): DriverDefinition {
  return {
    id: '',
    driverType: 'jdbc',
    name: 'Custom JDBC',
    backend: 'jdbc',
    status: 'configurable',
    defaultPort: null,
    defaultUsername: null,
    defaultDatabase: null,
    jdbcDriverClass: '',
    urlTemplate: 'jdbc:vendor://{host}:{port}/{database}',
    driverArtifact: '*.jar',
    driverArtifacts: [],
    userDriverRequired: true,
    builtIn: false,
    notes: '',
    connectionVariants: [{ id: 'urlOnly', label: 'URL only', requiredFields: ['connectionUrl'] }],
    metadataDialectSql: '',
    capabilities: {
      canConnect: true,
      canQuery: true,
      canStream: false,
      canReadMetadata: false,
      canCancel: false,
      canGenerateDdl: false,
    },
  }
}

function isVisibleJdbcDriver(driver: DriverDefinition) {
  return driver.backend === 'jdbc' && driver.status !== 'planned'
}

function canManageJdbcArtifacts(driver: DriverDefinition) {
  return driver.backend === 'jdbc' && (driver.driverType === 'jdbc' || driver.driverType === 'oracle')
}

function driverOriginLabel(driver: DriverDefinition, t: ReturnType<typeof useTranslation>['t']) {
  return driver.builtIn ? t('drivers.builtInTemplate') : t('drivers.customTemplate')
}

function driverRuntimeLabel(driver: DriverDefinition) {
  return driver.backend === 'jdbc' ? 'JDBC' : driver.backend
}

function normalizeDriverDefinition(driver: DriverDefinition): DriverDefinition {
  return {
    ...driver,
    name: driver.name.trim(),
    backend: 'jdbc',
    jdbcDriverClass: nullableText(driver.jdbcDriverClass),
    urlTemplate: nullableText(driver.urlTemplate),
    driverArtifact: driver.driverArtifacts.length
      ? driver.driverArtifacts.map(fileName).join(', ')
      : nullableText(driver.driverArtifact),
    driverArtifacts: driver.driverArtifacts,
    notes: nullableText(driver.notes),
    metadataDialectSql: nullableText(driver.metadataDialectSql),
    userDriverRequired: true,
    builtIn: false,
    status: 'configurable',
    connectionVariants: driver.connectionVariants.length
      ? driver.connectionVariants
      : [{ id: 'urlOnly', label: 'URL only', requiredFields: ['connectionUrl'] }],
  }
}

function nullableText(value: string | null | undefined) {
  return value?.trim() ? value.trim() : null
}

function filePath(file: File) {
  const tauriFile = file as File & { path?: string }
  return tauriFile.path || file.name
}

function fileName(path: string) {
  return path.split(/[\\/]/).pop() || path
}
