import type { ReactNode } from 'react'

export type SqlWorkspaceView = 'split' | 'results' | 'editor'

interface SqlWorkspaceProps {
  contextBar?: ReactNode
  editor?: ReactNode
  splitter?: ReactNode
  resultPanel?: ReactNode
  history?: ReactNode
  view: SqlWorkspaceView
  children?: ReactNode
}

/**
 * The SQL workbench's visual frame. Query execution state remains in MainPanel;
 * this component owns only the editor/results spatial relationship.
 */
export function SqlWorkspace({ contextBar, editor, splitter, resultPanel, history, view, children }: SqlWorkspaceProps) {
  if (children) return <div className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</div>

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {contextBar}
      <div className="relative min-h-0 flex-1">
        <div className="flex h-full min-w-0 flex-col overflow-hidden">
          {view !== 'results' && editor}
          {view === 'split' && splitter}
          {view !== 'editor' && resultPanel}
        </div>
        {history}
      </div>
    </div>
  )
}
