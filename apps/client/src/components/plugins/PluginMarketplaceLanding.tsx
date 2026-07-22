/* eslint-disable max-lines -- marketplace source form, list, and config writes are one cohesive route panel. */

import './PluginMarketplaceLanding.scss'

import { App, Button, Empty, Form, Input, Modal, Spin, Switch, Tag, Tooltip } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import type {
  ConfigResponse,
  MarketplaceConfig,
  MarketplaceConfigEntry,
  PluginMarketplaceCatalogPlugin,
  PluginMarketplaceCatalogSource,
  PluginMarketplaceConfigSource,
  PluginMarketplaceInstallTarget
} from '@oneworks/types'

import { getApiErrorMessage, getConfig, updateConfig } from '#~/api.js'
import { ActionSearchToolbar } from '#~/components/action-search-toolbar/ActionSearchToolbar'
import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import { MarketplaceCapabilityTags, MarketplaceCard } from '#~/components/marketplace/MarketplaceCard'
import { MarketplaceResults } from '#~/components/marketplace/MarketplaceResults'
import { MobileAwareSelect as Select } from '#~/components/mobile-aware-select/MobileAwareSelect'
import {
  listPluginMarketplaceCatalog,
  resolvePluginMarketplaceVersions,
  syncPluginMarketplaceSelection
} from '#~/plugins/marketplace-api'
import { renderIconRef } from '#~/utils/model-provider-icons'

type MarketplaceConfigSource = PluginMarketplaceConfigSource
type MarketplacePanel = 'config' | 'filter'
type MarketplaceSourceFilter = MarketplaceConfigSource | 'all' | 'builtIn'
type MarketplaceStatusFilter = 'all' | 'disabled' | 'enabled'
type MarketplaceFormat = MarketplaceConfigEntry['type']
type MarketplaceExternalFormat = Exclude<MarketplaceFormat, 'oneworks'>
type MarketplaceFormatFilter = MarketplaceFormat | 'all'
type MarketplaceSortKey = 'default' | 'nameAsc' | 'nameDesc'

interface PluginMarketplaceLandingProps {
  query: string
  serverBaseUrl?: string
  onOpenPlugin: (plugin: PluginMarketplaceCatalogPlugin) => void
  onPluginsChanged: () => Promise<void>
  onQueryChange: (query: string) => void
}

interface MarketplaceSourceItem {
  builtIn?: boolean
  configSource?: MarketplaceConfigSource
  entry: MarketplaceConfigEntry
  key: string
}

interface MarketplaceSourceFormValues {
  name?: string
  path?: string
  ref?: string
  types: MarketplaceExternalFormat[]
  url: string
}

const configSourceOrder: MarketplaceConfigSource[] = ['user', 'project', 'global']
const sourceFilterOptions: MarketplaceSourceFilter[] = ['all', 'builtIn', ...configSourceOrder]
const statusFilterOptions: MarketplaceStatusFilter[] = ['all', 'enabled', 'disabled']
const defaultMarketplaceFormats: MarketplaceExternalFormat[] = ['claude-code', 'codex']
const ALL_MARKETPLACES = ''
const PLUGIN_PAGE_SIZE = 20
const pluginInstallTargets: Array<{ icon: string; target: PluginMarketplaceInstallTarget }> = [
  { icon: 'folder', target: 'project' },
  { icon: 'public', target: 'global' }
]

export const isPluginInstalledForTarget = (
  item: PluginMarketplaceCatalogPlugin,
  target: PluginMarketplaceInstallTarget
) =>
  target === 'global'
    ? item.installedSources?.includes('global') === true
    : item.installedSources?.some(source => source === 'project' || source === 'user') === true

export const isMarketplacePluginInstallable = (item: PluginMarketplaceCatalogPlugin) => (
  item.installable !== false && item.marketplaceEnabled
)

const marketplaceFormatPresentation: Record<MarketplaceFormat, { iconId: string; label: string }> = {
  oneworks: { iconId: 'extension', label: 'One Works' },
  'claude-code': { iconId: 'anthropic', label: 'Claude Code' },
  codex: { iconId: 'openai', label: 'Codex' }
}

export function MarketplaceFormatIcon({ type }: { type: MarketplaceFormat }) {
  const presentation = marketplaceFormatPresentation[type]
  return (
    <Tooltip title={presentation.label}>
      <span className='plugin-marketplace__format-icon' role='img' aria-label={presentation.label}>
        {renderIconRef({
          icon: { kind: 'builtin', id: presentation.iconId },
          imageClassName: 'plugin-marketplace__format-icon-image',
          symbolClassName: 'plugin-marketplace__format-icon-symbol'
        })}
      </span>
    </Tooltip>
  )
}

