import {
  Database,
  FileCode2,
  HardDrive,
  Moon,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Sun,
  TerminalSquare,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ConnectionList } from '@/components/connection/ConnectionList'
import { DatabaseTree } from '@/components/explorer/DatabaseTree'
import { Button } from '@/components/ui/button'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import { useDriverStore } from '@/stores/driverStore'
import { useQueryHistoryStore } from '@/stores/queryHistoryStore'
import { useUiStore } from '@/stores/uiStore'
import type { DriverDefinition } from '@/types/driver'
import type { LucideIcon } from 'lucide-react'

const RAIL_ITEMS = [
  { view: 'dataSources', icon: Database, label: '数据源' },
  { view: 'sql', icon: FileCode2, label: 'SQL' },
] as const

export function Sidebar() {
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
            label={item.label}
            onClick={() => setSidebarView(item.view)}
          />
        ))}
        <div className="flex-1" />
        <RailButton
          active={sidebarView === 'settings'}
          icon={Settings}
          label="设置"
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
      notify({ kind: 'success', title: '查询历史已清空' })
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PanelHeader title="SQL 工作区" subtitle={`${tabs.length} 个编辑页`} icon={TerminalSquare} />
      <div className="border-b p-2">
        <Button type="button" size="sm" variant="secondary" className="w-full" onClick={createTab}>
          <Plus className="size-3.5" />
          新建 SQL
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {tabs.length === 0 ? (
          <EmptyPanel icon={FileCode2} title="还没有 SQL Tab" text="新建 SQL 后会显示在这里。" />
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
                      {tab.running ? '正在执行' : sqlPreview(tab.sql)}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
        <div className="mt-4 border-t pt-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold">查询历史</h3>
            <Button
              type="button"
              size="icon-xs"
              variant={confirmClearHistory ? 'destructive' : 'ghost'}
              title={confirmClearHistory ? '再次点击确认清空' : '清空查询历史'}
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
              执行 SQL 后会自动记录到这里。
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
                      title: '历史 SQL',
                      sql: entry.sql,
                      connectionId: entry.connectionId,
                    })
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[11px]">{sqlPreview(entry.sql)}</span>
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
                      {entry.rowCount != null ? ` · ${entry.rowCount} 行` : ''}
                      {entry.affectedRows != null ? ` · 影响 ${entry.affectedRows} 行` : ''}
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

function SettingsPanel() {
  const theme = useUiStore((state) => state.theme)
  const setTheme = useUiStore((state) => state.setTheme)
  const queryMaxRows = useUiStore((state) => state.queryMaxRows)
  const setQueryMaxRows = useUiStore((state) => state.setQueryMaxRows)
  const editorFontSize = useUiStore((state) => state.editorFontSize)
  const setEditorFontSize = useUiStore((state) => state.setEditorFontSize)
  const notify = useUiStore((state) => state.notify)
  const history = useQueryHistoryStore((state) => state.entries)
  const historyLoading = useQueryHistoryStore((state) => state.loading)
  const loadHistory = useQueryHistoryStore((state) => state.loadHistory)
  const clearHistory = useQueryHistoryStore((state) => state.clear)
  const [confirmClearHistory, setConfirmClearHistory] = useState(false)

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
      notify({ kind: 'success', title: '查询历史已清空' })
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PanelHeader title="设置" subtitle="本地偏好" icon={Settings} />
      <section className="border-b p-3">
        <h3 className="mb-2 text-xs font-semibold text-foreground">主题</h3>
        <div className="grid grid-cols-3 gap-1 rounded-md border bg-muted/30 p-1">
          <ThemeButton active={theme === 'system'} label="系统" icon={Settings} onClick={() => setTheme('system')} />
          <ThemeButton active={theme === 'dark'} label="深色" icon={Moon} onClick={() => setTheme('dark')} />
          <ThemeButton active={theme === 'light'} label="浅色" icon={Sun} onClick={() => setTheme('light')} />
        </div>
      </section>
      <section className="space-y-3 border-b p-3 text-xs">
        <NumberSetting
          label="最大返回行数"
          value={queryMaxRows}
          min={100}
          max={1_000_000}
          step={100}
          onChange={setQueryMaxRows}
        />
        <NumberSetting
          label="编辑器字号"
          value={editorFontSize}
          min={10}
          max={24}
          step={1}
          onChange={setEditorFontSize}
        />
      </section>
      <section className="space-y-2 border-b p-3 text-xs">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground">查询历史</h3>
            <p className="mt-1 text-muted-foreground">
              当前保存 {history.length} 条最近记录。
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
            {confirmClearHistory ? '确认清空' : '清空'}
          </Button>
        </div>
      </section>
      <DriverDefinitionsSettings />
      <section className="space-y-2 p-3 text-xs">
        <SettingFact label="配置存储" value="~/.vaporlensdb/config.db" />
        <SettingFact label="密码" value="AES-GCM 加密保存" />
        <SettingFact label="macOS 密钥" value="系统 Keychain" />
      </section>
    </div>
  )
}

