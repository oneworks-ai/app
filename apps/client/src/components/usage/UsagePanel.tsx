/* eslint-disable max-lines -- usage visualization keeps its small render helpers beside the shared panel. */
import './UsagePanel.scss'

import { Popover, Spin } from 'antd'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import type { IconRef, UsageFacetKey, UsageFacetOption, UsageQuery, UsageReport } from '@oneworks/types'
import { matchesPinyinSearch, normalizePinyinSearchQuery } from '@oneworks/utils/pinyin-search'

import { getApiErrorMessage, getUsageReport } from '#~/api'
import { USAGE_DIRECT_TRANSPORT_ID } from '#~/api/usage'
import { MobileAwareSelect as Select } from '#~/components/mobile-aware-select/MobileAwareSelect'
import { getAdapterDisplay } from '#~/resources/adapters'
import { renderIconRef } from '#~/utils/model-provider-icons'

import { UsageHeatmap } from './@components/UsageHeatmap'
import { createUsageHeatmapDays, createUsageRangeStart } from './@core/usage-heatmap'
import type { UsageDateRange } from './@core/usage-heatmap'
import { resolveUsageReportContext } from './@core/usage-workspace-scope'
import type { UsagePanelDataScope } from './@core/usage-workspace-scope'

export interface UsagePanelProps {
  dataScope?: UsagePanelDataScope
  initialFilters?: Partial<Record<UsageFacetKey, string>>
  lockedFilters?: UsageFacetKey[]
  onSearchActiveDescendantChange?: (id?: string) => void
  onSearchQueryChange?: (value: string) => void
  searchQuery?: string
  surface: 'launcher' | 'workspace'
  variant?: 'embedded' | 'page'
}

export interface UsagePanelHandle {
  handleSearchKeyDown: (event: KeyboardEvent<HTMLInputElement>) => boolean
}

interface UsageFilterDescriptor {
  key: UsageFacetKey
  queryKey: keyof UsageQuery
}

const FILTERS: UsageFilterDescriptor[] = [
  { key: 'workspace', queryKey: 'workspaces' },
  { key: 'tool', queryKey: 'tools' },
  { key: 'modelService', queryKey: 'modelServices' },
  { key: 'model', queryKey: 'models' },
  { key: 'account', queryKey: 'accounts' },
  { key: 'device', queryKey: 'devices' },
  { key: 'authorityPlugin', queryKey: 'authorityPlugins' },
  { key: 'transportPlugin', queryKey: 'transportPlugins' }
]

const SEARCH_FILTER_KEYS: UsageFacetKey[] = [
  'modelService',
  'tool',
  'account',
  'authorityPlugin'
]
const SEARCH_RESULT_LIMIT = 12
const EMPTY_USAGE_FILTERS: UsageFacetKey[] = []

export interface UsageSearchResult {
  filterKey: UsageFacetKey
  option: UsageFacetOption
}

export const createUsageSearchResults = (
  report: UsageReport | undefined,
  rawQuery: string,
  lockedFilters: UsageFacetKey[] = []
): UsageSearchResult[] => {
  const query = normalizePinyinSearchQuery(rawQuery)
  if (report == null || query === '') return []
  const lockedFilterSet = new Set(lockedFilters)
  return SEARCH_FILTER_KEYS.flatMap((filterKey) => (
    lockedFilterSet.has(filterKey)
      ? []
      : report.facets[filterKey].flatMap(option => (
        matchesPinyinSearch(query, [
            option.id,
            option.label,
            option.resource?.authorityPlugin?.label ?? ''
          ])
          ? [{ filterKey, option }]
          : []
      ))
  ))
    .sort((left, right) => {
      const leftLabel = normalizePinyinSearchQuery(left.option.label)
      const rightLabel = normalizePinyinSearchQuery(right.option.label)
      const leftRank = leftLabel === query ? 0 : leftLabel.startsWith(query) ? 1 : 2
      const rightRank = rightLabel === query ? 0 : rightLabel.startsWith(query) ? 1 : 2
      return leftRank - rightRank ||
        right.option.total - left.option.total ||
        left.option.label.localeCompare(right.option.label)
    })
    .slice(0, SEARCH_RESULT_LIMIT)
}

