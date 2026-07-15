import { useTranslation } from 'react-i18next'
import { Activity, AlertCircle, Database, Loader2, Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useQuery } from '@/hooks/useQuery'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import { useMetadataStore } from '@/stores/metadataStore'
import { useTaskStore } from '@/stores/taskStore'
import type { DriverType } from '@/types/connection'
import type { TaskInfo } from '@/types/task'

interface StatusBarProps {
  backendStatus: string
}

export function StatusBar({ backendStatus }: StatusBarProps) {
  const { t } = useTranslation()
  const healthy = backendStatus.startsWith('ok')

  return (
    <footer className="flex h-6 items-center justify-between gap-2 border-t ide-toolbar px-2 text-[11px] text-muted-foreground">
      <CurrentDataSourceStatus />
      <div className="flex min-w-0 items-center gap-1">
        {!healthy && (
          <span
            className="inline-flex max-w-44 items-center gap-1 truncate rounded px-1.5 text-destructive hover:bg-destructive/10"
            title={`${t('status.backendHealthTitle')} · ${formatBackendStatus(backendStatus, t)}`}
          >
            <AlertCircle className="size-3 shrink-0" />
            <span className="truncate">{formatBackendStatus(backendStatus, t)}</span>
          </span>
        )}
        <TaskSessionStatus />
      </div>
    </footer>
  )
}

function CurrentDataSourceStatus() {
  const { t } = useTranslation()
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId)
  const connections = useConnectionStore((state) => state.connections)
  const statuses = useConnectionStore((state) => state.statuses)
  const catalogSchemaPath = useMetadataStore((state) =>
    activeConnectionId ? state.catalogSchemaPaths[activeConnectionId] : null,
  )
  const connection = connections.find((candidate) => candidate.id === activeConnectionId) ?? null
  const connectionStatus = connection
    ? statuses[connection.id]?.status ?? 'disconnected'
    : 'disconnected'

  if (!connection) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 truncate" title={t('connection.disconnected')}>
        <Database className="size-3 shrink-0 text-muted-foreground/70" />
        <span className="truncate">{t('connection.disconnected')}</span>
      </span>
    )
  }

  const context = [catalogSchemaPath?.database, catalogSchemaPath?.schema]
    .filter((value): value is string => Boolean(value))
    .join(' / ')

  return (
    <span
      className="inline-flex min-w-0 items-center gap-1.5 truncate"
      title={`${connection.name} · ${connection.driverType}${context ? ` · ${context}` : ''}`}
    >
      <span
        className={[
          'size-1.5 shrink-0 rounded-full',
          connectionStatus === 'connected'
            ? 'bg-emerald-500'
            : connectionStatus === 'failed'
              ? 'bg-destructive'
              : connectionStatus === 'connecting'
                ? 'bg-amber-500'
                : 'bg-muted-foreground/45',
        ].join(' ')}
      />
      <span className="max-w-32 truncate font-medium text-foreground/85">{connection.name}</span>
      {context && <span className="hidden max-w-72 truncate text-muted-foreground min-[900px]:inline">{context}</span>}
    </span>
  )
}