function DriverDefinitionsSettings() {
  const drivers = useDriverStore((state) => state.drivers)
  const loading = useDriverStore((state) => state.loading)
  const loadDrivers = useDriverStore((state) => state.loadDrivers)
  const saveDriver = useDriverStore((state) => state.saveDriver)
  const deleteDriver = useDriverStore((state) => state.deleteDriver)
  const importJdbcArtifacts = useDriverStore((state) => state.importJdbcArtifacts)
  const removeJdbcArtifact = useDriverStore((state) => state.removeJdbcArtifact)
  const loadOdbcDrivers = useDriverStore((state) => state.loadOdbcDrivers)
  const validateDriver = useDriverStore((state) => state.validateDriver)
  const [editing, setEditing] = useState<DriverDefinition | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [odbcDrivers, setOdbcDrivers] = useState<string[]>([])
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

  async function refreshOdbcDrivers() {
    const drivers = await loadOdbcDrivers()
    setOdbcDrivers(drivers)
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
          <h3 className="font-semibold text-foreground">驱动定义</h3>
          <p className="mt-1 text-muted-foreground">
            {drivers.length} 个定义，custom 可编辑。
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setEditing(newCustomDriverDefinition())}
        >
          <Plus className="size-3.5" />
          新增
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
              <span className="truncate">{editing.builtIn ? '查看内置驱动' : '编辑自定义驱动'}</span>
            </div>
            <Button type="button" size="icon-sm" variant="ghost" onClick={() => setEditing(null)}>
              <X className="size-3.5" />
            </Button>
          </div>

          <DriverField label="名称">
            <input
              className="ide-input h-7 text-xs"
              value={editing.name}
              disabled={editing.builtIn}
              onChange={(event) => setEditing({ ...editing, name: event.target.value })}
            />
          </DriverField>
          <DriverField label="运行时">
            <select
              className="ide-input h-7 text-xs"
              value={editing.driverType}
              disabled={editing.builtIn}
              onChange={(event) => {
                setValidationMessage(null)
                setEditing({
                  ...editing,
                  driverType: event.target.value as DriverDefinition['driverType'],
                  backend: event.target.value === 'odbc' ? 'odbc' : 'jdbc',
                  driverArtifacts: event.target.value === 'odbc' ? [] : editing.driverArtifacts,
                  odbcDriverName: event.target.value === 'odbc' ? editing.odbcDriverName : null,
                })
              }}
            >
              <option value="jdbc">JDBC</option>
              <option value="odbc">ODBC</option>
            </select>
          </DriverField>
          <DriverField label="驱动类">
            <input
              className="ide-input h-7 text-xs"
              value={editing.jdbcDriverClass ?? ''}
              disabled={editing.builtIn || editing.driverType === 'odbc'}
              onChange={(event) => setEditing({ ...editing, jdbcDriverClass: event.target.value })}
            />
          </DriverField>
          <DriverField label="URL 模板">
            <input
              className="ide-input h-7 text-xs"
              value={editing.urlTemplate ?? ''}
              disabled={editing.builtIn}
              onChange={(event) => setEditing({ ...editing, urlTemplate: event.target.value })}
            />
          </DriverField>
          <DriverField label="驱动文件">
            {editing.driverType === 'jdbc' ? (
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
                    导入 JAR
                  </Button>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                    {editing.driverArtifacts.length
                      ? `${editing.driverArtifacts.length} 个 managed JAR`
                      : '尚未导入'}
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
                          title="移除 JAR"
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
                      导入路径
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid gap-2">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <select
                    className="ide-input h-7 text-xs"
                    value={editing.odbcDriverName ?? ''}
                    disabled={editing.builtIn}
                    onChange={(event) =>
                      setEditing({
                        ...editing,
                        odbcDriverName: event.target.value || null,
                        driverArtifact: event.target.value || '系统 ODBC 驱动',
                      })
                    }
                    onFocus={() => {
                      if (odbcDrivers.length === 0) {
                        void refreshOdbcDrivers()
                      }
                    }}
                  >
                    <option value="">选择系统 ODBC 驱动</option>
                    {odbcDrivers.map((driver) => (
                      <option key={driver} value={driver}>
                        {driver}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    title="刷新 ODBC 驱动"
                    disabled={loading}
                    onClick={() => {
                      void refreshOdbcDrivers()
                    }}
                  >
                    <RefreshCw className="size-3.5" />
                  </Button>
                </div>
                <input
                  className="ide-input h-7 text-xs"
                  value={editing.odbcDriverName ?? ''}
                  disabled={editing.builtIn}
                  placeholder="系统 ODBC driver name"
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      odbcDriverName: event.target.value,
                      driverArtifact: event.target.value || '系统 ODBC 驱动',
                    })
                  }
                />
              </div>
            )}
          </DriverField>
          <DriverField label="元数据 SQL">
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
                校验驱动
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
                {confirmDeleteId === editing.id ? '确认删除' : '删除'}
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
                保存
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  )
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
    odbcDriverName: null,
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
    backend: driver.driverType === 'odbc' ? 'odbc' : 'jdbc',
    jdbcDriverClass: nullableText(driver.driverType === 'odbc' ? null : driver.jdbcDriverClass),
    urlTemplate: nullableText(driver.urlTemplate),
    driverArtifact:
      driver.driverType === 'odbc'
        ? nullableText(driver.odbcDriverName) ?? '系统 ODBC 驱动'
        : driver.driverArtifacts.length
          ? driver.driverArtifacts.map(fileName).join(', ')
          : nullableText(driver.driverArtifact),
    driverArtifacts: driver.driverType === 'jdbc' ? driver.driverArtifacts : [],
    odbcDriverName: nullableText(driver.driverType === 'odbc' ? driver.odbcDriverName : null),
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

function sqlPreview(sql: string) {
  const preview = sql.trim().replace(/\s+/g, ' ')
  return preview || '空白查询'
}

function formatHistoryTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