const renderMarketplacePluginIcon = (item: PluginMarketplaceCatalogPlugin) => (
  item.icon == null
    ? <MarketplaceFormatIcon type={item.marketplaceType} />
    : renderIconRef({
      icon: item.icon,
      imageClassName: 'plugin-marketplace__format-icon-image',
      symbolClassName: 'plugin-marketplace__format-icon-symbol'
    })
)

export const createMarketplaceEnabledOverride = (
  type: MarketplaceConfigEntry['type'],
  current: MarketplaceConfigEntry | undefined,
  enabled: boolean
): MarketplaceConfigEntry =>
  type === 'oneworks'
    ? {
      ...(current?.type === 'oneworks' ? current : {}),
      type: 'oneworks',
      enabled
    }
    : type === 'codex'
    ? {
      ...(current?.type === 'codex' ? current : {}),
      type: 'codex',
      enabled
    }
    : {
      ...(current?.type === 'claude-code' ? current : {}),
      type: 'claude-code',
      enabled
    }

const getMarketplaces = (
  configRes: ConfigResponse | undefined,
  source: MarketplaceConfigSource | 'merged'
): MarketplaceConfig => configRes?.sources?.[source]?.plugins?.marketplaces ?? {}

const normalizeSourceKey = (value: string) => (
  value
    .trim()
    .toLowerCase()
    .replace(/\.git$/u, '')
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
)

const deriveSourceKeyFromUrl = (url: string) => {
  const normalized = url.trim().replace(/\/+$/u, '').replace(/\.git$/u, '')
  const lastSegment = normalized.split(/[/:]/u).filter(Boolean).at(-1)
  return normalizeSourceKey(lastSegment ?? normalized) || 'plugin-source'
}

const getUniqueSourceKey = (baseKey: string, marketplaces: MarketplaceConfig) => {
  if (marketplaces[baseKey] == null) return baseKey
  for (let index = 2; index < 100; index += 1) {
    const nextKey = `${baseKey}-${index}`
    if (marketplaces[nextKey] == null) return nextKey
  }
  return `${baseKey}-${Date.now()}`
}

export const createMarketplaceSourceEntries = (params: {
  baseKey: string
  formats: MarketplaceExternalFormat[]
  occupied: MarketplaceConfig
  options: {
    source: {
      source: 'git'
      url: string
      ref?: string
      path?: string
    }
  }
}): MarketplaceConfig => {
  const entries: MarketplaceConfig = {}
  const occupied = { ...params.occupied }
  for (const format of params.formats) {
    const formatSuffix = format === 'claude-code' ? 'claude' : 'codex'
    const candidate = params.formats.length > 1 ? `${params.baseKey}-${formatSuffix}` : params.baseKey
    const key = getUniqueSourceKey(candidate, occupied)
    const entry: MarketplaceConfigEntry = format === 'codex'
      ? { type: 'codex', enabled: true, options: params.options }
      : { type: 'claude-code', enabled: true, options: params.options }
    entries[key] = entry
    occupied[key] = entry
  }
  return entries
}

export const commitMarketplaceConfigUpdate = async (
  update: () => Promise<unknown>,
  refresh: () => Promise<unknown>
) => {
  await update()
  try {
    await refresh()
  } catch {
    // The authoritative write committed; cache refresh cannot change the operation boundary.
  }
}

export const syncMarketplacePluginsWithCompensation = async (params: {
  enabled: boolean
  marketplace: string
  plugins: string[]
  sync: (marketplace: string, plugin: string, enabled: boolean) => Promise<unknown>
}) => {
  const completed: string[] = []
  try {
    for (const plugin of params.plugins) {
      await params.sync(params.marketplace, plugin, params.enabled)
      completed.push(plugin)
    }
  } catch (error) {
    for (const plugin of completed.reverse()) {
      try {
        await params.sync(params.marketplace, plugin, !params.enabled)
      } catch {
        // Keep the original error; the persisted config remains the source of truth.
      }
    }
    throw error
  }
}

export const interleaveMarketplacePlugins = (plugins: PluginMarketplaceCatalogPlugin[]) => {
  const groups = new Map<string, PluginMarketplaceCatalogPlugin[]>()
  for (const plugin of plugins) {
    const group = groups.get(plugin.marketplace)
    if (group == null) {
      groups.set(plugin.marketplace, [plugin])
    } else {
      group.push(plugin)
    }
  }

  const result: PluginMarketplaceCatalogPlugin[] = []
  const queues = [...groups.values()]
  for (let index = 0; index < plugins.length; index += 1) {
    let appended = false
    for (const queue of queues) {
      const plugin = queue[index]
      if (plugin != null) {
        result.push(plugin)
        appended = true
      }
    }
    if (!appended) break
  }
  return result
}

