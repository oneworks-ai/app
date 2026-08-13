/* eslint-disable max-lines -- shared configuration and import-only launcher composition stay together. */
import { App, InputNumber, Switch } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getApiErrorMessage, runNativeProjectHistoryImport } from '#~/api'
import type { NativeHistoryAdapter, NativeHistoryProjectScope } from '#~/api'
import type { ActionSearchToolbarAction } from '#~/components/action-search-toolbar/ActionSearchToolbar'
import { NativeTabs } from '#~/components/native-tabs'
import { useNativeHistoryImportNotification } from '#~/hooks/use-native-history-import-notification'
import { useResolvedThemeMode } from '#~/hooks/use-resolved-theme-mode'
import { getAdapterDisplay, resolveAdapterDisplayIcon } from '#~/resources/adapters'
import type { LauncherActivationObserver } from '#~/routes/launcher-workspace-open-lifecycle'
import { getRuntimeWorkspaceId } from '#~/runtime-config'
import { FieldRow } from './ConfigFieldRow'
import { ConfigSectionFrame } from './ConfigSectionFrame'
import { ExternalSessionsAdapterTab } from './ExternalSessionsAdapterTab'
import {
  compactNativeHistoryImportSettings,
  defaultNativeHistoryImportMaxFileSizeBytes,
  getAdapterLabelKey,
  nativeHistoryAdapters
} from './external-sessions-panel-model'
import type { ExternalSessionsProjectOption, NativeHistoryImportSettings } from './external-sessions-panel-model'
import { useNativeHistoryImportAction } from './use-native-history-import-action'

const bytesToMegabytes = (value: number | null | undefined) => value == null ? null : value / 1024 / 1024
const megabytesToBytes = (value: number | null) => value == null ? null : Math.round(value * 1024 * 1024)
const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)