export const shouldShowUsageFilter = (
  report: UsageReport,
  key: UsageFacetKey,
  active: boolean
) => {
  if (active) return true
  const options = report.facets[key]
  if (options.length > 1) return true
  const attributedObservationCount = options.reduce(
    (total, option) => total + option.observationCount,
    0
  )
  return options.length === 1 &&
    attributedObservationCount < report.summary.observationCount
}

const formatTokens = (value: number, locale: string) => {
  if (value >= 1_000_000_000) {
    return `${
      (value / 1_000_000_000).toLocaleString(locale, {
        maximumFractionDigits: 1
      })
    }B`
  }
  if (value >= 1_000_000) {
    return `${
      (value / 1_000_000).toLocaleString(locale, {
        maximumFractionDigits: 1
      })
    }M`
  }
  if (value >= 1_000) return `${(value / 1_000).toLocaleString(locale, { maximumFractionDigits: 1 })}K`
  return value.toLocaleString(locale)
}

type UsageBreakdownKind = 'account' | 'modelService' | 'tool'

export const resolveUsageBreakdownIcon = (
  kind: UsageBreakdownKind,
  item: UsageFacetOption
): IconRef => {
  if (kind === 'modelService') return { id: item.id, kind: 'builtin' }
  if (
    kind === 'account' &&
    item.resource?.parent?.kind === 'model-service'
  ) {
    return { id: item.resource.parent.id, kind: 'builtin' }
  }
  if (kind === 'account') return { kind: 'material', name: 'account_circle' }
  const display = getAdapterDisplay(item.id)
  return display.icon == null
    ? { kind: 'material', name: 'terminal' }
    : {
      ...(display.darkIcon == null ? {} : { darkUrl: display.darkIcon }),
      kind: 'url',
      url: display.icon
    }
}

const resolveUsageSearchResultIcon = ({
  filterKey,
  option
}: UsageSearchResult): IconRef => {
  if (filterKey === 'modelService') {
    return resolveUsageBreakdownIcon('modelService', option)
  }
  if (filterKey === 'tool') {
    return resolveUsageBreakdownIcon('tool', option)
  }
  if (filterKey === 'account') {
    return resolveUsageBreakdownIcon('account', option)
  }
  return { kind: 'material', name: 'extension' }
}

const getUsageSearchResultId = (index: number) => `usage-search-result-${index}`