function TaskSessionStatus() {
  const { t } = useTranslation()
  const tasks = useTaskStore((state) => state.tasks)
  const cancelTask = useTaskStore((state) => state.cancel)
  const startNoop = useTaskStore((state) => state.startNoop)
  const connections = useConnectionStore((state) => state.connections)
  const statuses = useConnectionStore((state) => state.statuses)
  const tabs = useEditorStore((state) => state.tabs)
  const setActiveTab = useEditorStore((state) => state.setActiveTab)
  const setActiveConnection = useConnectionStore((state) => state.setActiveConnection)
  const { cancelRunningQuery } = useQuery()
  const activeTasks = tasks.filter((task) => ['pending', 'running', 'cancelling'].includes(task.status))
  const runtimeSessions = connections
    .map((connection) => ({
      connection,
      status: statuses[connection.id]?.status ?? 'disconnected',
      message: statuses[connection.id]?.message ?? null,
      runningTabs: tabs.filter((tab) => tab.connectionId === connection.id && Boolean(tab.runningQueryId)),
    }))
    .filter((session) => session.status !== 'disconnected' || session.runningTabs.length > 0)
  const runningQueryCount = runtimeSessions.reduce(
    (count, session) => count + session.runningTabs.length,
    0,
  )

  return (
    <Sheet>
      <SheetTrigger
        className="flex h-5 max-w-80 items-center gap-1 rounded px-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
        title={t('status.tasksAndSessions')}
      >
        {activeTasks.length > 0 || runningQueryCount > 0 ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <Activity className="size-3" />
        )}
        <span className="truncate">
          {t('status.activitySummary', {
            sessions: runtimeSessions.length,
            queries: runningQueryCount,
            tasks: activeTasks.length,
          })}
        </span>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[48vh] gap-0 p-0" showCloseButton>
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle>{t('status.tasksAndSessions')}</SheetTitle>
          <SheetDescription>
            {t('status.activityDetail', {
              sessions: runtimeSessions.length,
              queries: runningQueryCount,
              tasks: activeTasks.length,
            })}
          </SheetDescription>
        </SheetHeader>
        <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4 md:grid-cols-2">
          <section className="min-w-0">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase text-muted-foreground">{t('status.backgroundTasks')}</h3>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => startNoop({ title: 'No-op task', steps: 5, stepDelayMs: 180 })}
              >
                <Play className="size-3.5" />
                {t('status.testTask')}
              </Button>
            </div>
            {tasks.length === 0 ? (
              <div className="rounded border border-dashed p-3 text-xs text-muted-foreground">{t('status.noTasks')}</div>
            ) : (
              <div className="space-y-2">
                {tasks.slice(0, 12).map((task) => (
                  <TaskRow key={task.id} task={task} onCancel={() => cancelTask(task.id)} />
                ))}
              </div>
            )}
          </section>
          <section className="min-w-0">
            <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{t('status.sessionActivity')}</h3>
            {runtimeSessions.length === 0 ? (
              <div className="rounded border border-dashed p-3 text-xs text-muted-foreground">
                {t('status.noActiveSessions')}
              </div>
            ) : (
              <div className="space-y-2">
                {runtimeSessions.map(({ connection, status, message, runningTabs }) => {
                  const canCancel = driverCanCancel(connection.driverType)
                  return (
                    <section key={connection.id} className="rounded border bg-background/70">
                      <div className="border-b px-2 py-1.5 text-xs">
                        <div className="truncate font-semibold">{connection.name}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {connection.driverType} · {status}
                          {message ? ` · ${message}` : ''}
                        </div>
                      </div>
                      <div className="grid gap-1 p-2">
                        {runningTabs.length === 0 ? (
                          <div className="rounded border border-dashed px-2 py-2 text-[11px] text-muted-foreground">
                            {t('sessions.noRunningQueries')}
                          </div>
                        ) : (
                          runningTabs.map((tab) => (
                            <div
                              key={tab.id}
                              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded border px-2 py-1.5 text-xs"
                            >
                              <button
                                type="button"
                                className="min-w-0 text-left"
                                onClick={() => {
                                  setActiveTab(tab.id)
                                  setActiveConnection(connection.id)
                                }}
                              >
                                <span className="block truncate font-medium">{tab.title}</span>
                                <span className="block truncate font-mono text-[11px] text-muted-foreground">
                                  {sqlPreview(tab.sql)}
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
                                <Square className="size-3.5" />
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
          </section>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function TaskRow({ task, onCancel }: { task: TaskInfo; onCancel: () => void }) {
  const active = ['pending', 'running', 'cancelling'].includes(task.status)
  const total = task.progress.total
  const progress = total ? `${task.progress.current}/${total}` : task.progress.message

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded border bg-background/70 px-2 py-1.5 text-xs">
      <div className="min-w-0">
        <div className="truncate font-medium">{task.title}</div>
        <div className="truncate text-[11px] text-muted-foreground">
          {task.status}
          {progress ? ` · ${progress}` : ''}
          {task.error ? ` · ${task.error}` : ''}
        </div>
      </div>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        disabled={!active || task.status === 'cancelling'}
        onClick={onCancel}
      >
        <Square className="size-3.5" />
      </Button>
    </div>
  )
}

function driverCanCancel(driverType: DriverType) {
  return driverType === 'postgres'
}

function sqlPreview(sql: string) {
  const preview = sql.trim().replace(/\s+/g, ' ')
  return preview.length > 90 ? `${preview.slice(0, 90)}...` : preview || 'Blank query'
}

function formatBackendStatus(status: string, t: ReturnType<typeof useTranslation>['t']) {
  if (status.startsWith('ok ')) {
    return t('status.backendOk', { version: status.slice(3) })
  }

  if (status === 'checking') {
    return t('status.backendChecking')
  }

  if (status === 'unavailable') {
    return t('status.backendUnavailable')
  }

  return t('status.backendOther', { status })
}
