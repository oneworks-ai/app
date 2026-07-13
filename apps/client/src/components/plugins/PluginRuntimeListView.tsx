import './PluginRuntimeListView.scss'

import { Empty, Spin, Tabs } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { NativeHostPlugin } from '@oneworks/types'

import { ActionSearchFilterPanel } from '#~/components/action-search-toolbar/ActionSearchFilterPanel'
import { ActionSearchToolbar } from '#~/components/action-search-toolbar/ActionSearchToolbar'
import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import { MarketplaceResults } from '#~/components/marketplace/MarketplaceResults'
import { MobileAwareSelect as Select } from '#~/components/mobile-aware-select/MobileAwareSelect'
import type { PluginRuntimeInstance } from '#~/plugins/plugin-manifest'

import { PluginRuntimeListCard } from './PluginRuntimeListCard'
import type { PluginListKind, PluginListState } from './plugin-runtime-list-items'
import { buildPluginListItems } from './plugin-runtime-list-items'

type PluginListSort = 'default' | 'nameAsc' | 'nameDesc'
type PluginScopeLayer = 'all' | 'global' | 'project'

const PAGE_SIZE = 20

export function PluginRuntimeListView({
  pluginServerBaseUrl,
  nativePlugins,
  nativePluginsLoading,
  plugins,
  onOpenItem
}: {
  pluginServerBaseUrl?: string
  nativePlugins: NativeHostPlugin[]
  nativePluginsLoading: boolean
  plugins: PluginRuntimeInstance[]
  onOpenItem: (item: ReturnType<typeof buildPluginListItems>[number]) => void
}) {
  const { i18n, t } = useTranslation()
  const [scopeLayer, setScopeLayer] = useState<PluginScopeLayer>('all')
  const [query, setQuery] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [kind, setKind] = useState<PluginListKind | 'all'>('all')
  const [adapter, setAdapter] = useState('all')
  const [source, setSource] = useState('all')
  const [state, setState] = useState<PluginListState | 'all'>('all')
  const [sort, setSort] = useState<PluginListSort>('default')
  const [page, setPage] = useState(1)
  const language = i18n.resolvedLanguage ?? i18n.language
  const items = useMemo(() =>
    buildPluginListItems({
      language,
      nativePlugins,
      plugins,
      serverBaseUrl: pluginServerBaseUrl
    }), [language, nativePlugins, pluginServerBaseUrl, plugins])
  const adapters = useMemo(() => [...new Set(items.flatMap(item => item.adapter == null ? [] : [item.adapter]))], [
    items
  ])
  const sources = useMemo(() => [...new Set(items.map(item => item.source))], [items])
  const filteredItems = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const next = items.filter(item => (
      (scopeLayer === 'all' || (scopeLayer === 'project'
        ? item.source === 'project' || item.source === 'localDev'
        : item.source !== 'project' && item.source !== 'localDev')) &&
      (keyword === '' || item.searchText.toLowerCase().includes(keyword)) &&
      (kind === 'all' || item.kind === kind) &&
      (adapter === 'all' || item.adapter === adapter) &&
      (source === 'all' || item.source === source) &&
      (state === 'all' || item.state === state)
    ))
    if (sort === 'nameAsc') return next.sort((left, right) => left.name.localeCompare(right.name))
    if (sort === 'nameDesc') return next.sort((left, right) => right.name.localeCompare(left.name))
    return next
  }, [adapter, items, kind, query, scopeLayer, sort, source, state])
  const maxPage = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE))
  const currentPage = Math.min(page, maxPage)
  const visibleItems = filteredItems.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const hasActiveFilters = kind !== 'all' || adapter !== 'all' || source !== 'all' || state !== 'all' ||
    sort !== 'default'

  useEffect(() => setPage(1), [adapter, kind, query, scopeLayer, sort, source, state])
  useEffect(() => {
    if (page !== currentPage) setPage(currentPage)
  }, [currentPage, page])

  const chevron = <MaterialSymbol name='expand_more' />
  const selectOptions = (values: string[], prefix: string) => [
    { label: t('pluginStore.marketplaceFilterAll'), value: 'all' },
    ...values.map(value => ({ label: t(`${prefix}.${value}`, { defaultValue: value }), value }))
  ]

  return (
    <div className='plugin-runtime-list'>
      <Tabs
        className='plugin-runtime-list__scope-tabs'
        activeKey={scopeLayer}
        items={[
          {
            key: 'all',
            label: <span>
              <MaterialSymbol name='apps' />
              {t('pluginStore.marketplaceFilterAll')}
            </span>
          },
          {
            key: 'global',
            label: <span>
              <MaterialSymbol name='public' />
              {t('pluginStore.sourceGlobal')}
            </span>
          },
          {
            key: 'project',
            label: <span>
              <MaterialSymbol name='folder' />
              {t('pluginStore.sourceProject')}
            </span>
          }
        ]}
        onChange={key => setScopeLayer(key as PluginScopeLayer)}
      />
      <ActionSearchToolbar
        inset={false}
        query={query}
        placeholder={t('pluginStore.listSearchPlaceholder')}
        actions={[{
          active: filtersOpen,
          ariaLabel: t('pluginStore.marketplaceFilter'),
          hasIndicator: hasActiveFilters,
          icon: 'filter_alt',
          key: 'filters',
          onClick: () => setFiltersOpen(value => !value),
          pressed: filtersOpen
        }]}
        onQueryChange={setQuery}
      />
      <ActionSearchFilterPanel open={filtersOpen}>
        <Select
          value={kind}
          suffixIcon={chevron}
          options={selectOptions(['oneworks', 'native'], 'pluginStore.listKinds')}
          onChange={setKind}
        />
        <Select
          value={adapter}
          suffixIcon={chevron}
          options={selectOptions(adapters, 'pluginStore.adapters')}
          onChange={setAdapter}
        />
        <Select
          value={source}
          suffixIcon={chevron}
          options={selectOptions(sources, 'pluginStore.sources')}
          onChange={setSource}
        />
        <Select
          value={state}
          suffixIcon={chevron}
          options={selectOptions(['enabled', 'disabled', 'unknown'], 'pluginStore.states')}
          onChange={setState}
        />
        <Select
          value={sort}
          suffixIcon={chevron}
          options={[
            { label: t('pluginStore.marketplaceSortDefault'), value: 'default' },
            { label: t('pluginStore.marketplaceSortNameAsc'), value: 'nameAsc' },
            { label: t('pluginStore.marketplaceSortNameDesc'), value: 'nameDesc' }
          ]}
          onChange={setSort}
        />
      </ActionSearchFilterPanel>
      {nativePluginsLoading
        ? <div className='plugin-runtime-list__empty'>
          <Spin />
        </div>
        : filteredItems.length === 0
        ? <div className='plugin-runtime-list__empty'>
          <Empty description={t('pluginStore.listEmpty')} />
        </div>
        : (
          <MarketplaceResults
            currentPage={currentPage}
            items={visibleItems}
            pageSize={PAGE_SIZE}
            resetKey={`${scopeLayer}:${query}:${kind}:${adapter}:${source}:${state}:${sort}:${currentPage}`}
            total={filteredItems.length}
            onPageChange={setPage}
            renderItem={item => (
              <PluginRuntimeListCard item={item} onOpen={onOpenItem} />
            )}
          />
        )}
    </div>
  )
}