const Breakdown = ({
  activeId,
  icon,
  items,
  kind,
  locale,
  title,
  onSelect
}: {
  activeId?: string
  icon: string
  items: UsageFacetOption[]
  kind: UsageBreakdownKind
  locale: string
  onSelect: (id: string) => void
  title: string
}) => {
  if (items.length === 0) return null
  return (
    <section className='usage-panel__breakdown'>
      <div className='usage-panel__breakdown-heading'>
        <span className='usage-panel__breakdown-icon material-symbols-rounded' aria-hidden='true'>{icon}</span>
        <h3>{title}</h3>
        {items.length > 1 && (
          <span className='usage-panel__breakdown-count'>{items.length}</span>
        )}
      </div>
      <div className='usage-panel__breakdown-list'>
        {items.slice(0, 6).map(item => (
          <button
            aria-pressed={activeId === item.id}
            className={`usage-panel__breakdown-row${activeId === item.id ? ' is-active' : ''}`}
            key={item.id}
            type='button'
            onClick={() => onSelect(item.id)}
          >
            <span className='usage-panel__breakdown-copy'>
              <span className='usage-panel__breakdown-item-icon' aria-hidden='true'>
                {renderIconRef({
                  icon: resolveUsageBreakdownIcon(kind, item),
                  imageClassName: 'usage-panel__breakdown-item-icon-image',
                  symbolClassName: 'usage-panel__breakdown-item-icon-symbol'
                })}
              </span>
              <span className='usage-panel__breakdown-text'>
                <span className='usage-panel__breakdown-label'>{item.label}</span>
                {item.resource?.authorityPlugin?.label != null && (
                  <span className='usage-panel__breakdown-owner'>{item.resource.authorityPlugin.label}</span>
                )}
              </span>
            </span>
            <span className='usage-panel__breakdown-value'>{formatTokens(item.total, locale)}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

export const UsagePanel = forwardRef<UsagePanelHandle, UsagePanelProps>(
  ({
    dataScope,
    initialFilters = {},
    lockedFilters = EMPTY_USAGE_FILTERS,
    onSearchActiveDescendantChange,
    onSearchQueryChange,
    searchQuery = '',
    surface,
    variant = 'page'
  }, ref) => {
    const { i18n, t } = useTranslation()
    const [dateRange, setDateRange] = useState<UsageDateRange>()
    const [filtersOpen, setFiltersOpen] = useState(false)
    const [filters, setFilters] = useState<Partial<Record<UsageFacetKey, string>>>(initialFilters)
    const [searchActiveIndex, setSearchActiveIndex] = useState(0)
    const searchResultsRef = useRef<HTMLDivElement>(null)
    const lockedFilterSet = useMemo(() => new Set(lockedFilters), [lockedFilters])
    const rangeStart = useMemo(() => createUsageRangeStart(), [])
    const reportContext = resolveUsageReportContext(surface, dataScope)
    const lockedQuery = Object.fromEntries(FILTERS.flatMap(filter => {
      const value = filters[filter.key]
      return lockedFilterSet.has(filter.key) && value != null ? [[filter.queryKey, [value]]] : []
    }))
    const overviewQuery: UsageQuery = {
      from: rangeStart,
      ...lockedQuery,
      ...reportContext.query
    }
    const activityQuery: UsageQuery = {
      ...overviewQuery,
      ...Object.fromEntries(FILTERS.flatMap(filter => {
        const value = filters[filter.key]
        return value == null ? [] : [[filter.queryKey, [value]]]
      }))
    }
    const query: UsageQuery = {
      ...activityQuery,
      ...(dateRange == null ? {} : dateRange)
    }
    const overviewCacheKey = ['usage', reportContext.surface, JSON.stringify(overviewQuery)]
    const activityCacheKey = ['usage', reportContext.surface, JSON.stringify(activityQuery)]
    const cacheKey = ['usage', reportContext.surface, JSON.stringify(query)]
    const { data: overviewData } = useSWR(
      overviewCacheKey,
      () => getUsageReport(overviewQuery, { surface: reportContext.surface }),
      { keepPreviousData: true }
    )
    const { data: activityData } = useSWR(
      activityCacheKey,
      () => getUsageReport(activityQuery, { surface: reportContext.surface }),
      { keepPreviousData: true }
    )
    const { data, error, isLoading } = useSWR(
      cacheKey,
      () => getUsageReport(query, { surface: reportContext.surface }),
      { keepPreviousData: true }
    )
    const locale = i18n.language
    const heatmap = useMemo(
      () => activityData == null ? [] : createUsageHeatmapDays(activityData),
      [activityData]
    )
    const facetSource = overviewData ?? activityData ?? data
    const normalizedSearchQuery = normalizePinyinSearchQuery(searchQuery)
    const searchResults = useMemo(
      () => createUsageSearchResults(facetSource, searchQuery, lockedFilters),
      [facetSource, lockedFilters, searchQuery]
    )
    const searchResultSignature = searchResults
      .map(result => `${result.filterKey}:${result.option.id}`)
      .join('|')
    const visibleFilters = facetSource == null
      ? []
      : FILTERS.filter(filter => {
        if (lockedFilterSet.has(filter.key)) return false
        if (filter.key === 'workspace' && surface === 'workspace') return false
        return shouldShowUsageFilter(
          facetSource,
          filter.key,
          filters[filter.key] != null
        )
      })
    const activeFilters = FILTERS.flatMap(filter => {
      const value = filters[filter.key]
      if (value == null) return []
      const option = facetSource?.facets[filter.key].find(item => item.id === value)
      const optionLabel = filter.key === 'transportPlugin' && value === USAGE_DIRECT_TRANSPORT_ID
        ? t('usage.filters.direct')
        : option?.label ?? value
      return [{
        key: filter.key,
        label: t(`usage.filters.${filter.key}`),
        value: optionLabel
      }]
    })
    const mutableActiveFilters = activeFilters.filter(filter => !lockedFilterSet.has(filter.key))
    const unavailable = data?.coverage.filter(source => source.status !== 'available') ?? []

    const selectFacet = useCallback((key: UsageFacetKey, value?: string) => {
      if (lockedFilterSet.has(key)) return
      setFilters(previous => {
        const next = { ...previous }
        if (value == null || value === '' || value === previous[key]) delete next[key]
        else next[key] = value
        return next
      })
    }, [lockedFilterSet])
    const clearFilters = () => {
      setDateRange(undefined)
      setFilters(previous => {
        const next: Partial<Record<UsageFacetKey, string>> = {}
        for (const key of lockedFilters) {
          if (previous[key] != null) next[key] = previous[key]
        }
        return next
      })
    }
    const applySearchResult = useCallback((result: UsageSearchResult) => {
      selectFacet(result.filterKey, result.option.id)
      onSearchQueryChange?.('')
    }, [onSearchQueryChange, selectFacet])

    useEffect(() => {
      setSearchActiveIndex(searchResults.length === 0 ? -1 : 0)
    }, [normalizedSearchQuery, searchResultSignature, searchResults.length])

    useEffect(() => {
      const activeId = searchResults[searchActiveIndex] == null
        ? undefined
        : getUsageSearchResultId(searchActiveIndex)
      onSearchActiveDescendantChange?.(activeId)
      return () => {
        onSearchActiveDescendantChange?.(undefined)
      }
    }, [
      onSearchActiveDescendantChange,
      searchActiveIndex,
      searchResultSignature,
      searchResults
    ])

    useEffect(() => {
      const activeElement = searchResultsRef.current?.querySelector(
        '[aria-selected="true"]'
      )
      if (activeElement instanceof HTMLElement) {
        activeElement.scrollIntoView({ block: 'nearest' })
      }
    }, [searchActiveIndex])

    useImperativeHandle(ref, () => ({
      handleSearchKeyDown: (event) => {
        if (normalizedSearchQuery === '') return false
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onSearchQueryChange?.('')
          return true
        }
        if (
          event.key !== 'ArrowDown' &&
          event.key !== 'ArrowUp' &&
          event.key !== 'Enter'
        ) {
          return false
        }

        event.preventDefault()
        event.stopPropagation()
        if (searchResults.length === 0) return true
        if (event.key === 'Enter') {
          const activeResult = searchResults[Math.max(0, searchActiveIndex)]
          if (activeResult != null) applySearchResult(activeResult)
          return true
        }

        const offset = event.key === 'ArrowDown' ? 1 : -1
        setSearchActiveIndex(current => (
          (Math.max(0, current) + offset + searchResults.length) %
          searchResults.length
        ))
        return true
      }
    }), [
      applySearchResult,
      normalizedSearchQuery,
      onSearchQueryChange,
      searchActiveIndex,
      searchResultSignature,
      searchResults
    ])

    if (isLoading && data == null) {
      return <div className='usage-panel usage-panel--state'>
        <Spin />
      </div>
    }
    if (error != null && data == null) {
      return (
        <div className='usage-panel usage-panel--state'>
          <span className='material-symbols-rounded' aria-hidden='true'>error</span>
          <strong>{t('usage.loadFailed')}</strong>
          <span>{getApiErrorMessage(error, t('usage.loadFailedDescription'))}</span>
        </div>
      )
    }
    if (data == null) return null

    if (normalizedSearchQuery !== '') {
      return (
        <div className={`usage-panel usage-panel--${surface} usage-panel--${variant}`}>
          <div
            ref={searchResultsRef}
            aria-label={t('usage.searchResultsLabel')}
            className='usage-panel__search-results'
            role='listbox'
          >
            {searchResults.length === 0
              ? (
                <div className='launcher-command-empty usage-panel__search-empty'>
                  {t('usage.searchNoResults')}
                </div>
              )
              : (
                <div className='launcher-command-section__items'>
                  {searchResults.map((result, index) => (
                    <button
                      aria-selected={index === searchActiveIndex}
                      className={[
                        'launcher-command-item',
                        'usage-panel__search-result',
                        index === searchActiveIndex ? 'is-active' : ''
                      ].filter(Boolean).join(' ')}
                      id={getUsageSearchResultId(index)}
                      key={`${result.filterKey}:${result.option.id}`}
                      role='option'
                      type='button'
                      onClick={() => applySearchResult(result)}
                      onMouseDown={event => {
                        if (event.button === 0) event.preventDefault()
                      }}
                      onMouseEnter={() => setSearchActiveIndex(index)}
                    >
                      <span className='usage-panel__search-result-icon' aria-hidden='true'>
                        {renderIconRef({
                          icon: resolveUsageSearchResultIcon(result),
                          imageClassName: 'usage-panel__search-result-icon-image',
                          symbolClassName: 'usage-panel__search-result-icon-symbol'
                        })}
                      </span>
                      <span className='launcher-command-item__content'>
                        <span className='launcher-command-item__title'>
                          {result.option.label}
                        </span>
                        <span className='launcher-command-item__subtitle'>
                          {t(`usage.filters.${result.filterKey}`)}
                        </span>
                      </span>
                      <span className='usage-panel__search-result-total'>
                        {formatTokens(result.option.total, locale)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
          </div>
        </div>
      )
    }

    const cached = data.summary.cacheRead + data.summary.cacheCreation
    const metrics = [
      {
        icon: 'data_usage',
        key: 'total',
        label: t('usage.metrics.total'),
        value: formatTokens(data.summary.total, locale)
      },
      {
        icon: 'input',
        key: 'input',
        label: t('usage.metrics.input'),
        value: formatTokens(data.summary.input, locale)
      },
      {
        icon: 'output',
        key: 'output',
        label: t('usage.metrics.output'),
        value: formatTokens(data.summary.output, locale)
      },
      ...(cached > 0
        ? [{
          icon: 'cached',
          key: 'cached',
          label: t('usage.metrics.cached'),
          value: formatTokens(cached, locale)
        }]
        : []),
      ...(data.summary.costUsd > 0
        ? [{
          icon: 'payments',
          key: 'cost',
          label: t('usage.metrics.cost'),
          value: new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(data.summary.costUsd)
        }]
        : [])
    ]
    const filterControl = visibleFilters.length > 0
      ? (
        <Popover
          arrow={false}
          content={
            <div className='usage-filter-popover'>
              <div className='usage-filter-popover__heading'>
                <strong>{t('usage.filters.label')}</strong>
                {mutableActiveFilters.length > 0 && (
                  <button type='button' onClick={clearFilters}>{t('usage.filters.reset')}</button>
                )}
              </div>
              <div className='usage-filter-popover__fields'>
                {visibleFilters.map(filter => (
                  <label className='usage-filter-popover__field' key={filter.key}>
                    <span>{t(`usage.filters.${filter.key}`)}</span>
                    <Select
                      allowClear
                      aria-label={t(`usage.filters.${filter.key}`)}
                      placeholder={t('usage.filters.all')}
                      value={filters[filter.key]}
                      options={(facetSource?.facets[filter.key] ?? []).map(option => ({
                        value: option.id,
                        label: filter.key === 'transportPlugin' &&
                            option.id === USAGE_DIRECT_TRANSPORT_ID
                          ? t('usage.filters.direct')
                          : option.label
                      }))}
                      onChange={value => selectFacet(filter.key, value)}
                    />
                  </label>
                ))}
              </div>
            </div>
          }
          open={filtersOpen}
          placement='bottomRight'
          trigger='click'
          onOpenChange={setFiltersOpen}
        >
          <button
            aria-label={t('usage.filters.action')}
            className={`usage-panel__filter-trigger${mutableActiveFilters.length > 0 ? ' is-active' : ''}`}
            type='button'
          >
            <span className='material-symbols-rounded' aria-hidden='true'>tune</span>
            <span>
              {mutableActiveFilters.length > 0
                ? t('usage.filters.activeCount', { count: mutableActiveFilters.length })
                : t('usage.filters.action')}
            </span>
          </button>
        </Popover>
      )
      : null

    return (
      <div className={`usage-panel usage-panel--${surface} usage-panel--${variant}`}>
        {filterControl != null && <div className='usage-panel__toolbar'>{filterControl}</div>}

        {activeFilters.length > 0 && (
          <div className='usage-panel__context' aria-live='polite'>
            <span className='material-symbols-rounded' aria-hidden='true'>filter_alt</span>
            <span>{t('usage.filters.current')}</span>
            <strong>
              {activeFilters.map(filter => `${filter.label} · ${filter.value}`).join(' / ')}
            </strong>
            {mutableActiveFilters.length > 0 && (
              <button aria-label={t('usage.filters.reset')} type='button' onClick={clearFilters}>
                <span className='material-symbols-rounded' aria-hidden='true'>close</span>
              </button>
            )}
          </div>
        )}

        <section className='usage-panel__metrics' aria-label={t('usage.metrics.label')}>
          {metrics.map((metric, index) => (
            <div className={`usage-panel__metric${index === 0 ? ' is-primary' : ''}`} key={metric.key}>
              <div className='usage-panel__metric-value'>
                <span className='usage-panel__metric-icon material-symbols-rounded' aria-hidden='true'>
                  {metric.icon}
                </span>
                <strong>{metric.value}</strong>
              </div>
              <span className='usage-panel__metric-label'>{metric.label}</span>
            </div>
          ))}
        </section>

        <section className='usage-panel__activity'>
          <div className='usage-panel__section-heading'>
            <h3>
              <span className='material-symbols-rounded' aria-hidden='true'>calendar_month</span>
              {t('usage.activity.title')}
            </h3>
            <div className='usage-panel__activity-meta'>
              <span className='material-symbols-rounded' aria-hidden='true'>receipt_long</span>
              <span>{t('usage.observationCount', { count: data.summary.observationCount })}</span>
            </div>
          </div>
          <UsageHeatmap
            days={heatmap}
            formatTotal={total => formatTokens(total, locale)}
            locale={locale}
            selection={dateRange}
            onSelectionChange={setDateRange}
          />
        </section>

        {data.summary.total === 0
          ? (
            <div className='usage-panel__empty'>
              <span className='material-symbols-rounded' aria-hidden='true'>data_usage</span>
              <strong>
                {t(data.coverage.length === 0 ? 'usage.empty.noSourcesTitle' : 'usage.empty.title')}
              </strong>
              <span>
                {t(
                  data.coverage.length === 0
                    ? 'usage.empty.noSourcesDescription'
                    : 'usage.empty.description'
                )}
              </span>
            </div>
          )
          : (
            <div className='usage-panel__breakdowns'>
              {!lockedFilterSet.has('modelService') && (
                <Breakdown
                  activeId={filters.modelService}
                  icon='dns'
                  items={data.facets.modelService}
                  kind='modelService'
                  locale={locale}
                  title={t('usage.breakdowns.modelServices')}
                  onSelect={value => selectFacet('modelService', value)}
                />
              )}
              {!lockedFilterSet.has('account') && (
                <Breakdown
                  activeId={filters.account}
                  icon='account_circle'
                  items={data.facets.account}
                  kind='account'
                  locale={locale}
                  title={t('usage.breakdowns.accounts')}
                  onSelect={value => selectFacet('account', value)}
                />
              )}
              {!lockedFilterSet.has('tool') && (
                <Breakdown
                  activeId={filters.tool}
                  icon='terminal'
                  items={data.facets.tool}
                  kind='tool'
                  locale={locale}
                  title={t('usage.breakdowns.tools')}
                  onSelect={value => selectFacet('tool', value)}
                />
              )}
            </div>
          )}

        {unavailable.length > 0 && (
          <div className='usage-panel__coverage'>
            <span className='material-symbols-rounded' aria-hidden='true'>info</span>
            <span>{t('usage.coveragePartial', { count: unavailable.length })}</span>
          </div>
        )}
      </div>
    )
  }
)
