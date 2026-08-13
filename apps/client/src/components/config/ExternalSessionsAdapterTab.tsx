/* eslint-disable max-lines -- candidate search, bulk import, and per-row import stay together for this narrow panel. */
import { RouteContainerHeaderActionButton, ShortcutTooltip } from '@oneworks/components/route-layout'
import { App, Button, DatePicker, Empty, InputNumber, Space, Switch, message } from 'antd'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
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
import type { ActionSearchToolbarAction } from '#~/components/action-search-toolbar/ActionSearchToolbar'
import { MobileAwareSelect } from '#~/components/mobile-aware-select/MobileAwareSelect'
import { copyTextWithFeedback } from '#~/utils/copy'

import { FieldRow } from './ConfigFieldRow'
import {
  getAdapterLabelKey,
  nativeHistoryAdapterIcons,
  removeImportedNativeHistoryPreviewCandidates
} from './external-sessions-panel-model'
import type {
  ExternalSessionsProjectOption,
  NativeHistoryImportAdapterSettings,
  NativeHistoryImportSettings
} from './external-sessions-panel-model'

const bytesToMegabytes = (value: number | null | undefined) => value == null ? null : value / 1024 / 1024
const megabytesToBytes = (value: number | null) => value == null ? null : Math.round(value * 1024 * 1024)
const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
const { RangePicker } = DatePicker
type CandidateScopeFilter = NativeHistoryCandidateScope
type ThreadScopeFilter = NativeHistoryThreadScope
type DateRangeValue = [Dayjs | null, Dayjs | null] | null
type TimeRangePreset = 'last-day' | 'last-week' | 'last-30-days' | 'last-90-days'
interface ProjectSelectOption {
  label: ReactNode
  searchText: string
  value: string
}
const ALL_PROJECTS_OPTION_VALUE = '__oneworks_all_projects__'
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

const normalizeProjectPath = (value: string) => {
  const normalized = value.trim().replaceAll('\\', '/').replace(/\/+$/u, '') || '/'
  return /^[a-z]:/iu.test(normalized) ? normalized.toLowerCase() : normalized
}

const getProjectLabelFromPath = (value: string) => {
  const normalized = value.trim().replaceAll('\\', '/').replace(/\/+$/u, '')
  return normalized.split('/').at(-1) || value
}

