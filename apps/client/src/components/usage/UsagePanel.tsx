/* eslint-disable max-lines -- usage visualization keeps its small render helpers beside the shared panel. */
import './UsagePanel.scss'

import { Popover, Spin } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import type { UsageFacetKey, UsageFacetOption, UsageQuery, UsageReport } from '@oneworks/types'

import { getApiErrorMessage, getUsageReport } from '#~/api'
import { USAGE_DIRECT_TRANSPORT_ID } from '#~/api/usage'
import { MobileAwareSelect as Select } from '#~/components/mobile-aware-select/MobileAwareSelect'

export interface UsagePanelProps {
  initialFilters?: Partial<Record<UsageFacetKey, string>>
  lockedFilters?: UsageFacetKey[]
  surface: 'launcher' | 'workspace'
  variant?: 'embedded' | 'page'
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

const getDateKey = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const createUsageRangeStart = (rangeDays: number, now = new Date()) => {
  const first = new Date(now)
  first.setHours(0, 0, 0, 0)
  first.setDate(first.getDate() - (rangeDays - 1))
  return first.getTime()
}

export const createUsageHeatmapDays = (
  report: UsageReport,
  rangeDays: number,
  now = new Date()
) => {
  const values = new Map(report.activity.map(bucket => [bucket.key, bucket]))
  const last = new Date(now)
  last.setHours(0, 0, 0, 0)
  const first = new Date(last)
  first.setDate(last.getDate() - (rangeDays - 1))
  return Array.from({ length: rangeDays }, (_, index) => {
    const date = new Date(first)
    date.setDate(first.getDate() + index)
    const bucket = values.get(getDateKey(date))
    return { date, total: bucket?.total ?? 0 }
  })
}

const getHeatLevel = (total: number, max: number) => {
  if (total <= 0 || max <= 0) return 0
  const ratio = total / max
  if (ratio > 0.72) return 4
  if (ratio > 0.38) return 3
  if (ratio > 0.14) return 2
  return 1
}

const Breakdown = ({
  activeId,
  icon,
  items,
  locale,
  title,
  onSelect
}: {
  activeId?: string
  icon: string
  items: UsageFacetOption[]
  locale: string
  onSelect: (id: string) => void
  title: string
}) => {
  const total = items.reduce((sum, item) => sum + item.total, 0)
  if (items.length === 0) return null
  return (
    <section className='usage-panel__breakdown'>
      <div className='usage-panel__breakdown-heading'>
        <span className='usage-panel__breakdown-icon material-symbols-rounded' aria-hidden='true'>{icon}</span>
        <h3>{title}</h3>
        <span>{items.length}</span>
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
              <span className='usage-panel__breakdown-label'>{item.label}</span>
              {item.resource?.authorityPlugin?.label != null && (
                <span className='usage-panel__breakdown-owner'>{item.resource.authorityPlugin.label}</span>
              )}
            </span>
            <span className='usage-panel__breakdown-numbers'>
              <span className='usage-panel__breakdown-value'>{formatTokens(item.total, locale)}</span>
              <span className='usage-panel__breakdown-share'>
                {total === 0 ? '0%' : `${Math.round(item.total / total * 100)}%`}
              </span>
            </span>
            <span className='usage-panel__breakdown-track' aria-hidden='true'>
              <span style={{ width: `${total === 0 ? 0 : Math.max(4, item.total / total * 100)}%` }} />
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

export function UsagePanel({
  initialFilters = {},
  lockedFilters = [],
  surface,
  variant = 'page'
}: UsagePanelProps) {
  const { i18n, t } = useTranslation()
  const [rangeDays, setRangeDays] = useState(90)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filters, setFilters] = useState<Partial<Record<UsageFacetKey, string>>>(initialFilters)
  const lockedFilterSet = new Set(lockedFilters)
  const rangeStart = useMemo(() => createUsageRangeStart(rangeDays), [rangeDays])
  const lockedQuery = Object.fromEntries(FILTERS.flatMap(filter => {
    const value = filters[filter.key]
    return lockedFilterSet.has(filter.key) && value != null ? [[filter.queryKey, [value]]] : []
  }))
  const overviewQuery: UsageQuery = {
    from: rangeStart,
    scope: surface === 'launcher' ? 'all' : 'workspace',
    ...lockedQuery
  }
  const query: UsageQuery = {
    ...overviewQuery,
    ...Object.fromEntries(FILTERS.flatMap(filter => {
      const value = filters[filter.key]
      return value == null ? [] : [[filter.queryKey, [value]]]
    }))
  }
  const overviewCacheKey = ['usage', surface, JSON.stringify(overviewQuery)]
  const cacheKey = ['usage', surface, JSON.stringify(query)]
  const { data: overviewData } = useSWR(
    overviewCacheKey,
    () => getUsageReport(overviewQuery, { surface }),
    { keepPreviousData: true }
  )
  const { data, error, isLoading } = useSWR(
    cacheKey,
    () => getUsageReport(query, { surface }),
    { keepPreviousData: true }
  )
  const locale = i18n.language
  const heatmap = useMemo(
    () => data == null ? [] : createUsageHeatmapDays(data, rangeDays),
    [data, rangeDays]
  )
  const maxHeat = useMemo(() => Math.max(0, ...heatmap.map(day => day.total)), [heatmap])
  const facetSource = overviewData ?? data
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

  const selectFacet = (key: UsageFacetKey, value?: string) => {
    if (lockedFilterSet.has(key)) return
    setFilters(previous => {
      const next = { ...previous }
      if (value == null || value === '' || value === previous[key]) delete next[key]
      else next[key] = value
      return next
    })
  }
  const clearFilters = () =>
    setFilters(previous => {
      const next: Partial<Record<UsageFacetKey, string>> = {}
      for (const key of lockedFilters) {
        if (previous[key] != null) next[key] = previous[key]
      }
      return next
    })

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

  const cached = data.summary.cacheRead + data.summary.cacheCreation
  const metrics = [
    { key: 'total', label: t('usage.metrics.total'), value: formatTokens(data.summary.total, locale) },
    { key: 'input', label: t('usage.metrics.input'), value: formatTokens(data.summary.input, locale) },
    { key: 'output', label: t('usage.metrics.output'), value: formatTokens(data.summary.output, locale) },
    ...(cached > 0
      ? [{ key: 'cached', label: t('usage.metrics.cached'), value: formatTokens(cached, locale) }]
      : []),
    ...(data.summary.costUsd > 0
      ? [{
        key: 'cost',
        label: t('usage.metrics.cost'),
        value: new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(data.summary.costUsd)
      }]
      : [])
  ]

  return (
    <div className={`usage-panel usage-panel--${surface} usage-panel--${variant}`}>
      <div className='usage-panel__intro'>
        <div>
          <span className='usage-panel__scope'>
            <span className='material-symbols-rounded' aria-hidden='true'>
              {surface === 'launcher' ? 'language' : 'folder'}
            </span>
            {surface === 'launcher' ? t('usage.globalScope') : t('usage.workspaceScope')}
          </span>
          <h2>{t('usage.title')}</h2>
          <p>{surface === 'launcher' ? t('usage.globalDescription') : t('usage.workspaceDescription')}</p>
        </div>
        <div className='usage-panel__controls'>
          {visibleFilters.length > 0 && (
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
          )}
          <Select
            aria-label={t('usage.range.label')}
            className='usage-panel__range'
            popupMatchSelectWidth={false}
            value={rangeDays}
            options={[
              { value: 30, label: t('usage.range.days30') },
              { value: 90, label: t('usage.range.days90') },
              { value: 365, label: t('usage.range.year') }
            ]}
            onChange={setRangeDays}
          />
        </div>
      </div>

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
            <strong>{metric.value}</strong>
            <span>{metric.label}</span>
          </div>
        ))}
      </section>

