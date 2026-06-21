/* eslint-disable max-lines -- candidate search, bulk import, and per-row import stay together for this narrow panel. */
import { ShortcutTooltip } from '@oneworks/components/route-layout'
import { Button, DatePicker, Empty, InputNumber, Space, Switch, message } from 'antd'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWRInfinite from 'swr/infinite'

import { previewNativeProjectHistory } from '#~/api'
import type {
  NativeHistoryAdapter,
  NativeHistoryCandidateScope,
  NativeHistoryImportAdapterPreview,
  NativeHistoryImportResult,
  NativeHistoryProjectScope,
  NativeHistoryThreadScope,
  NativeHistoryTimeFilter,
  NativeHistoryTimeRange,
  NativeHistoryTimeSort
} from '#~/api'
import { ActionSearchToolbar } from '#~/components/action-search-toolbar/ActionSearchToolbar'
import { copyTextWithFeedback } from '#~/utils/copy'

import { FieldRow } from './ConfigFieldRow'
import { getAdapterLabelKey, nativeHistoryAdapterIcons } from './external-sessions-panel-model'
import type { NativeHistoryImportAdapterSettings, NativeHistoryImportSettings } from './external-sessions-panel-model'

const bytesToMegabytes = (value: number | null | undefined) => value == null ? null : value / 1024 / 1024
const megabytesToBytes = (value: number | null) => value == null ? null : Math.round(value * 1024 * 1024)
const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
const { RangePicker } = DatePicker
type CandidateScopeFilter = NativeHistoryCandidateScope
type ThreadScopeFilter = NativeHistoryThreadScope
type DateRangeValue = [Dayjs | null, Dayjs | null] | null
type TimeRangePreset = 'last-day' | 'last-week' | 'last-30-days' | 'last-90-days'
const PREVIEW_PAGE_LIMIT = 24
const candidateScopeFilterOptions: CandidateScopeFilter[] = ['all', 'unarchived', 'archived']
const threadScopeFilterOptions: ThreadScopeFilter[] = ['all', 'user', 'subagent']
const projectScopeFilterOptions: NativeHistoryProjectScope[] = ['all-projects', 'current-project']
const timeSortOptions: NativeHistoryTimeSort[] = ['activity', 'updatedAt', 'createdAt']
const timeRangePresetOptions: TimeRangePreset[] = ['last-day', 'last-week', 'last-30-days', 'last-90-days']
const candidateScopeFilterIcons: Record<CandidateScopeFilter, string> = {
  all: 'select_all',
  archived: 'archive',
  unarchived: 'inventory_2'
}
const threadScopeFilterIcons: Record<ThreadScopeFilter, string> = {
  all: 'select_all',
  subagent: 'account_tree',
  user: 'person'
}
const projectScopeFilterIcons: Record<NativeHistoryProjectScope, string> = {
  'all-projects': 'public',
  'current-project': 'folder_open'
}
const timeSortIcons: Record<NativeHistoryTimeSort, string> = {
  activity: 'sort',
  createdAt: 'event',
  updatedAt: 'update'
}
const timeRangePresetIcons: Record<TimeRangePreset, string> = {
  'last-30-days': 'calendar_month',
  'last-90-days': 'history',
  'last-day': 'today',
  'last-week': 'date_range'
}
const timeRangePresetDurations: Record<TimeRangePreset, number> = {
  'last-30-days': 30 * 24 * 60 * 60 * 1000,
  'last-90-days': 90 * 24 * 60 * 60 * 1000,
  'last-day': 24 * 60 * 60 * 1000,
  'last-week': 7 * 24 * 60 * 60 * 1000
}

const createRelativeTimeRange = (preset: TimeRangePreset, now = Date.now()): NativeHistoryTimeRange => ({
  from: now - timeRangePresetDurations[preset]
})

const hasTimeRange = (range: NativeHistoryTimeRange | undefined): range is NativeHistoryTimeRange => (
  range?.from != null || range?.to != null
)