export function ExternalSessionsPanel({
  activationActive = true,
  activeAdapter,
  config,
  fixedProjectScope,
  initialShowAllTime = false,
  getModalContainer,
  onActiveAdapterChange,
  onConfigChange,
  onImportComplete,
  onQueryChange,
  onToolbarActionsChange,
  observeActivation,
  projectOptions,
  query,
  showConfiguration = true,
  showHeader = true,
  toolbarPlacement = 'inline'
}: {
  activationActive?: boolean
  activeAdapter: NativeHistoryAdapter
  config?: NativeHistoryImportSettings
  fixedProjectScope?: NativeHistoryProjectScope
  initialShowAllTime?: boolean
  getModalContainer?: () => HTMLElement
  onActiveAdapterChange: (adapter: NativeHistoryAdapter) => void
  onConfigChange: (next: NativeHistoryImportSettings | undefined) => void
  onImportComplete?: () => Promise<void> | void
  onQueryChange?: (query: string) => void
  onToolbarActionsChange?: (actions: ActionSearchToolbarAction[]) => void
  observeActivation?: () => LauncherActivationObserver
  projectOptions?: ExternalSessionsProjectOption[]
  query?: string
  showConfiguration?: boolean
  showHeader?: boolean
  toolbarPlacement?: 'external' | 'inline'
}) {
  const { message } = App.useApp()
  const { i18n, t } = useTranslation()
  const { resolvedThemeMode } = useResolvedThemeMode()
  const runtimeHasCurrentProjectScope = getRuntimeWorkspaceId() != null
  const [uncontrolledProjectScope, setUncontrolledProjectScope] = useState<NativeHistoryProjectScope>(
    runtimeHasCurrentProjectScope ? 'current-project' : 'all-projects'
  )
  const projectScope = fixedProjectScope ?? uncontrolledProjectScope
  const [projectPaths, setProjectPaths] = useState<string[]>([])
  const hasCurrentProjectScope = fixedProjectScope == null && runtimeHasCurrentProjectScope
  const { isImporting, runImport } = useNativeHistoryImportAction()
  const showNativeHistoryImportNotification = useNativeHistoryImportNotification()
  const [isLauncherImporting, setIsLauncherImporting] = useState(false)
  useEffect(() => {
    if (!activationActive) setIsLauncherImporting(false)
  }, [activationActive])
  const globalSizeLimit = config != null && hasOwn(config, 'maxFileSizeBytes')
    ? config.maxFileSizeBytes
    : defaultNativeHistoryImportMaxFileSizeBytes
  const runImportAndRefreshProjects = useCallback(async (
    request: Parameters<typeof runImport>[0],
    activation?: LauncherActivationObserver
  ) => {
    if (activation == null) {
      const result = await runImport(request)
      if (result != null) await onImportComplete?.()
      return result
    }
    if (!activation.isCurrent() || isLauncherImporting) return undefined

    setIsLauncherImporting(true)
    try {
      const result = await runNativeProjectHistoryImport(request)
      if (!activation.isCurrent()) return undefined
      await showNativeHistoryImportNotification(result, { showEmpty: true })
      if (!activation.isCurrent()) return undefined
      await onImportComplete?.()
      return activation.isCurrent() ? result : undefined
    } catch (error) {
      if (activation.isCurrent()) {
        void message.error(getApiErrorMessage(error, t('nativeHistoryImport.failedDescription')))
      }
      return undefined
    } finally {
      if (activation.isCurrent()) setIsLauncherImporting(false)
    }
  }, [isLauncherImporting, message, onImportComplete, runImport, showNativeHistoryImportNotification, t])

  const updateConfig = useCallback((patch: Partial<NativeHistoryImportSettings>) => {
    onConfigChange(compactNativeHistoryImportSettings({
      ...(config ?? {}),
      ...patch
    }))
  }, [config, onConfigChange])

  const updateAdapterConfig = useCallback((
    adapter: NativeHistoryAdapter,
    patch: Partial<NonNullable<NativeHistoryImportSettings['adapters']>[NativeHistoryAdapter]>
  ) => {
    const adapters = {
      ...(config?.adapters ?? {}),
      [adapter]: {
        ...(config?.adapters?.[adapter] ?? {}),
        ...patch
      }
    }
    onConfigChange(compactNativeHistoryImportSettings({
      ...(config ?? {}),
      adapters
    }))
  }, [config, onConfigChange])

  const formatTimestamp = useCallback((value: number) => {
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) {
      return t('config.about.unknown')
    }
    return new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date)
  }, [i18n.language, i18n.resolvedLanguage, t])

  const formatBytes = useCallback((value: number) => {
    if (!Number.isFinite(value) || value <= 0) {
      return '0 B'
    }
    const units = ['B', 'KB', 'MB', 'GB']
    let nextValue = value
    let unitIndex = 0
    while (nextValue >= 1024 && unitIndex < units.length - 1) {
      nextValue /= 1024
      unitIndex += 1
    }
    return `${unitIndex === 0 ? nextValue.toFixed(0) : nextValue.toFixed(1)} ${units[unitIndex]}`
  }, [])

  return (
    <ConfigSectionFrame
      bodyClassName='config-view__external-session-body'
      icon={showHeader ? 'history' : undefined}
      title={showHeader ? t('config.sections.externalSessions') : undefined}
    >
      <div className='config-view__app-settings-list'>
        {showConfiguration && (
          <>
            <FieldRow
              title={t('nativeHistoryImport.manager.globalAutoImportTitle')}
              description={t('nativeHistoryImport.manager.globalAutoImportDescription')}
              icon='autorenew'
            >
              <Switch
                className='config-view__external-session-switch'
                checked={config?.autoImport === true}
                onChange={checked => updateConfig({ autoImport: checked })}
              />
            </FieldRow>

            <FieldRow
              title={t('nativeHistoryImport.manager.globalSizeLimitTitle')}
              description={t('nativeHistoryImport.manager.globalSizeLimitDescription')}
              icon='data_thresholding'
            >
              <InputNumber
                min={1}
                precision={0}
                placeholder={globalSizeLimit == null ? t('nativeHistoryImport.manager.unlimited') : '50'}
                suffix='MB'
                value={bytesToMegabytes(globalSizeLimit)}
                onChange={value => updateConfig({ maxFileSizeBytes: megabytesToBytes(value) })}
              />
            </FieldRow>
          </>
        )}

        <NativeTabs
          className='config-view__external-session-tabs'
          activeKey={activeAdapter}
          ariaLabel={t('config.sections.adapters')}
          onChange={onActiveAdapterChange}
          items={nativeHistoryAdapters.map(adapter => ({
            ariaControls: `external-sessions-panel-${adapter}`,
            icon: (() => {
              const adapterDisplay = getAdapterDisplay(adapter)
              const adapterIcon = resolveAdapterDisplayIcon(adapterDisplay, resolvedThemeMode)
              return adapterIcon == null
                ? 'deployed_code'
                : { src: adapterIcon, type: 'image' as const }
            })(),
            id: `external-sessions-tab-${adapter}`,
            key: adapter,
            label: t(getAdapterLabelKey(adapter))
          }))}
        />
        <div
          className='config-view__external-session-tabs-panel'
          data-native-tabs-panel='true'
        >
          {nativeHistoryAdapters.map(adapter => (
            <div
              aria-labelledby={`external-sessions-tab-${adapter}`}
              className='config-view__external-session-tab-pane'
              hidden={activeAdapter !== adapter}
              id={`external-sessions-panel-${adapter}`}
              key={adapter}
              role='tabpanel'
            >
              <ExternalSessionsAdapterTab
                adapter={adapter}
                config={config}
                globalSizeLimit={globalSizeLimit}
                getModalContainer={getModalContainer}
                formatBytes={formatBytes}
                formatTimestamp={formatTimestamp}
                isActive={activationActive && activeAdapter === adapter}
                isImporting={isImporting || isLauncherImporting}
                hasCurrentProjectScope={hasCurrentProjectScope}
                initialShowAllTime={initialShowAllTime}
                onAdapterConfigChange={patch => updateAdapterConfig(adapter, patch)}
                onProjectScopeChange={setUncontrolledProjectScope}
                onProjectPathsChange={setProjectPaths}
                onQueryChange={onQueryChange}
                onToolbarActionsChange={onToolbarActionsChange}
                observeActivation={observeActivation}
                projectScope={projectScope}
                projectOptions={projectOptions}
                projectPaths={projectPaths}
                query={query}
                runImport={runImportAndRefreshProjects}
                showSettings={showConfiguration}
                toolbarPlacement={toolbarPlacement}
              />
            </div>
          ))}
        </div>
      </div>
    </ConfigSectionFrame>
  )
}