const matchesProjectPaths = (candidateCwd: string, projectPaths: string[]) => {
  const normalizedCandidateCwd = normalizeProjectPath(candidateCwd)
  return projectPaths.length === 0 || projectPaths.some((projectPath) => {
    const normalizedProjectPath = normalizeProjectPath(projectPath)
    return normalizedCandidateCwd === normalizedProjectPath ||
      normalizedCandidateCwd.startsWith(`${normalizedProjectPath}/`)
  })
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
  initialShowAllTime = false,
  isActive,
  isImporting,
  onAdapterConfigChange,
  onProjectPathsChange,
  onProjectScopeChange,
  onQueryChange,
  onToolbarActionsChange,
  projectScope,
  projectOptions,
  projectPaths,
  query: controlledQuery,
  runImport,
  showSettings = true,
  toolbarPlacement = 'inline'
}: {
  adapter: NativeHistoryAdapter
  config?: NativeHistoryImportSettings
  globalSizeLimit?: number | null
  formatBytes: (value: number) => string
  formatTimestamp: (value: number) => string
  hasCurrentProjectScope: boolean
  initialShowAllTime?: boolean
  isActive: boolean
  isImporting: boolean
  onAdapterConfigChange: (patch: Partial<NativeHistoryImportAdapterSettings>) => void
  onProjectPathsChange: (paths: string[]) => void
  onProjectScopeChange: (scope: NativeHistoryProjectScope) => void
  onQueryChange?: (query: string) => void
  onToolbarActionsChange?: (actions: ActionSearchToolbarAction[]) => void
  projectScope: NativeHistoryProjectScope
  projectOptions?: ExternalSessionsProjectOption[]
  projectPaths: string[]
  query?: string
  runImport: (request: {
    adapters?: NativeHistoryAdapter[]
    projectPaths?: string[]
    projectScope?: NativeHistoryProjectScope
    sourcePaths?: string[]
    threadScope?: NativeHistoryThreadScope
    timeFilter?: NativeHistoryTimeFilter
    timeSort?: NativeHistoryTimeSort
  }) => Promise<NativeHistoryImportResult | undefined>
  showSettings?: boolean
  toolbarPlacement?: 'external' | 'inline'
}) {
  const { modal } = App.useApp()
  const { t } = useTranslation()
  const [uncontrolledQuery, setUncontrolledQuery] = useState('')
  const query = controlledQuery ?? uncontrolledQuery
  const setQuery = onQueryChange ?? setUncontrolledQuery
  const [candidateScopeFilter, setCandidateScopeFilter] = useState<CandidateScopeFilter>('unarchived')
  const [threadScopeFilter, setThreadScopeFilter] = useState<ThreadScopeFilter>('user')
  const [createdAtRange, setCreatedAtRange] = useState<NativeHistoryTimeRange | undefined>()
  const [createdAtPreset, setCreatedAtPreset] = useState<TimeRangePreset | undefined>()
  const [updatedAtRange, setUpdatedAtRange] = useState<NativeHistoryTimeRange | undefined>(
    () => initialShowAllTime ? undefined : createRelativeTimeRange('last-week')
  )
  const [updatedAtPreset, setUpdatedAtPreset] = useState<TimeRangePreset | undefined>(
    initialShowAllTime ? undefined : 'last-week'
  )
  const [timeSort, setTimeSort] = useState<NativeHistoryTimeSort>('activity')
  const [expandedPanel, setExpandedPanel] = useState<'filter' | 'settings' | undefined>()
  const [importingSourcePaths, setImportingSourcePaths] = useState(() => new Set<string>())
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
        projectPaths.join('\n'),
        timeSort,
        previewTimeFilter?.createdAt?.from ?? null,
        previewTimeFilter?.createdAt?.to ?? null,
        previewTimeFilter?.updatedAt?.from ?? null,
        previewTimeFilter?.updatedAt?.to ?? null,
        pageIndex === 0 ? null : previousPage?.nextCursor ?? null
      ]
    },
    async ([, , , , , , , , , , , cursor]) => {
      const result = await previewNativeProjectHistory({
        adapters: [adapter],
        candidateScope: candidateScopeFilter,
        cursor: typeof cursor === 'string' ? cursor : undefined,
        limit: PREVIEW_PAGE_LIMIT,
        projectPaths: projectPaths.length === 0 ? undefined : projectPaths,
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
    const projectsByPath = new Map<string, number>()
    for (const project of pages.flatMap(page => page.projects ?? [])) {
      projectsByPath.set(
        project.path,
        Math.max(project.sessionCount, projectsByPath.get(project.path) ?? 0)
      )
    }
    if (projectsByPath.size === 0) {
      for (const candidate of candidates) {
        projectsByPath.set(candidate.cwd, (projectsByPath.get(candidate.cwd) ?? 0) + 1)
      }
    }
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
      projects: Array.from(projectsByPath, ([path, sessionCount]) => ({ path, sessionCount })),
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
  const mergedProjectOptions = useMemo<ExternalSessionsProjectOption[]>(() => {
    const optionsByPath = new Map<string, ExternalSessionsProjectOption>()
    for (const option of projectOptions ?? []) {
      optionsByPath.set(normalizeProjectPath(option.value), option)
    }
    for (const project of preview?.projects ?? []) {
      const normalizedPath = normalizeProjectPath(project.path)
      if (!optionsByPath.has(normalizedPath)) {
        optionsByPath.set(normalizedPath, {
          description: project.path,
          label: getProjectLabelFromPath(project.path),
          value: project.path
        })
      }
    }
    return Array.from(optionsByPath.values())
  }, [preview?.projects, projectOptions])
  const selectedProjectOptions = mergedProjectOptions
    .filter(option => projectPaths.includes(option.value))
  const projectPathsFilterLabel = projectPaths.length === 0
    ? undefined
    : selectedProjectOptions.length === 1 && projectPaths.length === 1
    ? selectedProjectOptions[0]!.label
    : t('nativeHistoryImport.manager.projectSelectedCount', { count: projectPaths.length })
  const projectSelectSummary = projectPathsFilterLabel ??
    t('nativeHistoryImport.manager.projectScopeAll')
  const projectSelectOptions = useMemo<ProjectSelectOption[]>(() => [
    {
      label: (
        <span className='config-view__external-session-project-option'>
          <span className='material-symbols-rounded' aria-hidden='true'>public</span>
          <span className='config-view__external-session-project-option-label'>
            {t('nativeHistoryImport.manager.projectScopeAll')}
          </span>
        </span>
      ),
      searchText: t('nativeHistoryImport.manager.projectScopeAll').toLowerCase(),
      value: ALL_PROJECTS_OPTION_VALUE
    },
    ...mergedProjectOptions.map(option => ({
      label: (
        <span className='config-view__external-session-project-option'>
          <span className='material-symbols-rounded' aria-hidden='true'>
            {option.isCurrent === true ? 'folder_special' : 'folder_open'}
          </span>
          <span className='config-view__external-session-project-option-label'>
            {option.label}
          </span>
          {option.description != null && option.description.trim() !== '' && (
            <span className='config-view__external-session-project-option-description'>
              {option.description}
            </span>
          )}
          {option.isCurrent === true && (
            <span className='config-view__external-session-project-option-current'>
              {t('nativeHistoryImport.manager.projectScopeCurrent')}
            </span>
          )}
        </span>
      ),
      searchText: [option.label, option.description, option.value].filter(Boolean).join(' ').toLowerCase(),
      value: option.value
    }))
  ], [mergedProjectOptions, t])
  const handleProjectPathsChange = (nextPaths: string[]) => {
    const includesAllProjects = nextPaths.includes(ALL_PROJECTS_OPTION_VALUE)
    if (!includesAllProjects) {
      onProjectPathsChange(nextPaths)
      return
    }
    onProjectPathsChange(
      projectPaths.length === 0
        ? nextPaths.filter(path => path !== ALL_PROJECTS_OPTION_VALUE)
        : []
    )
  }
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
    ...(projectOptions == null
      ? projectScope === 'all-projects' ? [] : [projectScopeLabel]
      : projectPathsFilterLabel == null
      ? []
      : [projectPathsFilterLabel]),
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
      ) && matchesProjectPaths(candidate.cwd, projectPaths)
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
  }, [candidateScopeFilter, preview?.candidates, projectPaths, query, threadScopeFilter])

  const handleImportSourcePaths = useCallback(async (sourcePaths: string[]) => {
    if (sourcePaths.length === 0) {
      return
    }
    setImportingSourcePaths(new Set(sourcePaths))
    try {
      const result = await runImport({
        adapters: [adapter],
        projectPaths: projectPaths.length === 0 ? undefined : projectPaths,
        projectScope,
        sourcePaths,
        threadScope: threadScopeFilter,
        timeFilter: previewTimeFilter,
        timeSort
      })
      if (result != null) {
        const importedSourcePaths = new Set(result.sessions.map(session => session.sourcePath))
        if (importedSourcePaths.size === 0) {
          await refreshPreview()
        } else {
          await refreshPreview(
            pages =>
              removeImportedNativeHistoryPreviewCandidates(
                pages,
                importedSourcePaths
              ),
            { revalidate: false }
          )
          void refreshPreview()
        }
      }
    } finally {
      setImportingSourcePaths(new Set())
    }
  }, [
    adapter,
    previewTimeFilter,
    projectPaths,
    projectScope,
    refreshPreview,
    runImport,
    threadScopeFilter,
    timeSort
  ])

  const confirmImportVisible = useCallback(() => {
    const sourcePaths = filteredCandidates.map(candidate => candidate.sourcePath)
    if (sourcePaths.length === 0) {
      return
    }
    modal.confirm({
      cancelText: t('common.cancel'),
      centered: true,
      content: t('nativeHistoryImport.manager.confirmImportAllDescription'),
      okText: t('nativeHistoryImport.manager.importAll'),
      title: t('nativeHistoryImport.manager.confirmImportAllTitle', {
        count: sourcePaths.length,
        platform: platformLabel
      }),
      onOk: () => handleImportSourcePaths(sourcePaths)
    })
  }, [filteredCandidates, handleImportSourcePaths, modal, platformLabel, t])
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
  const togglePanel = useCallback((panel: 'filter' | 'settings') => {
    setExpandedPanel(current => current === panel ? undefined : panel)
  }, [])
  const toolbarActions = useMemo<ActionSearchToolbarAction[]>(() => [
    {
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
    },
    {
      ariaLabel: t('nativeHistoryImport.manager.importAll'),
      disabled: filteredCandidates.length === 0 || isImporting,
      icon: 'download',
      key: 'import',
      loading: isImporting,
      onClick: confirmImportVisible,
      title: t('nativeHistoryImport.manager.importAll')
    },
    ...(showSettings
      ? [{
        active: expandedPanel === 'settings',
        ariaLabel: t('common.settings'),
        icon: 'settings',
        key: 'adapter-settings',
        onClick: () => togglePanel('settings'),
        pressed: expandedPanel === 'settings',
        title: t('common.settings')
      }]
      : [])
  ], [
    activeFilterLabel,
    expandedPanel,
    filteredCandidates.length,
    confirmImportVisible,
    hasCandidateFilter,
    isImporting,
    showSettings,
    t,
    togglePanel
  ])

  useEffect(() => {
    if (!isActive || toolbarPlacement !== 'external' || onToolbarActionsChange == null) {
      return
    }
    onToolbarActionsChange(toolbarActions)
    return () => onToolbarActionsChange([])
  }, [isActive, onToolbarActionsChange, toolbarActions, toolbarPlacement])
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
      <section className='config-view__external-session-candidates'>
        {toolbarPlacement === 'inline' && (
          <ActionSearchToolbar
            className='config-view__external-session-toolbar'
            query={query}
            placeholder={t('nativeHistoryImport.manager.searchPlaceholder')}
            onQueryChange={setQuery}
            actions={toolbarActions}
          />
        )}

        {showSettings && expandedPanel === 'settings' && (
          <div className='config-view__external-session-panel config-view__external-session-panel--settings'>
            <div className='config-view__external-session-settings-list'>
              <FieldRow
                title={t('nativeHistoryImport.manager.adapterAutoImportTitle', {
                  platform: platformLabel
                })}
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
                    <Button
                      size='small'
                      onClick={() => onAdapterConfigChange({ autoImport: undefined })}
                    >
                      {t('nativeHistoryImport.manager.inheritGlobal')}
                    </Button>
                  )}
                </Space>
              </FieldRow>

              <FieldRow
                title={t('nativeHistoryImport.manager.adapterSizeLimitTitle', {
                  platform: platformLabel
                })}
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
                    value={hasSizeOverride
                      ? bytesToMegabytes(adapterConfig.maxFileSizeBytes)
                      : null}
                    onChange={value =>
                      onAdapterConfigChange({
                        maxFileSizeBytes: megabytesToBytes(value)
                      })}
                  />
                  {hasSizeOverride && (
                    <Button
                      size='small'
                      onClick={() => onAdapterConfigChange({ maxFileSizeBytes: undefined })}
                    >
                      {t('nativeHistoryImport.manager.inheritGlobal')}
                    </Button>
                  )}
                </Space>
              </FieldRow>
            </div>
          </div>
        )}

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
              {projectOptions == null
                ? (
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
                )
                : (
                  <MobileAwareSelect<string[], ProjectSelectOption>
                    allowClear
                    aria-label={t('nativeHistoryImport.manager.projectSelectLabel')}
                    className='config-view__external-session-project-select'
                    maxTagCount={0}
                    maxTagPlaceholder={
                      <span className='config-view__external-session-project-summary'>
                        <span className='material-symbols-rounded' aria-hidden='true'>
                          {projectPaths.length === 0 ? 'public' : 'folder_open'}
                        </span>
                        <span>{projectSelectSummary}</span>
                      </span>
                    }
                    mobileTitle={t('nativeHistoryImport.manager.projectSelectLabel')}
                    mode='multiple'
                    options={projectSelectOptions}
                    placeholder={
                      <span className='config-view__external-session-project-summary'>
                        <span className='material-symbols-rounded' aria-hidden='true'>public</span>
                        <span>{projectSelectSummary}</span>
                      </span>
                    }
                    popupClassName='config-view__external-session-project-select-popup'
                    showSearch={projectSelectOptions.length > 5}
                    value={projectPaths.length === 0
                      ? [ALL_PROJECTS_OPTION_VALUE]
                      : projectPaths}
                    filterOption={(inputValue, option) =>
                      option?.searchText.includes(inputValue.trim().toLowerCase()) === true}
                    onChange={handleProjectPathsChange}
                  />
                )}
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
                    ? t(
                      projectScope === 'all-projects'
                        ? 'nativeHistoryImport.manager.emptyCandidatesAllProjects'
                        : 'nativeHistoryImport.manager.emptyCandidates',
                      { platform: platformLabel }
                    )
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
                      <div className='config-view__external-session-candidate-actions'>
                        <RouteContainerHeaderActionButton
                          isMac={isMac}
                          item={{
                            disabled: candidate.isImported || isImporting,
                            icon: 'download',
                            key: 'import-candidate',
                            label: candidate.isImported
                              ? t('nativeHistoryImport.manager.alreadyImported')
                              : t('nativeHistoryImport.manager.importOne'),
                            loading: importingSourcePaths.has(candidate.sourcePath),
                            onSelect: () => {
                              void handleImportSourcePaths([candidate.sourcePath])
                            }
                          }}
                        />
                        {adapter === 'codex' && (
                          <RouteContainerHeaderActionButton
                            isMac={isMac}
                            item={{
                              icon: 'content_copy',
                              key: 'copy-codex-thread-link',
                              label: t('nativeHistoryImport.manager.copyCodexThreadLink'),
                              onSelect: () => handleCopyCodexThreadLink(candidate.nativeSessionId)
                            }}
                          />
                        )}
                      </div>
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