const compactTimeFilter = (
  filter: NativeHistoryTimeFilter
): NativeHistoryTimeFilter | undefined => {
  const createdAt = hasTimeRange(filter.createdAt) ? filter.createdAt : undefined
  const updatedAt = hasTimeRange(filter.updatedAt) ? filter.updatedAt : undefined
  return createdAt == null && updatedAt == null
    ? undefined
    : {
      ...(createdAt == null ? {} : { createdAt }),
      ...(updatedAt == null ? {} : { updatedAt })
    }
}

const timeRangeToDateRangeValue = (range: NativeHistoryTimeRange | undefined): DateRangeValue => (
  range == null ? null : [
    range.from == null ? null : dayjs(range.from),
    range.to == null ? null : dayjs(range.to)
  ]
)

const dateRangeValueToTimeRange = (value: DateRangeValue): NativeHistoryTimeRange | undefined => {
  const from = value?.[0]?.valueOf()
  const to = value?.[1]?.valueOf()
  return from == null && to == null
    ? undefined
    : {
      ...(from == null ? {} : { from }),
      ...(to == null ? {} : { to })
    }
}

const resolveMatchingTimeRangePreset = (
  range: NativeHistoryTimeRange | undefined,
  now = Date.now()
): TimeRangePreset | undefined => {
  if (range?.from == null || range.to != null) {
    return undefined
  }
  return timeRangePresetOptions.find((preset) => {
    const duration = timeRangePresetDurations[preset]
    return Math.abs((now - range.from!) - duration) < 60_000
  })
}

