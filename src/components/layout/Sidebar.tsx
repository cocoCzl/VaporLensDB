import {
  Activity,
  CheckCircle2,
  Circle,
  Code2,
  Columns3,
  Database,
  FileCode2,
  GitBranch,
  KeyRound,
  Moon,
  Plus,
  Settings,
  Sun,
  Table2,
  TerminalSquare,
  Trash2,
} from 'lucide-react'
import { ConnectionList } from '@/components/connection/ConnectionList'
import { DatabaseTree } from '@/components/explorer/DatabaseTree'
import { Button } from '@/components/ui/button'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import { useMetadataStore } from '@/stores/metadataStore'
import { useObjectInspectorStore } from '@/stores/objectInspectorStore'
import { useQueryHistoryStore } from '@/stores/queryHistoryStore'
import { useUiStore } from '@/stores/uiStore'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

const RAIL_ITEMS = [
  { view: 'dataSources', icon: Database, label: '数据源' },
  { view: 'structure', icon: GitBranch, label: '结构' },
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

  if (sidebarView === 'structure') {
    return <StructurePanel />
  }

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

function StructurePanel() {
  const { connections, statuses, activeConnectionId } = useConnectionStore()
  const metadata = useMetadataStore()
  const selectedObject = useObjectInspectorStore((state) => state.selected)
  const activeConnection = connections.find((connection) => connection.id === activeConnectionId)
  const loadedDatabases = activeConnectionId ? metadata.databases[activeConnectionId] ?? [] : []
  const loadedSchemas = countEntries(metadata.schemas, activeConnectionId)
  const loadedTables = countEntries(metadata.tables, activeConnectionId)
  const loadedViews = countEntries(metadata.views, activeConnectionId)
  const loadedFunctions = countEntries(metadata.functions, activeConnectionId)
  const isConnected = Boolean(activeConnectionId && statuses[activeConnectionId]?.status === 'connected')

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PanelHeader
        title="结构"
        subtitle={activeConnection?.name ?? '未选择连接'}
        icon={GitBranch}
      />
      <div className="space-y-3 border-b p-3">
        <div className="flex items-center gap-2 text-sm">
          {isConnected ? (
            <CheckCircle2 className="size-4 text-emerald-500" />
          ) : (
            <Circle className="size-4 text-muted-foreground" />
          )}
          <span className="truncate font-medium">
            {isConnected ? '连接已就绪' : '先连接一个数据源'}
          </span>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          这里汇总当前已加载的对象结构。展开数据源里的节点后，统计会随缓存更新。
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 p-3">
        <Metric label="数据库" value={loadedDatabases.length} icon={Database} />
        <Metric label="Schema" value={loadedSchemas} icon={GitBranch} />
        <Metric label="表" value={loadedTables} icon={Table2} />
        <Metric label="视图" value={loadedViews} icon={Activity} />
      </div>
      <div className="border-t px-3 py-2 text-xs text-muted-foreground">
        已加载函数 {loadedFunctions.toLocaleString()} 个
      </div>
      <ObjectDetails />
      {!selectedObject && (
        <div className="border-t p-3">
          <EmptyPanel
            icon={Code2}
            title="未选择对象"
            text="在数据源里右键表或视图，选择查看结构 / DDL。"
          />
        </div>
      )}
    </div>
  )
}

function ObjectDetails() {
  const selected = useObjectInspectorStore((state) => state.selected)
  if (!selected) {
    return null
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto border-t">
      <div className="border-b p-3">
        <div className="truncate text-sm font-semibold">{selected.table}</div>
        <div className="truncate text-xs text-muted-foreground">
          {selected.schema} · {selected.kind === 'view' ? '视图' : '表'}
          {selected.loading ? ' · 加载中' : ''}
        </div>
      </div>
      <ObjectSection icon={Columns3} title={`列 (${selected.columns.length})`}>
        <div className="space-y-1">
          {selected.columns.map((column) => (
            <div
              key={column.name}
              className="flex items-center justify-between gap-2 rounded border bg-background/60 px-2 py-1.5 text-xs"
            >
              <span className="min-w-0 truncate font-medium">{column.name}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {column.dataType}
                {column.isPrimaryKey ? ' PK' : ''}
              </span>
            </div>
          ))}
        </div>
      </ObjectSection>
      <ObjectSection icon={KeyRound} title={`索引 (${selected.indexes.length})`}>
        <div className="space-y-1">
          {selected.indexes.map((index) => (
            <div key={index.name} className="rounded border bg-background/60 px-2 py-1.5 text-xs">
              <div className="truncate font-medium">{index.name}</div>
              <div className="truncate text-[11px] text-muted-foreground">
                {index.unique ? 'unique · ' : ''}
                {index.columns.join(', ')}
              </div>
            </div>
          ))}
          {selected.indexes.length === 0 && <EmptyLine text="暂无索引" />}
        </div>
      </ObjectSection>
      <ObjectSection icon={Code2} title="DDL">
        {selected.ddl ? (
          <pre className="max-h-72 overflow-auto rounded border bg-background/70 p-2 text-[11px] leading-5">
            {selected.ddl}
          </pre>
        ) : (
          <EmptyLine text={selected.loading ? '正在加载 DDL' : selected.error ?? '暂无 DDL'} />
        )}
      </ObjectSection>
    </div>
  )
}

function SqlWorkspacePanel() {
  const { tabs, activeTabId, setActiveTab, addTab } = useEditorStore()
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId)
  const history = useQueryHistoryStore((state) => state.entries)
  const clearHistory = useQueryHistoryStore((state) => state.clear)

  function createTab() {
    addTab({
      id: crypto.randomUUID(),
      title: `SQL ${tabs.length + 1}`,
      sql: '',
      connectionId: activeConnectionId,
    })
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
                  onClick={() => setActiveTab(tab.id)}
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
              variant="ghost"
              title="清空查询历史"
              disabled={history.length === 0}
              onClick={clearHistory}
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

function Metric({ label, value, icon: Icon }: { label: string; value: number; icon: LucideIcon }) {
  return (
    <div className="rounded-md border bg-background/60 p-2">
      <div className="mb-2 flex items-center justify-between text-muted-foreground">
        <span className="text-xs">{label}</span>
        <Icon className="size-3.5" />
      </div>
      <div className="text-lg font-semibold tabular-nums">{value.toLocaleString()}</div>
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

function ObjectSection({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon
  title: string
  children: ReactNode
}) {
  return (
    <section className="border-b p-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
        <Icon className="size-3.5 text-primary" />
        {title}
      </h3>
      {children}
    </section>
  )
}

function EmptyLine({ text }: { text: string }) {
  return <div className="rounded border border-dashed p-2 text-xs text-muted-foreground">{text}</div>
}

function countEntries(record: Record<string, unknown[]>, connectionId: string | null) {
  if (!connectionId) {
    return 0
  }

  return Object.entries(record)
    .filter(([key]) => key.startsWith(connectionId))
    .reduce((count, [, values]) => count + values.length, 0)
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
