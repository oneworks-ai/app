/* eslint-disable max-lines -- shared configuration and import-only launcher composition stay together. */
import { InputNumber, Switch } from 'antd'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { NativeHistoryAdapter, NativeHistoryProjectScope } from '#~/api'
import type { ActionSearchToolbarAction } from '#~/components/action-search-toolbar/ActionSearchToolbar'
import { NativeTabs } from '#~/components/native-tabs'
import { useResolvedThemeMode } from '#~/hooks/use-resolved-theme-mode'
import { getAdapterDisplay, resolveAdapterDisplayIcon } from '#~/resources/adapters'
import { getRuntimeWorkspaceId } from '#~/runtime-config'
import { FieldRow } from './ConfigFieldRow'
import { ConfigSectionFrame } from './ConfigSectionFrame'
import { ExternalSessionsAdapterTab } from './ExternalSessionsAdapterTab'
import {
  compactNativeHistoryImportSettings,
  defaultNativeHistoryImportMaxFileSizeBytes,
  getAdapterLabelKey,
  isValidNativeHistorySizeLimit,
  megabytesToNativeHistoryBytes,
  nativeHistoryAdapters
} from './external-sessions-panel-model'
import type { ExternalSessionsProjectOption, NativeHistoryImportSettings } from './external-sessions-panel-model'
import { useNativeHistoryImportAction } from './use-native-history-import-action'

const bytesToMegabytes = (value: number | null | undefined) => value == null ? null : value / 1024 / 1024

export function ExternalSessionsPanel({
  activeAdapter,
  config,
  fixedProjectScope,
  initialShowAllTime = false,
  onActiveAdapterChange,
  onConfigChange,
  onImportComplete,
  onQueryChange,
  onToolbarActionsChange,
  projectOptions,
  query,
  showConfiguration = true,
  showHeader = true,
  toolbarPlacement = 'inline'
}: {
  activeAdapter: NativeHistoryAdapter
  config?: NativeHistoryImportSettings
  fixedProjectScope?: NativeHistoryProjectScope
  initialShowAllTime?: boolean
  onActiveAdapterChange: (adapter: NativeHistoryAdapter) => void
  onConfigChange: (next: NativeHistoryImportSettings | undefined) => void
  onImportComplete?: () => Promise<void> | void
  onQueryChange?: (query: string) => void
  onToolbarActionsChange?: (actions: ActionSearchToolbarAction[]) => void
  projectOptions?: ExternalSessionsProjectOption[]
  query?: string
  showConfiguration?: boolean
  showHeader?: boolean
  toolbarPlacement?: 'external' | 'inline'
}) {
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
  const runImportAndRefreshProjects = useCallback(async (
    request: Parameters<typeof runImport>[0]
  ) => {
    const result = await runImport(request)
    if (result != null) {
      await onImportComplete?.()
    }
    return result
  }, [onImportComplete, runImport])

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
              description={isValidNativeHistorySizeLimit(config?.maxFileSizeBytes)
                ? t('nativeHistoryImport.manager.globalSizeLimitDescription')
                : t('nativeHistoryImport.manager.invalidSizeLimitDescription')}
              icon='data_thresholding'
            >
              <InputNumber
                min={0}
                max={defaultNativeHistoryImportMaxFileSizeBytes / 1024 / 1024}
                precision={0}
                placeholder={t('nativeHistoryImport.manager.hardLimitMegabytes')}
                suffix='MB'
                value={bytesToMegabytes(config?.maxFileSizeBytes)}
                onChange={(value) => {
                  const bytes = megabytesToNativeHistoryBytes(value)
                  if (bytes !== undefined) updateConfig({ maxFileSizeBytes: bytes })
                }}
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
                formatBytes={formatBytes}
                formatTimestamp={formatTimestamp}
                isActive={activeAdapter === adapter}
                isImporting={isImporting}
                hasCurrentProjectScope={hasCurrentProjectScope}
                initialShowAllTime={initialShowAllTime}
                onAdapterConfigChange={patch => updateAdapterConfig(adapter, patch)}
                onProjectScopeChange={setUncontrolledProjectScope}
                onProjectPathsChange={setProjectPaths}
                onQueryChange={onQueryChange}
                onToolbarActionsChange={onToolbarActionsChange}
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
