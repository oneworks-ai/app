import { InputNumber, Switch, Tabs } from 'antd'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { NativeHistoryAdapter } from '#~/api'
import { useResolvedThemeMode } from '#~/hooks/use-resolved-theme-mode'
import { getAdapterDisplay, resolveAdapterDisplayIcon } from '#~/resources/adapters'

import { FieldRow } from './ConfigFieldRow'
import { ConfigSectionFrame } from './ConfigSectionFrame'
import { ExternalSessionsAdapterTab } from './ExternalSessionsAdapterTab'
import {
  compactNativeHistoryImportSettings,
  defaultNativeHistoryImportMaxFileSizeBytes,
  getAdapterLabelKey,
  nativeHistoryAdapters
} from './external-sessions-panel-model'
import type { NativeHistoryImportSettings } from './external-sessions-panel-model'
import { useNativeHistoryImportAction } from './use-native-history-import-action'

const bytesToMegabytes = (value: number | null | undefined) => value == null ? null : value / 1024 / 1024
const megabytesToBytes = (value: number | null) => value == null ? null : Math.round(value * 1024 * 1024)
const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)

export function ExternalSessionsPanel({
  config,
  onConfigChange,
  showHeader = true
}: {
  config?: NativeHistoryImportSettings
  onConfigChange: (next: NativeHistoryImportSettings | undefined) => void
  showHeader?: boolean
}) {
  const { i18n, t } = useTranslation()
  const { resolvedThemeMode } = useResolvedThemeMode()
  const [activeAdapter, setActiveAdapter] = useState<NativeHistoryAdapter>('codex')
  const { isImporting, runImport } = useNativeHistoryImportAction()
  const globalSizeLimit = config != null && hasOwn(config, 'maxFileSizeBytes')
    ? config.maxFileSizeBytes
    : defaultNativeHistoryImportMaxFileSizeBytes

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
        <FieldRow
          title={t('nativeHistoryImport.manager.globalAutoImportTitle')}
          description={t('nativeHistoryImport.manager.globalAutoImportDescription')}
          icon='autorenew'
        >
          <Switch
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

        <Tabs
          className='config-view__external-session-tabs'
          activeKey={activeAdapter}
          animated={false}
          onChange={key => setActiveAdapter(key as NativeHistoryAdapter)}
          items={nativeHistoryAdapters.map(adapter => ({
            key: adapter,
            label: (() => {
              const adapterDisplay = getAdapterDisplay(adapter)
              const adapterIcon = resolveAdapterDisplayIcon(adapterDisplay, resolvedThemeMode)
              return (
                <span className='config-view__external-session-tab-label'>
                  {adapterIcon == null
                    ? (
                      <span
                        className='config-view__external-session-tab-icon config-view__external-session-tab-icon--fallback material-symbols-rounded'
                        aria-hidden='true'
                      >
                        deployed_code
                      </span>
                    )
                    : (
                      <img
                        className='config-view__external-session-tab-icon'
                        src={adapterIcon}
                        alt=''
                        aria-hidden='true'
                      />
                    )}
                  <span>{t(getAdapterLabelKey(adapter))}</span>
                </span>
              )
            })(),
            children: (
              <ExternalSessionsAdapterTab
                adapter={adapter}
                config={config}
                globalSizeLimit={globalSizeLimit}
                formatBytes={formatBytes}
                formatTimestamp={formatTimestamp}
                isActive={activeAdapter === adapter}
                isImporting={isImporting}
                onAdapterConfigChange={patch => updateAdapterConfig(adapter, patch)}
                runImport={runImport}
              />
            )
          }))}
        />
      </div>
    </ConfigSectionFrame>
  )
}
