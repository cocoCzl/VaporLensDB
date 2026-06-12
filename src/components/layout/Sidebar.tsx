import {
  Activity,
  Ban,
  Database,
  Download,
  FileCode2,
  HardDrive,
  Loader2,
  Moon,
  Plus,
  Save,
  Settings,
  Square,
  Sun,
  TerminalSquare,
  Trash2,
  Unplug,
  Upload,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { downloadDir, join } from '@tauri-apps/api/path'
import { ConnectionList } from '@/components/connection/ConnectionList'
import { DatabaseTree } from '@/components/explorer/DatabaseTree'
import { Button } from '@/components/ui/button'
import { useQuery } from '@/hooks/useQuery'
import {
  dbeaverPreviewToConnectionInput,
  previewDbeaverConfiguration,
  type DbeaverImportPreview,
} from '@/lib/dbeaverImport'
import { exportDiagnosticsPackage } from '@/ipc/diagnostics'
import { normalizeAppError } from '@/ipc/client'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import { useDriverStore } from '@/stores/driverStore'
import { useQueryHistoryStore } from '@/stores/queryHistoryStore'
import { useUiStore } from '@/stores/uiStore'
import type { ConnectionInput, DriverType } from '@/types/connection'
import type { DriverDefinition } from '@/types/driver'
import type { LucideIcon } from 'lucide-react'

const RAIL_ITEMS = [
  { view: 'dataSources', icon: Database, labelKey: 'nav.dataSources' },
  { view: 'sql', icon: FileCode2, labelKey: 'nav.sql' },
  { view: 'sessions', icon: Activity, labelKey: 'nav.sessions' },
] as const

export function Sidebar() {
  const { t } = useTranslation()
  const sidebarView = useUiStore((state) => state.sidebarView)
  const setSidebarView = useUiStore((state) => state.setSidebarView)

  return (
    <aside className="flex w-[348px] shrink-0 border-r bg-card">
      <nav className="flex w-12 flex-col items-center gap-1 border-r bg-muted/45 py-2">
        {RAIL_ITEMS.map((item) => (
          <RailButton
            key={item.view}
            active={sidebarView === item.view}
            icon={item.icon}
            label={t(item.labelKey)}
            onClick={() => setSidebarView(item.view)}
          />
        ))}
        <div className="flex-1" />
        <RailButton
          active={sidebarView === 'settings'}
          icon={Settings}
          label={t('nav.settings')}
          onClick={() => setSidebarView('settings')}
        />
      </nav>
      <SidebarPanel />
    </aside>
  )
}

function SidebarPanel() {
  const sidebarView = useUiStore((state) => state.sidebarView)

  if (sidebarView === 'sql') {
    return <SqlWorkspacePanel />
  }

  if (sidebarView === 'sessions') {
    return <SessionManagementPanel />
  }

  if (sidebarView === 'settings') {
    return <SettingsPanel />
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ConnectionList />
      <DatabaseTree />
    </div>
  )
}

function RailButton({
  active = false,
  icon: Icon,
  label,
  onClick,
}: {
  active?: boolean
  icon: LucideIcon
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={[
        'grid size-9 place-items-center rounded-md text-muted-foreground transition-colors',
        active
          ? 'bg-primary/15 text-primary ring-1 ring-primary/35'
          : 'hover:bg-accent hover:text-accent-foreground',
      ].join(' ')}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon className="size-5" />
    </button>
  )
}

function SqlWorkspacePanel() {
  const { t } = useTranslation()
  const { tabs, activeTabId, setActiveTab, addTab } = useEditorStore()
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId)
  const setActiveConnection = useConnectionStore((state) => state.setActiveConnection)
  const history = useQueryHistoryStore((state) => state.entries)
  const clearHistory = useQueryHistoryStore((state) => state.clear)
  const loadHistory = useQueryHistoryStore((state) => state.loadHistory)
  const historyLoading = useQueryHistoryStore((state) => state.loading)
  const notify = useUiStore((state) => state.notify)
  const [confirmClearHistory, setConfirmClearHistory] = useState(false)

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  function createTab() {
    addTab({
      id: crypto.randomUUID(),
      kind: 'sql',
      title: `SQL ${tabs.length + 1}`,
      sql: '',
      connectionId: activeConnectionId,
    })
  }

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

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PanelHeader
        title={t('sql.workspace')}
        subtitle={t('sql.editorPageCount', { count: tabs.length })}
        icon={TerminalSquare}
      />
      <div className="border-b p-2">
        <Button type="button" size="sm" variant="secondary" className="w-full" onClick={createTab}>
          <Plus className="size-3.5" />
          {t('sql.new')}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {tabs.length === 0 ? (
          <EmptyPanel icon={FileCode2} title={t('sql.emptyTitle')} text={t('sql.emptyText')} />
        ) : (
          <div className="space-y-1">
            {tabs.map((tab) => {
              const active = tab.id === activeTabId
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={[
                    'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors',
                    active
                      ? 'bg-primary/15 text-primary ring-1 ring-primary/25'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  ].join(' ')}
                  onClick={() => {
                    setActiveTab(tab.id)
                    setActiveConnection(tab.connectionId)
                  }}
                >
                  <FileCode2 className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{tab.title}</span>
                    <span className="block truncate opacity-75">
                      {tab.running ? t('sql.running') : sqlPreview(tab.sql, t)}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
        <div className="mt-4 border-t pt-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold">{t('sql.history')}</h3>
            <Button
              type="button"
              size="icon-xs"
              variant={confirmClearHistory ? 'destructive' : 'ghost'}
              title={confirmClearHistory ? t('sql.confirmClearHistory') : t('sql.clearHistory')}
              disabled={history.length === 0 || historyLoading}
              onClick={() => {
                void handleClearHistory()
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
          {history.length === 0 ? (
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              {t('sql.historyEmpty')}
            </div>
          ) : (
            <div className="space-y-1">
              {history.slice(0, 25).map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="w-full rounded-md border bg-background/60 px-2 py-1.5 text-left text-xs hover:bg-muted"
                  onClick={() => {
                    setActiveConnection(entry.connectionId)
                    addTab({
                      id: crypto.randomUUID(),
                      kind: 'sql',
                      title: t('sql.historyTabTitle'),
                      sql: entry.sql,
                      connectionId: entry.connectionId,
                    })
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[11px]">{sqlPreview(entry.sql, t)}</span>
                    <span
                      className={
                        entry.status === 'success'
                          ? 'shrink-0 text-emerald-500'
                          : 'shrink-0 text-destructive'
                      }
                    >
                      {entry.status === 'success' ? 'OK' : 'ERR'}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                      {formatHistoryTime(entry.startedAt)}
                      {entry.elapsedMs ? ` · ${entry.elapsedMs} ms` : ''}
                      {entry.rowCount != null ? ` · ${t('sql.rows', { count: entry.rowCount })}` : ''}
                      {entry.affectedRows != null ? ` · ${t('sql.affectedRows', { count: entry.affectedRows })}` : ''}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SessionManagementPanel() {
  const { t } = useTranslation()
  const connections = useConnectionStore((state) => state.connections)
  const statuses = useConnectionStore((state) => state.statuses)
  const disconnectConnection = useConnectionStore((state) => state.disconnectConnection)
  const setActiveConnection = useConnectionStore((state) => state.setActiveConnection)
  const { tabs, setActiveTab } = useEditorStore()
  const { cancelRunningQuery } = useQuery()
  const notify = useUiStore((state) => state.notify)
  const [busyConnectionId, setBusyConnectionId] = useState<string | null>(null)

  const runtimeSessions = connections
    .map((connection) => ({
      connection,
      status: statuses[connection.id]?.status ?? 'disconnected',
      message: statuses[connection.id]?.message ?? null,
      runningTabs: tabs.filter(
        (tab) => tab.connectionId === connection.id && Boolean(tab.runningQueryId),
      ),
    }))
    .filter(
      (session) =>
        session.status !== 'disconnected' ||
        session.runningTabs.length > 0,
    )

  const runningQueryCount = runtimeSessions.reduce(
    (count, session) => count + session.runningTabs.length,
    0,
  )

  async function handleDisconnect(connectionId: string) {
    setBusyConnectionId(connectionId)
    try {
      await disconnectConnection(connectionId)
      notify({ kind: 'info', title: t('sessions.disconnected') })
    } finally {
      setBusyConnectionId(null)
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PanelHeader
        title={t('sessions.title')}
        subtitle={t('sessions.subtitle', {
          sessions: runtimeSessions.length,
          queries: runningQueryCount,
        })}
        icon={Activity}
      />
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {runtimeSessions.length === 0 ? (
          <EmptyPanel icon={Activity} title={t('sessions.emptyTitle')} text={t('sessions.emptyText')} />
        ) : (
          <div className="space-y-2">
            {runtimeSessions.map(({ connection, status, message, runningTabs }) => {
              const canCancel = driverCanCancel(connection.driverType)
              const disconnecting = busyConnectionId === connection.id
              return (
                <section key={connection.id} className="rounded-md border bg-background/70">
                  <div className="flex items-start justify-between gap-2 border-b px-2 py-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setActiveConnection(connection.id)}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={sessionStatusClass(status)} />
                        <span className="min-w-0 truncate text-xs font-semibold">
                          {connection.name}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-[11px] text-muted-foreground">
                        {connection.driverType} · {status}
                        {message ? ` · ${message}` : ''}
                      </div>
                    </button>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      title={t('sessions.disconnect')}
                      disabled={disconnecting || status === 'disconnected'}
                      onClick={() => {
                        void handleDisconnect(connection.id)
                      }}
                    >
                      {disconnecting ? <Loader2 className="animate-spin" /> : <Unplug />}
                    </Button>
                  </div>
                  <div className="grid gap-1 p-2">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span>Running queries</span>
                      <span>
                        {runningTabs.length > 0
                          ? `${runningTabs.length} active`
                          : canCancel
                            ? 'none'
                            : 'unavailable'}
                      </span>
                    </div>
                    {runningTabs.length === 0 ? (
                      <div className="rounded border border-dashed px-2 py-2 text-[11px] text-muted-foreground">
                        {canCancel
                          ? t('sessions.noRunningQueries')
                          : t('sessions.runningQueriesUnavailable')}
                      </div>
                    ) : (
                      runningTabs.map((tab) => (
                        <div
                          key={tab.id}
                          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded border px-2 py-1.5"
                        >
                          <button
                            type="button"
                            className="min-w-0 text-left"
                            onClick={() => {
                              setActiveTab(tab.id)
                              setActiveConnection(connection.id)
                            }}
                          >
                            <span className="block truncate text-xs font-medium">{tab.title}</span>
                            <span className="block truncate font-mono text-[11px] text-muted-foreground">
                              {sqlPreview(tab.sql, t)}
                            </span>
                          </button>
                          <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost"
                            title={canCancel ? t('editor.cancel') : t('sessions.cancelUnsupported')}
                            disabled={!canCancel || !tab.runningQueryId}
                            onClick={() => {
                              if (tab.runningQueryId) {
                                void cancelRunningQuery(tab.id, connection.id, tab.runningQueryId)
                              }
                            }}
                          >
                            {canCancel ? <Square /> : <Ban />}
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function SettingsPanel() {
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
  const showSystemObjects = useUiStore((state) => state.showSystemObjects)
  const setShowSystemObjects = useUiStore((state) => state.setShowSystemObjects)
  const notify = useUiStore((state) => state.notify)
  const notifyError = useUiStore((state) => state.notifyError)
  const history = useQueryHistoryStore((state) => state.entries)
  const historyLoading = useQueryHistoryStore((state) => state.loading)
  const loadHistory = useQueryHistoryStore((state) => state.loadHistory)
  const clearHistory = useQueryHistoryStore((state) => state.clear)
  const [confirmClearHistory, setConfirmClearHistory] = useState(false)
  const [includeDiagnosticsSqlText, setIncludeDiagnosticsSqlText] = useState(false)
  const [diagnosticsExporting, setDiagnosticsExporting] = useState(false)

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

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

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PanelHeader title={t('settings.title')} subtitle={t('settings.subtitle')} icon={Settings} />
      <section className="border-b p-3">
        <h3 className="mb-2 text-xs font-semibold text-foreground">{t('settings.theme.label')}</h3>
        <div className="grid grid-cols-3 gap-1 rounded-md border bg-muted/30 p-1">
          <ThemeButton active={theme === 'system'} label={t('settings.theme.system')} icon={Settings} onClick={() => setTheme('system')} />
          <ThemeButton active={theme === 'dark'} label={t('settings.theme.dark')} icon={Moon} onClick={() => setTheme('dark')} />
          <ThemeButton active={theme === 'light'} label={t('settings.theme.light')} icon={Sun} onClick={() => setTheme('light')} />
        </div>
      </section>
      <section className="border-b p-3 text-xs">
        <label className="grid gap-1">
          <span className="font-semibold text-foreground">{t('settings.language.label')}</span>
          <select
            className="ide-select"
            value={i18n.language.startsWith('en') ? 'en' : 'zh'}
            onChange={(event) => {
              window.localStorage.setItem('vaporlensdb.language', event.target.value)
              void i18n.changeLanguage(event.target.value)
            }}
          >
            <option value="zh">{t('settings.language.zh')}</option>
            <option value="en">{t('settings.language.en')}</option>
          </select>
        </label>
      </section>
      <section className="space-y-3 border-b p-3 text-xs">
        <NumberSetting
          label={t('settings.queryMaxRows')}
          value={queryMaxRows}
          min={100}
          max={1_000_000}
          step={100}
          onChange={setQueryMaxRows}
        />
        <NumberSetting
          label={t('settings.dataPreviewRows')}
          value={dataPreviewDefaultRows}
          min={1}
          max={10_000}
          step={50}
          onChange={setDataPreviewDefaultRows}
        />
        <NumberSetting
          label={t('settings.editorFontSize')}
          value={editorFontSize}
          min={10}
          max={24}
          step={1}
          onChange={setEditorFontSize}
        />
        <label className="flex items-center justify-between gap-3 rounded-md border bg-background/60 px-2 py-2">
          <span className="min-w-0">
            <span className="block font-medium text-foreground">{t('settings.showSystemObjects')}</span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              {t('settings.showSystemObjectsHint')}
            </span>
          </span>
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={showSystemObjects}
            onChange={(event) => setShowSystemObjects(event.target.checked)}
          />
        </label>
      </section>
      <section className="space-y-2 border-b p-3 text-xs">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground">{t('sql.history')}</h3>
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
      </section>
      <DbeaverImportSettings
        onImportConnection={saveConnection}
        onNotify={notify}
        onNotifyError={notifyError}
      />
      <section className="space-y-3 border-b p-3 text-xs">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground">{t('settings.diagnostics.title')}</h3>
            <p className="mt-1 text-muted-foreground">{t('settings.diagnostics.description')}</p>
          </div>
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
        <label className="flex items-start gap-2 rounded-md border bg-background/60 px-2 py-2">
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
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              {t('settings.diagnostics.includeSqlTextHint')}
            </span>
          </span>
        </label>
      </section>
      <DriverDefinitionsSettings />
      <section className="space-y-2 p-3 text-xs">
        <SettingFact label={t('settings.configStore')} value="~/.vaporlensdb/config.db" />
        <SettingFact label={t('settings.passwordStorage')} value={t('settings.passwordStorageValue')} />
        <SettingFact label={t('settings.macosKey')} value={t('settings.macosKeyValue')} />
      </section>
    </div>
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
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    void loadDrivers()
  }, [loadDrivers])

  async function handleSave() {
    if (!editing || !editing.name.trim()) {
      return
    }
    const saved = await saveDriver(normalizeDriverDefinition(editing))
    if (saved) {
      setEditing(null)
    }
  }

  async function handleImportJdbcArtifacts(files: FileList | null) {
    if (!editing || editing.builtIn || editing.driverType !== 'jdbc' || !files?.length) {
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
    if (!editing || editing.builtIn || editing.driverType !== 'jdbc') {
      return
    }
    const saved = await removeJdbcArtifact(editing.id, path)
    if (saved) {
      setEditing(saved)
      setValidationMessage(null)
    }
  }

  async function handleImportJdbcArtifactPaths() {
    if (!editing || editing.builtIn || editing.driverType !== 'jdbc' || !editing.id) {
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
    const normalized = normalizeDriverDefinition(editing)
    const result = await validateDriver(normalized)
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

  return (
    <section className="space-y-2 border-b p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-foreground">{t('drivers.title')}</h3>
          <p className="mt-1 text-muted-foreground">
            {t('drivers.summary', { count: drivers.length })}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setEditing(newCustomDriverDefinition())}
        >
          <Plus className="size-3.5" />
          {t('drivers.add')}
        </Button>
      </div>

      <div className="grid max-h-56 gap-1 overflow-auto pr-1">
        {drivers.map((driver) => (
          <button
            key={driver.id}
            type="button"
            className={[
              'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-2 py-2 text-left',
              editing?.id === driver.id ? 'border-primary bg-primary/10' : 'bg-background/60 hover:bg-muted/45',
            ].join(' ')}
            onClick={() => setEditing(driver)}
          >
            <span className="min-w-0">
              <span className="block truncate font-medium text-foreground">{driver.name}</span>
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                {driver.driverType} · {driver.backend} · {driver.status}
              </span>
            </span>
            <span className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {driver.builtIn ? 'built-in' : 'custom'}
            </span>
          </button>
        ))}
      </div>

      {editing && (
        <div className="grid gap-2 rounded-md border bg-muted/20 p-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5 font-medium">
              <HardDrive className="size-3.5 text-primary" />
              <span className="truncate">{editing.builtIn ? t('drivers.viewBuiltIn') : t('drivers.editCustom')}</span>
            </div>
            <Button type="button" size="icon-sm" variant="ghost" onClick={() => setEditing(null)}>
              <X className="size-3.5" />
            </Button>
          </div>

          <DriverField label={t('drivers.name')}>
            <input
              className="ide-input h-7 text-xs"
              value={editing.name}
              disabled={editing.builtIn}
              onChange={(event) => setEditing({ ...editing, name: event.target.value })}
            />
          </DriverField>
          <DriverField label={t('drivers.runtime')}>
            <select
              className="ide-input h-7 text-xs"
              value={editing.driverType}
              disabled={editing.builtIn}
              onChange={(event) => {
                setValidationMessage(null)
                setEditing({
                  ...editing,
                  driverType: event.target.value as DriverDefinition['driverType'],
                  backend: 'jdbc',
                })
              }}
            >
              <option value="jdbc">JDBC</option>
            </select>
          </DriverField>
          <DriverField label={t('drivers.driverClass')}>
            <input
              className="ide-input h-7 text-xs"
              value={editing.jdbcDriverClass ?? ''}
              disabled={editing.builtIn}
              onChange={(event) => setEditing({ ...editing, jdbcDriverClass: event.target.value })}
            />
          </DriverField>
          <DriverField label={t('drivers.urlTemplate')}>
            <input
              className="ide-input h-7 text-xs"
              value={editing.urlTemplate ?? ''}
              disabled={editing.builtIn}
              onChange={(event) => setEditing({ ...editing, urlTemplate: event.target.value })}
            />
          </DriverField>
          <DriverField label={t('drivers.driverFiles')}>
            <div className="grid gap-2">
              <input
                ref={fileInputRef}
                className="hidden"
                type="file"
                accept=".jar,application/java-archive"
                multiple
                onChange={(event) => {
                  void handleImportJdbcArtifacts(event.target.files)
                }}
              />
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={editing.builtIn || loading || !editing.id}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="size-3.5" />
                  {t('drivers.importJar')}
                </Button>
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                  {editing.driverArtifacts.length
                    ? t('drivers.managedJarCount', { count: editing.driverArtifacts.length })
                    : t('drivers.noneImported')}
                </span>
              </div>
              {editing.driverArtifacts.length > 0 && (
                <div className="grid gap-1">
                  {editing.driverArtifacts.map((path) => (
                    <div
                      key={path}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded border bg-background/70 px-2 py-1"
                    >
                      <span className="truncate font-mono text-[11px]" title={path}>
                        {fileName(path)}
                      </span>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        disabled={loading}
                        title={t('drivers.removeJar')}
                        onClick={() => {
                          void handleRemoveJdbcArtifact(path)
                        }}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {!editing.builtIn && (
                <div className="grid gap-1">
                  <textarea
                    className="ide-input min-h-14 resize-y text-xs"
                    value={artifactPathInput}
                    placeholder="/absolute/path/to/vendor-driver.jar"
                    onChange={(event) => setArtifactPathInput(event.target.value)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={loading || !editing.id || !artifactPathInput.trim()}
                    onClick={() => {
                      void handleImportJdbcArtifactPaths()
                    }}
                  >
                    <Upload className="size-3.5" />
                    {t('drivers.importPath')}
                  </Button>
                </div>
              )}
            </div>
          </DriverField>
          <DriverField label={t('drivers.metadataSql')}>
            <textarea
              className="ide-input min-h-16 resize-y text-xs"
              value={editing.metadataDialectSql ?? ''}
              disabled={editing.builtIn}
              onChange={(event) => setEditing({ ...editing, metadataDialectSql: event.target.value })}
            />
          </DriverField>

          {!editing.builtIn && (
            <div className="grid gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={loading}
                onClick={() => {
                  void handleValidateDriver()
                }}
              >
                <HardDrive className="size-3.5" />
                {t('drivers.validate')}
              </Button>
              {validationMessage && (
                <div
                  className={[
                    'rounded border px-2 py-1 text-[11px]',
                    validationMessage.valid
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'
                      : 'border-destructive/35 bg-destructive/10 text-destructive',
                  ].join(' ')}
                >
                  {validationMessage.message}
                </div>
              )}
            </div>
          )}

          {!editing.builtIn && (
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                variant={confirmDeleteId === editing.id ? 'destructive' : 'outline'}
                disabled={loading}
                onClick={() => {
                  void handleDelete(editing)
                }}
              >
                <Trash2 className="size-3.5" />
                {confirmDeleteId === editing.id ? t('common.confirm') : t('common.delete')}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={loading || !editing.name.trim()}
                onClick={() => {
                  void handleSave()
                }}
              >
                <Save className="size-3.5" />
                {t('common.save')}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
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
    <section className="space-y-2 border-b p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-foreground">{t('dbeaver.title')}</h3>
          <p className="mt-1 text-muted-foreground">
            {t('dbeaver.description')}
          </p>
        </div>
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
        <div className="grid gap-2 rounded-md border bg-muted/20 p-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-medium">{preview.sourceName}</div>
              <div className="text-[11px] text-muted-foreground">
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

          <PreviewList title="Connections">
            {preview.connections.length === 0 ? (
              <PreviewEmpty label={t('dbeaver.noImportableConnections')} />
            ) : (
              preview.connections.slice(0, 8).map((connection) => (
                <div key={connection.id} className="rounded border bg-background/70 px-2 py-1.5">
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
              <div key={template.sourceDriver} className="flex items-center justify-between gap-2 rounded border bg-background/70 px-2 py-1.5">
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

          {preview.skipped.length > 0 && (
            <PreviewList title="Import report">
              {preview.skipped.slice(0, 6).map((skipped) => (
                <div key={`${skipped.name}:${skipped.sourceDriver}`} className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-amber-700">
                  <div className="truncate font-medium">{skipped.name}</div>
                  <div className="truncate text-[11px]">
                    {skipped.reason} · {skipped.sourceDriver ?? 'unknown'}
                  </div>
                </div>
              ))}
            </PreviewList>
          )}

          {report && (
            <div className="rounded border bg-background/70 px-2 py-1.5 text-[11px] text-muted-foreground">
              Import report: {report.imported} imported / {report.failed} failed /{' '}
              {preview.skipped.length} skipped.
            </div>
          )}
        </div>
      )}
    </section>
  )
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
  return <div className="rounded border border-dashed px-2 py-2 text-center text-[11px] text-muted-foreground">{label}</div>
}

function DriverField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
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

function PanelHeader({
  title,
  subtitle,
  icon: Icon,
}: {
  title: string
  subtitle: string
  icon: LucideIcon
}) {
  return (
    <div className="flex h-[52px] shrink-0 items-center gap-2 border-b px-3">
      <Icon className="size-4 text-primary" />
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold">{title}</h2>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  )
}

function EmptyPanel({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <div className="grid h-40 place-items-center rounded-md border border-dashed text-center">
      <div className="px-6">
        <Icon className="mx-auto mb-2 size-6 text-muted-foreground" />
        <div className="text-sm font-medium">{title}</div>
        <p className="mt-1 text-xs text-muted-foreground">{text}</p>
      </div>
    </div>
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
        'flex h-8 items-center justify-center gap-1 rounded text-xs transition-colors',
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      ].join(' ')}
      onClick={onClick}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  )
}

function SettingFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-background/60 px-2 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono text-[11px] text-foreground">{value}</span>
    </div>
  )
}

function NumberSetting({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <label className="block space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-medium">{label}</span>
        <input
          className="h-7 w-24 rounded-md border bg-background px-2 text-right font-mono text-[11px] outline-none focus:border-ring"
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
      <input
        className="w-full accent-primary"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

function sqlPreview(sql: string, t: ReturnType<typeof useTranslation>['t']) {
  const preview = sql.trim().replace(/\s+/g, ' ')
  return preview.length > 90 ? `${preview.slice(0, 90)}...` : preview || t('sql.blankQuery')
}

function driverCanCancel(driverType: DriverType) {
  return driverType === 'postgres'
}

function sessionStatusClass(status: string) {
  if (status === 'connected') return 'size-2 shrink-0 rounded-full bg-emerald-500'
  if (status === 'connecting') return 'size-2 shrink-0 rounded-full bg-amber-500'
  if (status === 'failed') return 'size-2 shrink-0 rounded-full bg-destructive'
  return 'size-2 shrink-0 rounded-full bg-muted-foreground/50'
}

function formatHistoryTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