export function ExternalSessionsAdapterTab({
  adapter,
  config,
  globalSizeLimit,
  formatBytes,
  formatTimestamp,
  hasCurrentProjectScope,
  isActive,
  isImporting,
  onAdapterConfigChange,
  onProjectScopeChange,
  projectScope,
  runImport
}: {
  adapter: NativeHistoryAdapter
  config?: NativeHistoryImportSettings
  globalSizeLimit?: number | null
  formatBytes: (value: number) => string
  formatTimestamp: (value: number) => string
  hasCurrentProjectScope: boolean
  isActive: boolean
  isImporting: boolean
  onAdapterConfigChange: (patch: Partial<NativeHistoryImportAdapterSettings>) => void
  onProjectScopeChange: (scope: NativeHistoryProjectScope) => void
  projectScope: NativeHistoryProjectScope
  runImport: (request: {
    adapters?: NativeHistoryAdapter[]
    projectScope?: NativeHistoryProjectScope
    sourcePaths?: string[]
    threadScope?: NativeHistoryThreadScope
    timeFilter?: NativeHistoryTimeFilter
    timeSort?: NativeHistoryTimeSort
  }) => Promise<NativeHistoryImportResult | undefined>
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [candidateScopeFilter, setCandidateScopeFilter] = useState<CandidateScopeFilter>('unarchived')
  const [threadScopeFilter, setThreadScopeFilter] = useState<ThreadScopeFilter>('user')
  const [createdAtRange, setCreatedAtRange] = useState<NativeHistoryTimeRange | undefined>()
  const [createdAtPreset, setCreatedAtPreset] = useState<TimeRangePreset | undefined>()
  const [updatedAtRange, setUpdatedAtRange] = useState<NativeHistoryTimeRange | undefined>(
    () => createRelativeTimeRange('last-week')
  )
  const [updatedAtPreset, setUpdatedAtPreset] = useState<TimeRangePreset | undefined>('last-week')
  const [timeSort, setTimeSort] = useState<NativeHistoryTimeSort>('activity')
  const [expandedPanel, setExpandedPanel] = useState<'filter' | undefined>()
  const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac')
  const previewTimeFilter = useMemo(() =>
    compactTimeFilter({
      createdAt: createdAtRange,
      updatedAt: updatedAtRange
    }), [createdAtRange, updatedAtRange])
  const {
    data: previewPages,
    isLoading: isPreviewLoading,
    isValidating: isPreviewValidating,
    mutate: refreshPreview,
    setSize: setPreviewPageCount,
    size: previewPageCount
  } = useSWRInfinite<NativeHistoryImportAdapterPreview | undefined>(
    (pageIndex, previousPage) => {
      if (!isActive) {
        return null
      }
      if (pageIndex > 0 && previousPage?.nextCursor == null) {
        return null
      }
      return [
        'native-history-import-preview',
        adapter,
        candidateScopeFilter,
        threadScopeFilter,
        projectScope,
        timeSort,
        previewTimeFilter?.createdAt?.from ?? null,
        previewTimeFilter?.createdAt?.to ?? null,
        previewTimeFilter?.updatedAt?.from ?? null,
        previewTimeFilter?.updatedAt?.to ?? null,
        pageIndex === 0 ? null : previousPage?.nextCursor ?? null
      ]
    },
    async ([, , , , , , , , , , cursor]) => {
      const result = await previewNativeProjectHistory({
        adapters: [adapter],
        candidateScope: candidateScopeFilter,
        cursor: typeof cursor === 'string' ? cursor : undefined,
        limit: PREVIEW_PAGE_LIMIT,
        projectScope,
        threadScope: threadScopeFilter,
        timeFilter: previewTimeFilter,
        timeSort
      })
      return result.adapters.find(item => item.adapter === adapter)
    },
    {
      keepPreviousData: true,
      dedupingInterval: 30_000,
      focusThrottleInterval: 30_000,
      revalidateIfStale: true,
      revalidateOnFocus: true,
      revalidateOnReconnect: false
    }
  )
  const preview = useMemo<NativeHistoryImportAdapterPreview | undefined>(() => {
    const pages = previewPages?.filter((page): page is NativeHistoryImportAdapterPreview => page != null) ?? []
    if (pages.length === 0) {
      return undefined
    }
    const candidates = pages.flatMap(page => page.candidates)
    const lastPage = pages.at(-1)!
    return {
      adapter,
      candidates,
      hasMore: lastPage.hasMore,
      isComplete: pages.every(page => page.isComplete),
      largeFiles: pages.reduce((sum, page) => sum + page.largeFiles, 0),
      largestFileBytes: Math.max(0, ...pages.map(page => page.largestFileBytes)),
      matchedFiles: pages.reduce((sum, page) => sum + page.matchedFiles, 0),
      ...(lastPage.nextCursor == null ? {} : { nextCursor: lastPage.nextCursor }),
      scannedFiles: Math.max(0, ...pages.map(page => page.scannedFiles)),
      totalBytes: pages.reduce((sum, page) => sum + page.totalBytes, 0)
    }
  }, [adapter, previewPages])
  const adapterConfig = config?.adapters?.[adapter] ?? {}
  const platformLabel = t(getAdapterLabelKey(adapter))
  const hasAutoOverride = hasOwn(adapterConfig, 'autoImport')
  const hasSizeOverride = hasOwn(adapterConfig, 'maxFileSizeBytes')
  const effectiveAutoImport = adapterConfig.autoImport ?? config?.autoImport ?? false
  const effectiveSizeLimit = hasSizeOverride ? adapterConfig.maxFileSizeBytes : globalSizeLimit
  const matchedFiles = preview?.matchedFiles ?? 0
  const hasMorePreview = preview?.hasMore === true
  const isLoadingMorePreview = isPreviewValidating && previewPages?.[previewPageCount - 1] == null
  const candidateScopeFilterLabel = candidateScopeFilter === 'all'
    ? t('nativeHistoryImport.manager.filterAll')
    : candidateScopeFilter === 'unarchived'
    ? t('nativeHistoryImport.manager.unarchivedFilterCondition')
    : t('nativeHistoryImport.manager.archivedFilterCondition')
  const threadScopeFilterLabel = threadScopeFilter === 'all'
    ? t('nativeHistoryImport.manager.filterAll')
    : threadScopeFilter === 'subagent'
    ? t('nativeHistoryImport.manager.threadScopeSubagent')
    : t('nativeHistoryImport.manager.threadScopeUser')
  const projectScopeLabel = projectScope === 'current-project'
    ? t('nativeHistoryImport.manager.projectScopeCurrent')
    : t('nativeHistoryImport.manager.projectScopeGlobal')
  const formatTimeRangeLabel = (range: NativeHistoryTimeRange) => {
    if (range.from != null && range.to != null) {
      return t('nativeHistoryImport.manager.timeRangeBetween', {
        from: formatTimestamp(range.from),
        to: formatTimestamp(range.to)
      })
    }
    if (range.from != null) {
      return t('nativeHistoryImport.manager.timeRangeFrom', {
        time: formatTimestamp(range.from)
      })
    }
    return t('nativeHistoryImport.manager.timeRangeTo', {
      time: formatTimestamp(range.to!)
    })
  }
  const createdAtFilterLabel = hasTimeRange(createdAtRange)
    ? t('nativeHistoryImport.manager.timeFilterLabel', {
      field: t('nativeHistoryImport.manager.createdTime'),
      range: formatTimeRangeLabel(createdAtRange)
    })
    : undefined
  const updatedAtFilterLabel = hasTimeRange(updatedAtRange)
    ? t('nativeHistoryImport.manager.timeFilterLabel', {
      field: t('nativeHistoryImport.manager.updatedTime'),
      range: formatTimeRangeLabel(updatedAtRange)
    })
    : undefined
  const timeSortLabel = timeSort === 'activity'
    ? t('nativeHistoryImport.manager.timeSortActivity')
    : timeSort === 'updatedAt'
    ? t('nativeHistoryImport.manager.updatedTime')
    : t('nativeHistoryImport.manager.createdTime')
  const activeFilterLabels = [
    ...(candidateScopeFilter === 'all' ? [] : [candidateScopeFilterLabel]),
    ...(threadScopeFilter === 'all' ? [] : [threadScopeFilterLabel]),
    ...(projectScope === 'all-projects' ? [] : [projectScopeLabel]),
    ...(updatedAtFilterLabel == null ? [] : [updatedAtFilterLabel]),
    ...(createdAtFilterLabel == null ? [] : [createdAtFilterLabel]),
    ...(timeSort === 'activity' ? [] : [
      t('nativeHistoryImport.manager.timeSortFilterLabel', { sort: timeSortLabel })
    ])
  ]
  const hasCandidateFilter = activeFilterLabels.length > 0
  const activeFilterLabel = activeFilterLabels.join(' / ')
  const filteredCandidates = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const candidates = preview?.candidates.filter(candidate =>
      !candidate.isImported && (
        candidateScopeFilter === 'all' ||
        (candidateScopeFilter === 'unarchived' ? !candidate.isArchived : candidate.isArchived)
      ) && (
        threadScopeFilter === 'all' ||
        (threadScopeFilter === 'subagent'
          ? candidate.threadSource === 'subagent'
          : candidate.threadSource !== 'subagent')
      )
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
      ].some(value => value.toLowerCase().includes(normalizedQuery))
    )
  }, [candidateScopeFilter, preview?.candidates, query, threadScopeFilter])

  const handleImportSourcePaths = useCallback(async (sourcePaths: string[]) => {
    if (sourcePaths.length === 0) {
      return
    }
    const result = await runImport({
      adapters: [adapter],
      projectScope,
      sourcePaths,
      threadScope: threadScopeFilter,
      timeFilter: previewTimeFilter,
      timeSort
    })
    if (result != null) {
      await refreshPreview()
    }
  }, [adapter, previewTimeFilter, projectScope, refreshPreview, runImport, threadScopeFilter, timeSort])

  const handleImportVisible = useCallback(async () => {
    await handleImportSourcePaths(filteredCandidates.map(candidate => candidate.sourcePath))
  }, [filteredCandidates, handleImportSourcePaths])
  const handleCopyCodexThreadLink = useCallback((nativeSessionId: string) => {
    void copyTextWithFeedback({
      failureMessage: t('common.copyFailed'),
      messageApi: message,
      successMessage: t('nativeHistoryImport.manager.codexThreadLinkCopied'),
      text: `codex://threads/${nativeSessionId}`
    })
  }, [t])
  const handleLoadMorePreview = useCallback(() => {
    void setPreviewPageCount(count => count + 1)
  }, [setPreviewPageCount])
  const togglePanel = (panel: 'filter') => {
    setExpandedPanel(current => current === panel ? undefined : panel)
  }
  const getTimeRangePresetLabel = (preset: TimeRangePreset) => {
    if (preset === 'last-day') {
      return t('nativeHistoryImport.manager.timePresetLastDay')
    }
    if (preset === 'last-week') {
      return t('nativeHistoryImport.manager.timePresetLastWeek')
    }
    if (preset === 'last-30-days') {
      return t('nativeHistoryImport.manager.timePresetLast30Days')
    }
    return t('nativeHistoryImport.manager.timePresetLast90Days')
  }
  const renderTimeRangePresetFooter = (
    activePreset: TimeRangePreset | undefined,
    applyPreset: (preset: TimeRangePreset) => void
  ) => (
    <div className='config-view__external-session-picker-presets'>
      {timeRangePresetOptions.map(preset => (
        <Button
          key={preset}
          className={`config-view__external-session-filter-option${activePreset === preset ? ' is-active' : ''}`}
          type='text'
          size='small'
          onMouseDown={event => event.preventDefault()}
          onClick={() => applyPreset(preset)}
        >
          <span className='material-symbols-rounded' aria-hidden='true'>
            {timeRangePresetIcons[preset]}
          </span>
          <span>{getTimeRangePresetLabel(preset)}</span>
        </Button>
      ))}
    </div>
  )

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
        <Space className='config-view__external-session-switch-control' wrap>
          <Switch
            className='config-view__external-session-switch'
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
            ariaLabel: t('nativeHistoryImport.manager.filterSessions'),
            hasIndicator: hasCandidateFilter,
            icon: 'filter_alt',
            key: 'archived-filter',
            onClick: () => togglePanel('filter'),
            pressed: expandedPanel === 'filter',
            title: hasCandidateFilter
              ? t('nativeHistoryImport.manager.filterActive', { scope: activeFilterLabel })
              : t('nativeHistoryImport.manager.filterSessions')
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
                <span
                  className='config-view__external-session-filter-label-icon material-symbols-rounded'
                  aria-hidden='true'
                >
                  filter_alt
                </span>
                {t('nativeHistoryImport.manager.filterScope')}
              </span>
              <div className='config-view__external-session-filter-options'>
                {candidateScopeFilterOptions.map(option => (
                  <Button
                    key={option}
                    className={`config-view__external-session-filter-option${
                      candidateScopeFilter === option ? ' is-active' : ''
                    }`}
                    type='text'
                    size='small'
                    onClick={() => setCandidateScopeFilter(option)}
                  >
                    <span className='material-symbols-rounded' aria-hidden='true'>
                      {candidateScopeFilterIcons[option]}
                    </span>
                    <span>
                      {option === 'all'
                        ? t('nativeHistoryImport.manager.filterAll')
                        : option === 'unarchived'
                        ? t('nativeHistoryImport.manager.unarchivedFilterCondition')
                        : t('nativeHistoryImport.manager.archivedFilterCondition')}
                    </span>
                  </Button>
                ))}
              </div>
            </div>
            <div className='config-view__external-session-filter-row'>
              <span className='config-view__external-session-filter-label'>
                <span
                  className='config-view__external-session-filter-label-icon material-symbols-rounded'
                  aria-hidden='true'
                >
                  account_tree
                </span>
                {t('nativeHistoryImport.manager.threadScope')}
              </span>
              <div className='config-view__external-session-filter-options'>
                {threadScopeFilterOptions.map(option => (
                  <Button
                    key={option}
                    className={`config-view__external-session-filter-option${
                      threadScopeFilter === option ? ' is-active' : ''
                    }`}
                    type='text'
                    size='small'
                    onClick={() => setThreadScopeFilter(option)}
                  >
                    <span className='material-symbols-rounded' aria-hidden='true'>
                      {threadScopeFilterIcons[option]}
                    </span>
                    <span>
                      {option === 'all'
                        ? t('nativeHistoryImport.manager.filterAll')
                        : option === 'subagent'
                        ? t('nativeHistoryImport.manager.threadScopeSubagent')
                        : t('nativeHistoryImport.manager.threadScopeUser')}
                    </span>
                  </Button>
                ))}
              </div>
            </div>
            <div className='config-view__external-session-filter-row'>
              <span className='config-view__external-session-filter-label'>
                <span
                  className='config-view__external-session-filter-label-icon material-symbols-rounded'
                  aria-hidden='true'
                >
                  folder_open
                </span>
                {t('nativeHistoryImport.manager.projectScope')}
              </span>
              <div className='config-view__external-session-filter-options'>
                {projectScopeFilterOptions.map(option => (
                  <Button
                    key={option}
                    className={`config-view__external-session-filter-option${
                      projectScope === option ? ' is-active' : ''
                    }`}
                    disabled={option === 'current-project' && !hasCurrentProjectScope}
                    type='text'
                    size='small'
                    onClick={() => onProjectScopeChange(option)}
                  >
                    <span className='material-symbols-rounded' aria-hidden='true'>
                      {projectScopeFilterIcons[option]}
                    </span>
                    <span>
                      {option === 'current-project'
                        ? t('nativeHistoryImport.manager.projectScopeCurrent')
                        : t('nativeHistoryImport.manager.projectScopeGlobal')}
                    </span>
                  </Button>
                ))}
              </div>
            </div>
            <div className='config-view__external-session-filter-row config-view__external-session-filter-row--time'>
              <span className='config-view__external-session-filter-label'>
                <span
                  className='config-view__external-session-filter-label-icon material-symbols-rounded'
                  aria-hidden='true'
                >
                  update
                </span>
                {t('nativeHistoryImport.manager.updatedTime')}
              </span>
              <div className='config-view__external-session-time-range'>
                <RangePicker
                  allowClear
                  allowEmpty={[true, true]}
                  className='config-view__external-session-date-range'
                  placeholder={[
                    t('nativeHistoryImport.manager.timeRangeStart'),
                    t('nativeHistoryImport.manager.timeRangeEnd')
                  ]}
                  renderExtraFooter={() =>
                    renderTimeRangePresetFooter(updatedAtPreset, (preset) => {
                      setUpdatedAtRange(createRelativeTimeRange(preset))
                      setUpdatedAtPreset(preset)
                    })}
                  showTime
                  value={timeRangeToDateRangeValue(updatedAtRange)}
                  onChange={(value) => {
                    const nextRange = dateRangeValueToTimeRange(value as DateRangeValue)
                    setUpdatedAtRange(nextRange)
                    setUpdatedAtPreset(resolveMatchingTimeRangePreset(nextRange))
                  }}
                />
              </div>
            </div>
            <div className='config-view__external-session-filter-row config-view__external-session-filter-row--time'>
              <span className='config-view__external-session-filter-label'>
                <span
                  className='config-view__external-session-filter-label-icon material-symbols-rounded'
                  aria-hidden='true'
                >
                  event
                </span>
                {t('nativeHistoryImport.manager.createdTime')}
              </span>
              <div className='config-view__external-session-time-range'>
                <RangePicker
                  allowClear
                  allowEmpty={[true, true]}
                  className='config-view__external-session-date-range'
                  placeholder={[
                    t('nativeHistoryImport.manager.timeRangeStart'),
                    t('nativeHistoryImport.manager.timeRangeEnd')
                  ]}
                  renderExtraFooter={() =>
                    renderTimeRangePresetFooter(createdAtPreset, (preset) => {
                      setCreatedAtRange(createRelativeTimeRange(preset))
                      setCreatedAtPreset(preset)
                    })}
                  showTime
                  value={timeRangeToDateRangeValue(createdAtRange)}
                  onChange={(value) => {
                    const nextRange = dateRangeValueToTimeRange(value as DateRangeValue)
                    setCreatedAtRange(nextRange)
                    setCreatedAtPreset(resolveMatchingTimeRangePreset(nextRange))
                  }}
                />
              </div>
            </div>
            <div className='config-view__external-session-filter-row'>
              <span className='config-view__external-session-filter-label'>
                <span
                  className='config-view__external-session-filter-label-icon material-symbols-rounded'
                  aria-hidden='true'
                >
                  sort
                </span>
                {t('nativeHistoryImport.manager.timeSort')}
              </span>
              <div className='config-view__external-session-filter-options'>
                {timeSortOptions.map(option => (
                  <Button
                    key={option}
                    className={`config-view__external-session-filter-option${timeSort === option ? ' is-active' : ''}`}
                    type='text'
                    size='small'
                    onClick={() => setTimeSort(option)}
                  >
                    <span className='material-symbols-rounded' aria-hidden='true'>
                      {timeSortIcons[option]}
                    </span>
                    <span>
                      {option === 'activity'
                        ? t('nativeHistoryImport.manager.timeSortActivity')
                        : option === 'updatedAt'
                        ? t('nativeHistoryImport.manager.updatedTime')
                        : t('nativeHistoryImport.manager.createdTime')}
                    </span>
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
                {filteredCandidates.map((candidate) => {
                  const isOversized = effectiveSizeLimit != null && candidate.fileSizeBytes > effectiveSizeLimit
                  const sizeLabel = formatBytes(candidate.fileSizeBytes)
                  const sizeTooltip = isOversized
                    ? t('nativeHistoryImport.manager.autoSkippedSizeTooltip', { size: sizeLabel })
                    : undefined
                  return (
                    <FieldRow
                      key={candidate.sourcePath}
                      title={
                        <div className='config-view__external-session-candidate-title'>
                          <span className='config-view__external-session-candidate-title-text'>
                            {candidate.title}
                          </span>
                          <ShortcutTooltip
                            isMac={isMac}
                            title={<span className='config-view__external-session-path-tooltip'>{candidate.cwd}</span>}
                            placement='top'
                            className='config-view__external-session-worktree-tooltip'
                            aria-label={candidate.cwd}
                            tabIndex={0}
                          >
                            <span className='config-view__external-session-worktree-placeholder'>
                              <span className='material-symbols-rounded' aria-hidden='true'>folder_open</span>
                            </span>
                          </ShortcutTooltip>
                        </div>
                      }
                      description={
                        <div className='config-view__external-session-candidate-desc'>
                          <span>{formatTimestamp(candidate.updatedAt)}</span>
                          <span className='config-view__external-session-desc-separator'>·</span>
                          {sizeTooltip == null
                            ? (
                              <span className='config-view__external-session-candidate-size'>
                                {sizeLabel}
                              </span>
                            )
                            : (
                              <ShortcutTooltip
                                isMac={isMac}
                                title={sizeTooltip}
                                placement='top'
                                className='config-view__external-session-size-tooltip'
                              >
                                <span className='config-view__external-session-candidate-size config-view__external-session-candidate-size--warning'>
                                  {sizeLabel}
                                </span>
                              </ShortcutTooltip>
                            )}
                        </div>
                      }
                      icon={nativeHistoryAdapterIcons[adapter]}
                    >
                      <Button
                        className='config-view__external-session-import-button'
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
                      {adapter === 'codex' && (
                        <Button
                          className='config-view__external-session-copy-link-button'
                          size='small'
                          title={t('nativeHistoryImport.manager.copyCodexThreadLink')}
                          aria-label={t('nativeHistoryImport.manager.copyCodexThreadLink')}
                          icon={<span className='material-symbols-rounded'>content_copy</span>}
                          onClick={() => handleCopyCodexThreadLink(candidate.nativeSessionId)}
                        />
                      )}
                    </FieldRow>
                  )
                })}
                {hasMorePreview && (
                  <div className='config-view__external-session-load-more'>
                    <Button
                      type='text'
                      block
                      loading={isLoadingMorePreview}
                      onClick={handleLoadMorePreview}
                    >
                      {t('nativeHistoryImport.manager.loadMore')}
                    </Button>
                  </div>
                )}
              </div>
            )}
        </div>
      </section>
    </div>
  )
}