export const filterAndSortMarketplacePlugins = (
  plugins: PluginMarketplaceCatalogPlugin[],
  filters: {
    format: MarketplaceFormatFilter
    marketplace: string
    query: string
    sort: MarketplaceSortKey
    source: MarketplaceSourceFilter
    status: MarketplaceStatusFilter
  }
) => {
  const normalizedQuery = filters.query.trim().toLowerCase()
  const filtered = plugins.filter((item) => {
    const matchesQuery = normalizedQuery === '' ||
      [
        item.name,
        item.displayName,
        item.description,
        item.version,
        item.marketplace,
        item.marketplaceTitle,
        item.sourceLabel,
        ...(item.skills ?? []),
        ...(item.commands ?? []),
        ...(item.agents ?? []),
        ...(item.searchKeywords ?? [])
      ].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery)
    const itemSource = item.builtIn === true ? 'builtIn' : item.configSource ?? 'user'
    const matchesSource = filters.source === 'all' || itemSource === filters.source
    const matchesMarketplace = filters.marketplace === ALL_MARKETPLACES || item.marketplace === filters.marketplace
    const matchesFormat = filters.format === 'all' || item.marketplaceType === filters.format
    const matchesStatus = filters.status === 'all' ||
      (filters.status === 'enabled' ? item.enabled : !item.enabled)
    return matchesQuery && matchesSource && matchesMarketplace && matchesFormat && matchesStatus
  })
  if (filters.sort === 'nameAsc') return [...filtered].sort((left, right) => left.name.localeCompare(right.name))
  if (filters.sort === 'nameDesc') return [...filtered].sort((left, right) => right.name.localeCompare(left.name))
  return interleaveMarketplacePlugins(filtered)
}

const formatSourceSummary = (entry: MarketplaceConfigEntry) => {
  if (entry.type === 'oneworks') {
    return { detail: entry.options?.version ?? '', icon: 'extension', title: '@oneworks/plugin-*' }
  }
  const source = entry.options?.source
  if (source == null) {
    return { detail: '', icon: 'storefront', title: '-' }
  }

  switch (source.source) {
    case 'app-server':
      return {
        detail: source.includeRemoteCatalog === true ? 'remote' : '',
        icon: 'cloud',
        title: source.marketplace
      }
    case 'git':
      return {
        detail: [source.ref, source.path].filter(Boolean).join(' · '),
        icon: 'account_tree',
        title: source.url
      }
    case 'github':
      return {
        detail: [source.ref, source.path].filter(Boolean).join(' · '),
        icon: 'account_tree',
        title: source.repo
      }
    case 'directory':
      return { detail: '', icon: 'folder', title: source.path }
    case 'url':
      return { detail: '', icon: 'link', title: source.url }
    case 'settings':
      return {
        detail: source.name ?? '',
        icon: 'tune',
        title: source.metadata?.pluginRoot ?? source.name ?? 'settings'
      }
    case 'hostPattern':
      return { detail: '', icon: 'language', title: source.hostPattern }
  }
}

