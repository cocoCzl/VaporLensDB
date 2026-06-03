import {
  Database,
  FileCode2,
  Moon,
  Plus,
  Settings,
  Sun,
  TerminalSquare,
  Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { ConnectionList } from '@/components/connection/ConnectionList'
import { DatabaseTree } from '@/components/explorer/DatabaseTree'
import { Button } from '@/components/ui/button'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import { useQueryHistoryStore } from '@/stores/queryHistoryStore'
import { useUiStore } from '@/stores/uiStore'
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
      <section className="space-y-2 p-3 text-xs">
        <SettingFact label="配置存储" value="~/.vaporlensdb/config.db" />
        <SettingFact label="密码" value="AES-GCM 加密保存" />
        <SettingFact label="macOS 密钥" value="系统 Keychain" />
      </section>
    </div>
  )
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
