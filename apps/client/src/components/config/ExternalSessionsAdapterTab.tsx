/* eslint-disable max-lines -- candidate search, bulk import, and per-row import stay together for this narrow panel. */
import { Button, Empty, InputNumber, Space, Switch } from 'antd'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { previewNativeProjectHistory } from '#~/api'
import type { NativeHistoryAdapter, NativeHistoryImportAdapterPreview, NativeHistoryImportResult } from '#~/api'
import { ActionSearchToolbar } from '#~/components/action-search-toolbar/ActionSearchToolbar'

import { FieldRow } from './ConfigFieldRow'
import { getAdapterLabelKey, nativeHistoryAdapterIcons } from './external-sessions-panel-model'
import type { NativeHistoryImportAdapterSettings, NativeHistoryImportSettings } from './external-sessions-panel-model'

const bytesToMegabytes = (value: number | null | undefined) => value == null ? null : value / 1024 / 1024
const megabytesToBytes = (value: number | null) => value == null ? null : Math.round(value * 1024 * 1024)
const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
type CandidateScopeFilter = 'all' | 'archived'

export function ExternalSessionsAdapterTab({
  adapter,
  config,
  globalSizeLimit,
  formatBytes,
  formatTimestamp,
  isActive,
  isImporting,
  onAdapterConfigChange,
  runImport
}: {
  adapter: NativeHistoryAdapter
  config?: NativeHistoryImportSettings
  globalSizeLimit?: number | null
  formatBytes: (value: number) => string
  formatTimestamp: (value: number) => string
  isActive: boolean
  isImporting: boolean
  onAdapterConfigChange: (patch: Partial<NativeHistoryImportAdapterSettings>) => void
  runImport: (request: {
    adapters?: NativeHistoryAdapter[]
    sourcePaths?: string[]
  }) => Promise<NativeHistoryImportResult | undefined>
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [candidateScopeFilter, setCandidateScopeFilter] = useState<CandidateScopeFilter>(
    adapter === 'codex' ? 'archived' : 'all'
  )
  const [expandedPanel, setExpandedPanel] = useState<'filter' | undefined>()
  const {
    data: preview,
    isLoading: isPreviewLoading,
    mutate: refreshPreview
  } = useSWR<NativeHistoryImportAdapterPreview | undefined>(
    isActive ? ['native-history-import-preview', adapter] : null,
    async () => {
      const result = await previewNativeProjectHistory({ adapters: [adapter] })
      return result.adapters.find(item => item.adapter === adapter)
    },
    {
      keepPreviousData: true,
      revalidateIfStale: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false
    }
  )
  const adapterConfig = config?.adapters?.[adapter] ?? {}
  const platformLabel = t(getAdapterLabelKey(adapter))
  const hasAutoOverride = hasOwn(adapterConfig, 'autoImport')
  const hasSizeOverride = hasOwn(adapterConfig, 'maxFileSizeBytes')
  const effectiveAutoImport = adapterConfig.autoImport ?? config?.autoImport ?? false
  const effectiveSizeLimit = hasSizeOverride ? adapterConfig.maxFileSizeBytes : globalSizeLimit
  const matchedFiles = preview?.matchedFiles ?? 0
  const hasCandidateFilter = candidateScopeFilter !== 'all'
  const filteredCandidates = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const candidates = preview?.candidates.filter(candidate =>
      !candidate.isImported && (candidateScopeFilter === 'all' || candidate.isArchived)
    ) ?? []
    if (normalizedQuery === '') {
      return candidates
    }
    return candidates.filter(candidate =>
      [
        candidate.title,
        candidate.cwd,
        candidate.nativeSessionId,
        candidate.sourcePath
      ].some(value =>
        value.toLowerCase().includes(normalizedQuery)
      )
    )
  }, [candidateScopeFilter, preview?.candidates, query])

  const handleImportSourcePaths = useCallback(async (sourcePaths: string[]) => {
    if (sourcePaths.length === 0) {
      return
    }
    const result = await runImport({
      adapters: [adapter],
      sourcePaths
    })
    if (result != null) {
      await refreshPreview()
    }
  }, [adapter, refreshPreview, runImport])

  const handleImportVisible = useCallback(async () => {
    await handleImportSourcePaths(filteredCandidates.map(candidate => candidate.sourcePath))
  }, [filteredCandidates, handleImportSourcePaths])
  const togglePanel = (panel: 'filter') => {
    setExpandedPanel(current => current === panel ? undefined : panel)
  }

  return (
    <div className='config-view__external-session-tab'>
      <FieldRow
        title={t('nativeHistoryImport.manager.adapterAutoImportTitle', { platform: platformLabel })}
        description={hasAutoOverride
          ? t('nativeHistoryImport.manager.adapterAutoImportOverride')
          : t('nativeHistoryImport.manager.adapterAutoImportInherited', {
            state: t(
              effectiveAutoImport
                ? 'nativeHistoryImport.manager.enabled'
                : 'nativeHistoryImport.manager.disabled'
            )
          })}
        icon='rule_settings'
      >
        <Space wrap>
          <Switch
            checked={effectiveAutoImport}
            onChange={checked => onAdapterConfigChange({ autoImport: checked })}
          />
          {hasAutoOverride && (
            <Button size='small' onClick={() => onAdapterConfigChange({ autoImport: undefined })}>
              {t('nativeHistoryImport.manager.inheritGlobal')}
            </Button>
          )}
        </Space>
      </FieldRow>

      <FieldRow
        title={t('nativeHistoryImport.manager.adapterSizeLimitTitle', { platform: platformLabel })}
        description={t('nativeHistoryImport.manager.effectiveSizeLimit', {
          size: effectiveSizeLimit == null
            ? t('nativeHistoryImport.manager.unlimited')
            : formatBytes(effectiveSizeLimit)
        })}
        icon='data_thresholding'
      >
        <Space className='config-view__external-session-size-control' wrap>
          <InputNumber
            min={1}
            precision={0}
            placeholder={hasSizeOverride
              ? t('nativeHistoryImport.manager.unlimited')
              : t('nativeHistoryImport.manager.inheritGlobal')}
            suffix='MB'
            value={hasSizeOverride ? bytesToMegabytes(adapterConfig.maxFileSizeBytes) : null}
            onChange={value => onAdapterConfigChange({ maxFileSizeBytes: megabytesToBytes(value) })}
          />
          {hasSizeOverride && (
            <Button size='small' onClick={() => onAdapterConfigChange({ maxFileSizeBytes: undefined })}>
              {t('nativeHistoryImport.manager.inheritGlobal')}
            </Button>
          )}
        </Space>
      </FieldRow>

      <section className='config-view__external-session-candidates'>
        <ActionSearchToolbar
          className='config-view__external-session-toolbar'
          query={query}
          placeholder={t('nativeHistoryImport.manager.searchPlaceholder')}
          onQueryChange={setQuery}
          actions={[{
            active: expandedPanel === 'filter',
            ariaLabel: t('nativeHistoryImport.manager.archivedFilter'),
            hasIndicator: hasCandidateFilter,
            icon: 'filter_alt',
            key: 'archived-filter',
            onClick: () => togglePanel('filter'),
            pressed: expandedPanel === 'filter',
            title: hasCandidateFilter
              ? t('nativeHistoryImport.manager.archivedFilterActive')
              : t('nativeHistoryImport.manager.archivedFilter')
          }, {
            ariaLabel: t('nativeHistoryImport.manager.importAll'),
            disabled: filteredCandidates.length === 0,
            icon: 'download',
            key: 'import',
            loading: isImporting,
            onClick: () => {
              void handleImportVisible()
            },
            title: t('nativeHistoryImport.manager.importAll')
          }]}
        />

        {expandedPanel === 'filter' && (
          <div className='config-view__external-session-panel config-view__external-session-panel--filter'>
            <div className='config-view__external-session-filter-row'>
              <span className='config-view__external-session-filter-label'>
                {t('nativeHistoryImport.manager.filterScope')}
              </span>
              <div className='config-view__external-session-filter-options'>
                {(['all', 'archived'] as const).map(option => (
                  <Button
                    key={option}
                    className={`config-view__external-session-filter-option${
                      candidateScopeFilter === option ? ' is-active' : ''
                    }`}
                    type='text'
                    size='small'
                    onClick={() => setCandidateScopeFilter(option)}
                  >
                    {option === 'all'
                      ? t('nativeHistoryImport.manager.filterAll')
                      : t('nativeHistoryImport.manager.archivedFilterCondition')}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className='config-view__external-session-candidate-list'>
          {preview == null || matchedFiles === 0 || filteredCandidates.length === 0
            ? (
              <div className='config-view__detail-list-empty'>
                <Empty
                  description={isPreviewLoading
                    ? t('nativeHistoryImport.manager.previewLoading')
                    : matchedFiles === 0
                    ? t('nativeHistoryImport.manager.emptyCandidates', { platform: platformLabel })
                    : t('nativeHistoryImport.manager.emptySearchResults')}
                />
              </div>
            )
            : (
              <div className='config-view__app-settings-group config-view__external-session-candidate-group'>
                {filteredCandidates.map(candidate => (
                  <FieldRow
                    key={candidate.sourcePath}
                    title={candidate.title}
                    description={[
                      formatTimestamp(candidate.updatedAt),
                      candidate.cwd
                    ].filter(Boolean).join(' · ')}
                    icon={nativeHistoryAdapterIcons[adapter]}
                  >
                    <span
                      className={`config-view__external-session-size${
                        effectiveSizeLimit != null && candidate.fileSizeBytes > effectiveSizeLimit
                          ? ' config-view__external-session-size--large'
                          : ''
                      }`}
                      title={candidate.sourcePath}
                    >
                      {effectiveSizeLimit != null && candidate.fileSizeBytes > effectiveSizeLimit
                        ? t('nativeHistoryImport.manager.autoSkippedSize', {
                          size: formatBytes(candidate.fileSizeBytes)
                        })
                        : formatBytes(candidate.fileSizeBytes)}
                    </span>
                    <Button
                      size='small'
                      disabled={candidate.isImported}
                      loading={isImporting}
                      icon={<span className='material-symbols-rounded'>download</span>}
                      onClick={() => {
                        void handleImportSourcePaths([candidate.sourcePath])
                      }}
                    >
                      {candidate.isImported
                        ? t('nativeHistoryImport.manager.alreadyImported')
                        : t('nativeHistoryImport.manager.importOne')}
                    </Button>
                  </FieldRow>
                ))}
              </div>
            )}
        </div>
      </section>
    </div>
  )
}
