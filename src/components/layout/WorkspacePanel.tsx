import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WorkbenchHome } from '@/components/home/WorkbenchHome'
import { ModuleBoundary } from '@/components/common/ModuleBoundary'
import { useEditorStore } from '@/stores/editorStore'

const MainPanel = lazy(() => import('./MainPanel').then(module => ({ default: module.MainPanel })))

export function WorkspacePanel() {
  const { t } = useTranslation()
  const activeTabId = useEditorStore(state => state.activeTabId)
  const [opened, setOpened] = useState(Boolean(activeTabId))
  if (activeTabId && !opened) setOpened(true)

  // Once loaded, keep execution hooks mounted through tab switches and Home.
  if (!opened && !activeTabId) return <WorkbenchHome />
  return <ModuleBoundary><Suspense fallback={<section className="ide-workspace flex-1 p-5" role="status">{t('common.loading')}</section>}>
    <MainPanel />
  </Suspense></ModuleBoundary>
}