      <section className='usage-panel__activity'>
        <div className='usage-panel__section-heading'>
          <div>
            <h3>{t('usage.activity.title')}</h3>
            <p>{t('usage.activity.description')}</p>
          </div>
          <div className='usage-panel__activity-meta'>
            <span>{t('usage.observationCount', { count: data.summary.observationCount })}</span>
            <span className='usage-panel__heat-legend' aria-hidden='true'>
              <i className='is-level-0' />
              <i className='is-level-2' />
              <i className='is-level-4' />
            </span>
          </div>
        </div>
        <div className='usage-panel__heatmap' role='img' aria-label={t('usage.activity.label')}>
          {heatmap.map(day => (
            <span
              className={`usage-panel__heatmap-day is-level-${getHeatLevel(day.total, maxHeat)}`}
              key={day.date.toISOString()}
              title={`${day.date.toLocaleDateString(locale)} · ${formatTokens(day.total, locale)}`}
            />
          ))}
        </div>
      </section>

      {data.summary.total === 0
        ? (
          <div className='usage-panel__empty'>
            <span className='material-symbols-rounded' aria-hidden='true'>data_usage</span>
            <strong>{t('usage.empty.title')}</strong>
            <span>{t('usage.empty.description')}</span>
          </div>
        )
        : (
          <div className='usage-panel__breakdowns'>
            {!lockedFilterSet.has('modelService') && (
              <Breakdown
                activeId={filters.modelService}
                icon='dns'
                items={data.facets.modelService}
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