export function PluginMarketplaceLanding({
  onOpenPlugin,
  onPluginsChanged,
  onQueryChange,
  query,
  serverBaseUrl
}: PluginMarketplaceLandingProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [sourceForm] = Form.useForm<MarketplaceSourceFormValues>()
  const { data: configRes, mutate: mutateConfig } = useSWR<ConfigResponse>('/api/config', getConfig)
  const { data: catalogRes, isLoading: isCatalogLoading, mutate: mutateCatalog } = useSWR(
    ['/api/plugins/marketplace/catalog', serverBaseUrl ?? 'current'],
    () => listPluginMarketplaceCatalog({ serverBaseUrl })
  )
  const [sourceModalOpen, setSourceModalOpen] = useState(false)
  const [savingSourceKey, setSavingSourceKey] = useState<string>()
  const [savingPluginKey, setSavingPluginKey] = useState<string>()
  const [expandedPanel, setExpandedPanel] = useState<MarketplacePanel>()
  const [sourceFilter, setSourceFilter] = useState<MarketplaceSourceFilter>('all')
  const [statusFilter, setStatusFilter] = useState<MarketplaceStatusFilter>('all')
  const [marketplaceFilter, setMarketplaceFilter] = useState(ALL_MARKETPLACES)
  const [formatFilter, setFormatFilter] = useState<MarketplaceFormatFilter>('all')
  const [sortKey, setSortKey] = useState<MarketplaceSortKey>('default')
  const [pluginPage, setPluginPage] = useState(1)

  const mergedMarketplaces = useMemo(() => getMarketplaces(configRes, 'merged'), [configRes])
  const userPluginConfig = configRes?.sources?.user?.plugins ?? {}
  const userMarketplaces = userPluginConfig.marketplaces ?? {}
  const catalogPlugins = catalogRes?.plugins ?? []
  const catalogSourcesByKey = useMemo(() =>
    new Map(
      (catalogRes?.sources ?? []).map(source => [source.key, source])
    ), [catalogRes?.sources])
  const sourceItems = useMemo<MarketplaceSourceItem[]>(() => {
    const items = new Map<string, MarketplaceSourceItem>(
      Object.entries(mergedMarketplaces).map(([key, entry]) => [key, {
        configSource: configSourceOrder.find(source => getMarketplaces(configRes, source)[key] != null),
        entry,
        key
      }])
    )
    for (const source of catalogRes?.sources ?? []) {
      if (source.entry == null) continue
      items.set(source.key, {
        builtIn: source.builtIn,
        configSource: source.configSource,
        entry: source.entry,
        key: source.key
      })
    }
    return [...items.values()].sort((left, right) => left.key.localeCompare(right.key))
  }, [catalogRes?.sources, configRes, mergedMarketplaces])
  const marketplaceOptions = useMemo(() => [
    { label: t('pluginStore.marketplaceFilterAll'), value: ALL_MARKETPLACES },
    ...sourceItems.map(item => ({
      label: catalogSourcesByKey.get(item.key)?.title ?? item.key,
      value: item.key
    }))
  ], [catalogSourcesByKey, sourceItems, t])
  const hasActiveFilters = marketplaceFilter !== ALL_MARKETPLACES || formatFilter !== 'all' ||
    sourceFilter !== 'all' || statusFilter !== 'all' || sortKey !== 'default'

  const filteredPluginItems = useMemo(() =>
    filterAndSortMarketplacePlugins(catalogPlugins, {
      format: formatFilter,
      marketplace: marketplaceFilter,
      query,
      sort: sortKey,
      source: sourceFilter,
      status: statusFilter
    }), [catalogPlugins, formatFilter, marketplaceFilter, query, sortKey, sourceFilter, statusFilter])
  const pluginResetKey = [query, marketplaceFilter, formatFilter, sourceFilter, statusFilter, sortKey].join(':')
  const pluginPageCount = Math.max(1, Math.ceil(filteredPluginItems.length / PLUGIN_PAGE_SIZE))
  const effectivePluginPage = Math.min(pluginPage, pluginPageCount)
  const pagedPluginItems = useMemo(() => {
    const start = (effectivePluginPage - 1) * PLUGIN_PAGE_SIZE
    return filteredPluginItems.slice(start, start + PLUGIN_PAGE_SIZE)
  }, [effectivePluginPage, filteredPluginItems])
  const missingVersionItems = useMemo(() =>
    pagedPluginItems
      .filter(item => item.marketplaceType === 'claude-code' && item.version == null)
      .map(item => ({ marketplace: item.marketplace, plugin: item.name })), [pagedPluginItems])
  const missingVersionKey = JSON.stringify(missingVersionItems)
  const versionGeneration = catalogRes?.versionGeneration
  const { data: resolvedPluginVersions } = useSWR(
    missingVersionItems.length === 0 || versionGeneration == null
      ? null
      : ['/api/plugins/marketplace/versions', serverBaseUrl ?? 'current', versionGeneration, missingVersionKey],
    () => resolvePluginMarketplaceVersions(versionGeneration ?? '', missingVersionItems, { serverBaseUrl }),
    {
      errorRetryCount: 2,
      errorRetryInterval: 1_500,
      revalidateOnFocus: false,
      shouldRetryOnError: true
    }
  )
  const resolvedPluginVersionMap = useMemo(() =>
    new Map(
      (resolvedPluginVersions?.versions ?? []).map(item => [
        JSON.stringify([item.marketplace, item.plugin]),
        item.version
      ])
    ), [resolvedPluginVersions?.versions])

  useEffect(() => {
    setPluginPage(1)
  }, [pluginResetKey])

  useEffect(() => {
    setPluginPage(current => Math.min(current, pluginPageCount))
  }, [pluginPageCount])
  const writeUserMarketplaces = async (nextMarketplaces: MarketplaceConfig, successMessage?: string) => {
    await commitMarketplaceConfigUpdate(
      () =>
        updateConfig('user', 'plugins', {
          ...userPluginConfig,
          marketplaces: nextMarketplaces
        }),
      mutateConfig
    )
    if (successMessage != null) void message.success(successMessage)
  }

  const restoreUserMarketplaces = async () => {
    await commitMarketplaceConfigUpdate(
      () =>
        updateConfig('user', 'plugins', {
          ...userPluginConfig,
          marketplaces: userMarketplaces
        }),
      mutateConfig
    )
  }

  const syncSourcePlugins = async (item: MarketplaceSourceItem, sourceEnabled: boolean) => {
    const plugins = Object.entries(item.entry.plugins ?? {})
      .filter(([, plugin]) => !sourceEnabled || plugin.enabled !== false)
    await syncMarketplacePluginsWithCompensation({
      enabled: sourceEnabled,
      marketplace: item.key,
      plugins: plugins.map(([pluginName]) => pluginName),
      sync: (marketplace, plugin, enabled) =>
        syncPluginMarketplaceSelection(marketplace, plugin, enabled, undefined, { serverBaseUrl })
    })
  }

  const togglePanel = (panel: MarketplacePanel) => {
    setExpandedPanel(current => current === panel ? undefined : panel)
  }

  const handleAddSource = async () => {
    let values: MarketplaceSourceFormValues
    try {
      values = await sourceForm.validateFields()
    } catch {
      return
    }
    const url = values.url.trim()
    const explicitKey = normalizeSourceKey(values.name ?? '')
    const baseKey = explicitKey !== '' ? explicitKey : deriveSourceKeyFromUrl(url)
    setSavingSourceKey(baseKey)
    try {
      const entries = createMarketplaceSourceEntries({
        baseKey,
        formats: values.types,
        occupied: mergedMarketplaces,
        options: {
          source: {
            source: 'git',
            url,
            ...((values.ref?.trim() ?? '') !== '' ? { ref: values.ref?.trim() } : {}),
            ...((values.path?.trim() ?? '') !== '' ? { path: values.path?.trim() } : {})
          }
        }
      })
      await writeUserMarketplaces({
        ...userMarketplaces,
        ...entries
      }, t('pluginStore.marketplaceSourceSaved'))
      await mutateCatalog()
      setSourceModalOpen(false)
      sourceForm.resetFields()
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('pluginStore.marketplaceSourceSaveFailed')))
    } finally {
      setSavingSourceKey(undefined)
    }
  }

  const handleToggleSource = async (item: MarketplaceSourceItem, enabled: boolean) => {
    setSavingSourceKey(item.key)
    try {
      const currentOverride = userMarketplaces[item.key]
      await writeUserMarketplaces({
        ...userMarketplaces,
        [item.key]: createMarketplaceEnabledOverride(item.entry.type, currentOverride, enabled)
      })
      try {
        await syncSourcePlugins(item, enabled)
      } catch (error) {
        await restoreUserMarketplaces()
        throw error
      }
      await mutateCatalog()
      void message.success(
        enabled
          ? t('pluginStore.marketplaceSourceEnabled')
          : t('pluginStore.marketplaceSourceDisabled')
      )
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('pluginStore.marketplaceSourceSaveFailed')))
    } finally {
      setSavingSourceKey(undefined)
    }
  }

  const handleTogglePlugin = async (
    item: PluginMarketplaceCatalogPlugin,
    target: PluginMarketplaceInstallTarget
  ) => {
    if (!isMarketplacePluginInstallable(item)) return
    const enabled = !isPluginInstalledForTarget(item, target)
    const savingKey = `${item.marketplace}:${item.name}:${target}`
    setSavingPluginKey(savingKey)
    try {
      await syncPluginMarketplaceSelection(item.marketplace, item.name, enabled, target, { serverBaseUrl })
      await Promise.all([mutateConfig(), mutateCatalog(), onPluginsChanged()])
      void message.success(t(
        enabled
          ? target === 'global'
            ? 'pluginStore.marketplacePluginInstalledGlobal'
            : 'pluginStore.marketplacePluginInstalledProject'
          : 'pluginStore.marketplacePluginRemoved'
      ))
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('pluginStore.marketplacePluginSaveFailed')))
    } finally {
      setSavingPluginKey(undefined)
    }
  }

  const handleRemoveSource = async (item: MarketplaceSourceItem) => {
    setSavingSourceKey(item.key)
    try {
      const currentOverride = userMarketplaces[item.key]
      await writeUserMarketplaces({
        ...userMarketplaces,
        [item.key]: createMarketplaceEnabledOverride(item.entry.type, currentOverride, false)
      })
      try {
        await syncSourcePlugins(item, false)
      } catch (error) {
        await restoreUserMarketplaces()
        throw error
      }
      const nextMarketplaces = { ...userMarketplaces }
      delete nextMarketplaces[item.key]
      await writeUserMarketplaces(nextMarketplaces, t('pluginStore.marketplaceSourceRemoved'))
      await mutateCatalog()
    } catch (error) {
      try {
        await restoreUserMarketplaces()
        if (item.entry.enabled !== false) {
          await syncSourcePlugins(item, true)
        }
      } catch {
        // Keep the original error; the restored config will be reconciled on the next load.
      }
      void message.error(getApiErrorMessage(error, t('pluginStore.marketplaceSourceSaveFailed')))
    } finally {
      setSavingSourceKey(undefined)
    }
  }

  const filterChevron = <MaterialSymbol className='plugin-marketplace__select-chevron' name='expand_more' />

  return (
    <div className='plugin-marketplace'>
      <ActionSearchToolbar
        inset={false}
        query={query}
        placeholder={t('pluginStore.marketplaceSearchPlaceholder')}
        onQueryChange={onQueryChange}
        actions={[
          {
            active: expandedPanel === 'filter',
            ariaLabel: t('pluginStore.marketplaceFilter'),
            hasIndicator: hasActiveFilters,
            icon: 'filter_alt',
            key: 'filter',
            onClick: () => togglePanel('filter'),
            pressed: expandedPanel === 'filter',
            title: t('pluginStore.marketplaceFilter')
          },
          {
            active: expandedPanel === 'config',
            ariaLabel: t('pluginStore.marketplaceConfig'),
            icon: 'tune',
            key: 'config',
            onClick: () => togglePanel('config'),
            pressed: expandedPanel === 'config',
            title: t('pluginStore.marketplaceConfig')
          }
        ]}
      />

      <div className={`plugin-marketplace__market-actions ${expandedPanel === 'filter' ? 'is-open' : ''}`}>
        <div className='plugin-marketplace__market-actions-inner'>
          <div className='plugin-marketplace__filter-field plugin-marketplace__filter-field--wide'>
            <MaterialSymbol className='plugin-marketplace__filter-icon' name='source' />
            <Select
              className='plugin-marketplace__filter-select'
              aria-label={t('pluginStore.marketplaceFilterRegistry')}
              value={marketplaceFilter}
              options={marketplaceOptions}
              suffixIcon={filterChevron}
              onChange={value => setMarketplaceFilter(String(value))}
            />
          </div>
          <div className='plugin-marketplace__filter-field plugin-marketplace__filter-field--wide'>
            <MaterialSymbol className='plugin-marketplace__filter-icon' name='extension' />
            <Select
              className='plugin-marketplace__filter-select'
              aria-label={t('pluginStore.marketplaceFilterFormat')}
              value={formatFilter}
              options={[
                { label: t('pluginStore.marketplaceFilterAll'), value: 'all' },
                { label: 'Claude Code', value: 'claude-code' },
                { label: 'Codex', value: 'codex' },
                { label: 'One Works', value: 'oneworks' }
              ]}
              suffixIcon={filterChevron}
              onChange={value => setFormatFilter(value as MarketplaceFormatFilter)}
            />
          </div>
          <div className='plugin-marketplace__filter-field'>
            <MaterialSymbol className='plugin-marketplace__filter-icon' name='toggle_on' />
            <Select
              className='plugin-marketplace__filter-select'
              aria-label={t('pluginStore.marketplaceFilterStatus')}
              value={statusFilter}
              options={statusFilterOptions.map(option => ({
                label: t(`pluginStore.marketplaceFilterStatus_${option}`),
                value: option
              }))}
              suffixIcon={filterChevron}
              onChange={value => setStatusFilter(value as MarketplaceStatusFilter)}
            />
          </div>
          <div className='plugin-marketplace__filter-field'>
            <MaterialSymbol className='plugin-marketplace__filter-icon' name='folder_open' />
            <Select
              className='plugin-marketplace__filter-select'
              aria-label={t('pluginStore.marketplaceFilterSource')}
              value={sourceFilter}
              options={sourceFilterOptions.map(option => ({
                label: option === 'all'
                  ? t('pluginStore.marketplaceFilterAll')
                  : option === 'builtIn'
                  ? t('pluginStore.marketplaceSourceBuiltIn')
                  : t(`config.sources.${option}`),
                value: option
              }))}
              suffixIcon={filterChevron}
              onChange={value => setSourceFilter(value as MarketplaceSourceFilter)}
            />
          </div>
          <div className='plugin-marketplace__filter-field'>
            <MaterialSymbol className='plugin-marketplace__filter-icon' name='sort' />
            <Select
              className='plugin-marketplace__filter-select'
              aria-label={t('pluginStore.marketplaceFilterSort')}
              value={sortKey}
              options={[
                { label: t('pluginStore.marketplaceSortDefault'), value: 'default' },
                { label: t('pluginStore.marketplaceSortNameAsc'), value: 'nameAsc' },
                { label: t('pluginStore.marketplaceSortNameDesc'), value: 'nameDesc' }
              ]}
              suffixIcon={filterChevron}
              onChange={value => setSortKey(value as MarketplaceSortKey)}
            />
          </div>
        </div>
      </div>

      {expandedPanel === 'config' && (
        <div className='plugin-marketplace__panel plugin-marketplace__panel--config'>
          <div className='plugin-marketplace__source-toolbar'>
            <div className='plugin-marketplace__source-toolbar-title'>
              <MaterialSymbol name='source' />
              <span>{t('pluginStore.marketplaceSources')}</span>
            </div>
            <Tooltip title={t('pluginStore.addMarketplaceSource')}>
              <Button
                className='plugin-marketplace__icon-button'
                type='text'
                aria-label={t('pluginStore.addMarketplaceSource')}
                icon={<MaterialSymbol name='add_link' />}
                onClick={() => setSourceModalOpen(true)}
              />
            </Tooltip>
          </div>
          <div className='plugin-marketplace__config-source-list' role='list'>
            {sourceItems.length === 0
              ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('pluginStore.marketplaceSourcesEmpty')} />
              : sourceItems.map((item) => {
                const summary = formatSourceSummary(item.entry)
                const catalogSource: PluginMarketplaceCatalogSource | undefined = catalogSourcesByKey.get(item.key)
                const isUserSource = item.configSource === 'user' && item.builtIn !== true
                return (
                  <div key={item.key} className='plugin-marketplace__source-item' role='listitem'>
                    <MaterialSymbol className='plugin-marketplace__source-icon' name={summary.icon} />
                    <div className='plugin-marketplace__source-copy'>
                      <div className='plugin-marketplace__source-title-row'>
                        <span className='plugin-marketplace__source-name'>{item.key}</span>
                        <Tag>
                          {item.builtIn === true
                            ? t('pluginStore.marketplaceSourceBuiltIn')
                            : t(`config.sources.${item.configSource ?? 'user'}`)}
                        </Tag>
                        <MarketplaceFormatIcon type={item.entry.type} />
                        {catalogSource != null && <Tag>{catalogSource.pluginCount}</Tag>}
                      </div>
                      <span className='plugin-marketplace__source-url' title={summary.title}>{summary.title}</span>
                      {summary.detail !== '' &&
                        <span className='plugin-marketplace__source-detail'>{summary.detail}</span>}
                      {catalogSource?.error != null &&
                        <span className='plugin-marketplace__source-error'>{catalogSource.error}</span>}
                    </div>
                    <div className='plugin-marketplace__source-actions'>
                      <Switch
                        size='small'
                        checked={item.entry.enabled !== false}
                        loading={savingSourceKey === item.key}
                        onChange={checked => void handleToggleSource(item, checked)}
                      />
                      {isUserSource && (
                        <Tooltip title={t('pluginStore.removeMarketplaceSource')}>
                          <Button
                            className='plugin-marketplace__icon-button'
                            type='text'
                            aria-label={t('pluginStore.removeMarketplaceSource')}
                            icon={<MaterialSymbol name='delete' />}
                            onClick={() => void handleRemoveSource(item)}
                          />
                        </Tooltip>
                      )}
                    </div>
                  </div>
                )
              })}
          </div>
        </div>
      )}

      <div className='plugin-marketplace__content'>
        <section className='plugin-marketplace__section plugin-marketplace__section--plugins'>
          {isCatalogLoading
            ? (
              <div className='plugin-marketplace__empty'>
                <Spin />
              </div>
            )
            : filteredPluginItems.length === 0
            ? (
              <div className='plugin-marketplace__empty'>
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('pluginStore.marketplacePluginsEmpty')} />
              </div>
            )
            : (
              <MarketplaceResults
                currentPage={effectivePluginPage}
                items={pagedPluginItems}
                pageSize={PLUGIN_PAGE_SIZE}
                resetKey={`${pluginResetKey}:${effectivePluginPage}`}
                total={filteredPluginItems.length}
                onPageChange={setPluginPage}
                renderItem={(item) => {
                  const pluginKey = `${item.marketplace}:${item.name}`
                  const displayedVersion = item.version ?? resolvedPluginVersionMap.get(
                    JSON.stringify([item.marketplace, item.name])
                  )
                  const projectInstalled = isPluginInstalledForTarget(item, 'project')
                  const globalInstalled = isPluginInstalledForTarget(item, 'global')
                  const isSavingPlugin = savingPluginKey?.startsWith(`${pluginKey}:`) === true
                  const sourceKind = item.builtIn === true
                    ? t('pluginStore.marketplaceSourceBuiltIn')
                    : t(`config.sources.${item.configSource ?? 'user'}`)
                  const capabilityCount = (item.skills?.length ?? 0) + (item.commands?.length ?? 0) +
                    (item.agents?.length ?? 0)
                  return (
                    <MarketplaceCard
                      icon={renderMarketplacePluginIcon(item)}
                      onSelect={() => onOpenPlugin(item)}
                      title={item.displayName ?? item.name}
                      titleMeta={
                        <>
                          {projectInstalled && <Tag>{t('pluginStore.marketplacePluginInstalledProjectStatus')}</Tag>}
                          {globalInstalled && <Tag>{t('pluginStore.marketplacePluginInstalledGlobalStatus')}</Tag>}
                          {displayedVersion != null && <Tag>{displayedVersion}</Tag>}
                        </>
                      }
                      subtitle={
                        <>
                          <span>{item.marketplaceTitle ?? item.marketplace}</span>
                          <span aria-hidden='true'>·</span>
                          <span>{sourceKind}</span>
                        </>
                      }
                      description={item.description}
                      footer={
                        <>
                          {capabilityCount > 0 && (
                            <MarketplaceCapabilityTags
                              groups={[
                                { key: 'skills', icon: 'psychology', values: item.skills ?? [] },
                                { key: 'commands', icon: 'terminal', values: item.commands ?? [] },
                                { key: 'agents', icon: 'groups', values: item.agents ?? [] }
                              ]}
                            />
                          )}
                          <div className='plugin-marketplace__plugin-source' title={item.sourceLabel}>
                            {item.sourceLabel}
                          </div>
                        </>
                      }
                      actions={pluginInstallTargets.map(({ icon, target }) => {
                        const installed = target === 'global' ? globalInstalled : projectInstalled
                        const title = t(
                          installed
                            ? 'pluginStore.removeMarketplacePlugin'
                            : target === 'global'
                            ? 'pluginStore.installMarketplacePluginGlobal'
                            : 'pluginStore.installMarketplacePluginProject'
                        )
                        return (
                          <Tooltip key={target} title={title}>
                            <Button
                              type={installed ? 'default' : 'primary'}
                              className='marketplace-card__icon-button'
                              aria-label={title}
                              disabled={!isMarketplacePluginInstallable(item) || (
                                isSavingPlugin && savingPluginKey !== `${pluginKey}:${target}`
                              )}
                              loading={savingPluginKey === `${pluginKey}:${target}`}
                              onClick={(event) => {
                                event.stopPropagation()
                                void handleTogglePlugin(item, target)
                              }}
                              icon={<MaterialSymbol name={icon} />}
                            />
                          </Tooltip>
                        )
                      })}
                    />
                  )
                }}
              />
            )}
        </section>
      </div>

      <Modal
        title={t('pluginStore.addMarketplaceSource')}
        open={sourceModalOpen}
        confirmLoading={savingSourceKey != null}
        okText={t('config.actions.save')}
        cancelText={t('config.actions.cancel')}
        destroyOnHidden
        onOk={() => void handleAddSource()}
        onCancel={() => setSourceModalOpen(false)}
        afterClose={() => sourceForm.resetFields()}
      >
        <Form
          className='plugin-marketplace__source-modal-form'
          form={sourceForm}
          layout='vertical'
          initialValues={{ types: defaultMarketplaceFormats }}
        >
          <Form.Item
            name='types'
            label={t('pluginStore.marketplaceSourceType')}
            rules={[{ required: true, message: t('pluginStore.marketplaceSourceTypeRequired') }]}
          >
            <Select
              className='plugin-marketplace__source-type-select'
              mode='multiple'
              allowClear={false}
              options={[
                { label: 'Claude Code', value: 'claude-code' },
                { label: 'Codex', value: 'codex' }
              ]}
            />
          </Form.Item>
          <Form.Item name='name' label={t('pluginStore.marketplaceSourceName')}>
            <Input placeholder={t('pluginStore.marketplaceSourceName')} />
          </Form.Item>
          <Form.Item
            name='url'
            label={t('pluginStore.marketplaceSourceUrl')}
            rules={[{
              required: true,
              whitespace: true,
              message: t('pluginStore.marketplaceSourceUrlRequired')
            }]}
          >
            <Input placeholder={t('pluginStore.marketplaceSourceUrl')} />
          </Form.Item>
          <Form.Item name='ref' label={t('pluginStore.marketplaceSourceRef')}>
            <Input placeholder={t('pluginStore.marketplaceSourceRef')} />
          </Form.Item>
          <Form.Item name='path' label={t('pluginStore.marketplaceSourcePath')}>
            <Input placeholder={t('pluginStore.marketplaceSourcePath')} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
