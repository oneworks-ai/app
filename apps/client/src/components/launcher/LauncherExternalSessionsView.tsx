import './LauncherExternalSessionsView.scss'

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { LauncherWorkspaceSelectorProject } from '@oneworks/types'

import type { NativeHistoryAdapter } from '#~/api'
import type { ActionSearchToolbarAction } from '#~/components/action-search-toolbar/ActionSearchToolbar'
import { ExternalSessionsPanel } from '#~/components/config/ExternalSessionsPanel'
import { buildLauncherExternalSessionProjectOptions } from '#~/components/config/external-session-project-path'
import type { NativeHistoryImportSettings } from '#~/components/config/external-sessions-panel-model'
import type { LauncherActivationObserver } from '#~/routes/launcher-workspace-open-lifecycle'

import type { LauncherSearchChromeExtension } from './launcher-search-chrome'

const ignoreConfigChange = () => {}

export function LauncherExternalSessionsView({
  active,
  config,
  getModalContainer,
  onImportComplete,
  onQueryChange,
  onSearchChromeChange,
  observeActivation,
  query,
  workspaceProjects
}: {
  active: boolean
  config?: NativeHistoryImportSettings
  getModalContainer: () => HTMLElement
  onImportComplete: () => Promise<void> | void
  onQueryChange: (query: string) => void
  onSearchChromeChange: (extension: LauncherSearchChromeExtension | undefined) => void
  observeActivation: () => LauncherActivationObserver
  query: string
  workspaceProjects: LauncherWorkspaceSelectorProject[]
}) {
  const { t } = useTranslation()
  const [activeAdapter, setActiveAdapter] = useState<NativeHistoryAdapter>('codex')
  const [toolbarActions, setToolbarActions] = useState<ActionSearchToolbarAction[]>([])
  const projectOptions = useMemo(
    () => buildLauncherExternalSessionProjectOptions(workspaceProjects),
    [workspaceProjects]
  )

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
        activationActive={active}
        activeAdapter={activeAdapter}
        config={config}
        fixedProjectScope='all-projects'
        getModalContainer={getModalContainer}
        initialShowAllTime
        onActiveAdapterChange={setActiveAdapter}
        onConfigChange={ignoreConfigChange}
        onImportComplete={onImportComplete}
        onQueryChange={onQueryChange}
        onToolbarActionsChange={setToolbarActions}
        observeActivation={observeActivation}
        projectOptions={projectOptions}
        query={query}
        showConfiguration={false}
        showHeader={false}
        toolbarPlacement='external'
      />
    </div>
  )
}
