import './LauncherExternalSessionsView.scss'

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { LauncherWorkspaceSelectorProject } from '@oneworks/types'

import type { NativeHistoryAdapter } from '#~/api'
import type { ActionSearchToolbarAction } from '#~/components/action-search-toolbar/ActionSearchToolbar'
import { ExternalSessionsPanel } from '#~/components/config/ExternalSessionsPanel'
import type { NativeHistoryImportSettings } from '#~/components/config/external-sessions-panel-model'

import type { LauncherSearchChromeExtension } from './launcher-search-chrome'

const ignoreConfigChange = () => {}

export function LauncherExternalSessionsView({
  config,
  onImportComplete,
  onQueryChange,
  onSearchChromeChange,
  query,
  workspaceProjects
}: {
  config?: NativeHistoryImportSettings
  onImportComplete: () => Promise<void> | void
  onQueryChange: (query: string) => void
  onSearchChromeChange: (extension: LauncherSearchChromeExtension | undefined) => void
  query: string
  workspaceProjects: LauncherWorkspaceSelectorProject[]
}) {
  const { t } = useTranslation()
  const [activeAdapter, setActiveAdapter] = useState<NativeHistoryAdapter>('codex')
  const [toolbarActions, setToolbarActions] = useState<ActionSearchToolbarAction[]>([])
  const projectOptions = useMemo(() => {
    const projectsByPath = new Map<string, LauncherWorkspaceSelectorProject>()
    for (const project of workspaceProjects) {
      const workspaceFolder = project.workspaceFolder.trim()
      if (workspaceFolder !== '') {
        projectsByPath.set(workspaceFolder, project)
      }
    }
    return Array.from(projectsByPath.entries()).map(([value, project]) => ({
      description: project.description,
      isCurrent: project.isCurrent,
      label: project.name.trim() || value,
      value
    }))
  }, [workspaceProjects])

  useEffect(() => {
    onSearchChromeChange({
      actions: toolbarActions,
      ariaLabel: t('nativeHistoryImport.manager.searchPlaceholder'),
      placeholder: t('nativeHistoryImport.manager.searchPlaceholder')
    })
  }, [onSearchChromeChange, t, toolbarActions])

  useEffect(() => () => onSearchChromeChange(undefined), [onSearchChromeChange])

  return (
    <div className='launcher-external-sessions'>
      <ExternalSessionsPanel
        activeAdapter={activeAdapter}
        config={config}
        fixedProjectScope='all-projects'
        initialShowAllTime
        onActiveAdapterChange={setActiveAdapter}
        onConfigChange={ignoreConfigChange}
        onImportComplete={onImportComplete}
        onQueryChange={onQueryChange}
        onToolbarActionsChange={setToolbarActions}
        projectOptions={projectOptions}
        query={query}
        showConfiguration={false}
        showHeader={false}
        toolbarPlacement='external'
      />
    </div>
  )
}
