/* eslint-disable max-lines -- marketplace source form, list, and config writes are one cohesive route panel. */

import './PluginMarketplaceLanding.scss'

import { App, Button, Empty, Form, Input, Modal, Spin, Switch, Tag, Tooltip } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import type {
  ConfigResponse,
  MarketplaceConfig,
  MarketplaceConfigEntry,
  PluginMarketplaceCatalogPlugin,
  PluginMarketplaceCatalogSource,
  PluginMarketplaceConfigSource,
  PluginMarketplaceInstallTarget,
  PluginMarketplaceUninstallIdentity,
  PluginRuntimeInstance
} from '@oneworks/types'

import { getApiErrorMessage, getConfig, updateConfig } from '#~/api.js'
import { ActionSearchToolbar } from '#~/components/action-search-toolbar/ActionSearchToolbar'
import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import { MarketplaceCapabilityTags, MarketplaceCard } from '#~/components/marketplace/MarketplaceCard'
import type { MarketplaceCapabilityGroup } from '#~/components/marketplace/MarketplaceCard'
import { MarketplaceResults } from '#~/components/marketplace/MarketplaceResults'
import { MobileAwareSelect as Select } from '#~/components/mobile-aware-select/MobileAwareSelect'
import {
  listPluginMarketplaceCatalog,
  resolvePluginMarketplaceVersions,
  syncPluginMarketplaceSelection
} from '#~/plugins/marketplace-api'
import {
  applyMarketplaceCacheRefresh,
  captureMarketplaceSelectionSupersession,
  claimMarketplaceConvergenceAuthority,
  claimMarketplaceSourceIntentAuthority,
  resolveMarketplaceServerKey
} from '#~/plugins/marketplace-mutation-authority'
import type {
  MarketplaceConvergenceAuthority,
  MarketplaceSourceIntentAuthority
} from '#~/plugins/marketplace-mutation-authority'
import type { PluginRefreshOptions, PluginRefreshResult } from '#~/plugins/plugin-context'
import {
  projectPluginPresentationList,
  projectPluginPresentationValue,
  resolveMarketplacePluginDescription,
  resolveMarketplacePluginDisplayName,
  resolveMarketplacePluginSourceDisplay,
  sanitizePluginIconRef,
  sanitizePluginPresentationValue
} from '#~/plugins/plugin-presentation'
import { renderIconRef } from '#~/utils/model-provider-icons'

import { isMarketplacePluginInstallable } from './@core/marketplace-plugin-selection'
import type { MarketplacePluginSelectionController } from './@core/marketplace-plugin-selection'
import { serializeMarketplaceSourceMutation } from './@core/marketplace-source-mutation'
import type { PluginMarketplaceUninstallConvergenceTasks } from './@core/plugin-marketplace-uninstall'
import { PluginMarketplaceUninstallStatus } from './PluginMarketplaceUninstallStatus'
import { usePluginMarketplaceUninstall } from './use-plugin-marketplace-uninstall'

export { isMarketplacePluginInstallable, isPluginInstalledForTarget } from './@core/marketplace-plugin-selection'

type MarketplaceConfigSource = PluginMarketplaceConfigSource
type MarketplacePanel = 'config' | 'filter'
type MarketplaceSourceFilter = MarketplaceConfigSource | 'all' | 'builtIn'
type MarketplaceStatusFilter = 'all' | 'disabled' | 'enabled'
type MarketplaceFormat = MarketplaceConfigEntry['type']
type MarketplaceExternalFormat = Exclude<MarketplaceFormat, 'oneworks'>
type MarketplaceFormatFilter = MarketplaceFormat | 'all'
type MarketplaceSortKey = 'default' | 'nameAsc' | 'nameDesc'

interface PluginMarketplaceLandingProps {
  marketplaceSelection: MarketplacePluginSelectionController
  query: string
  runtimeInstances: readonly PluginRuntimeInstance[]
  serverBaseUrl?: string
  onOpenPlugin: (plugin: PluginMarketplaceCatalogPlugin) => void
  onPluginsChanged: (options?: PluginRefreshOptions) => Promise<PluginRefreshResult>
  onQueryChange: (query: string) => void
}

interface MarketplaceSourceItem {
  builtIn?: boolean
  configSource?: MarketplaceConfigSource
  entry: MarketplaceConfigEntry
  key: string
}

interface MarketplaceSourceMutationLifecycle {
  isServerCurrent: () => boolean
  isViewCurrent: () => boolean
}

interface MarketplaceSourceFormValues {
  name?: string
  path?: string
  ref?: string
  types: MarketplaceExternalFormat[]
  url: string
}

const configSourceOrder: MarketplaceConfigSource[] = ['user', 'project', 'global']
const resolveMarketplaceConfigSource = (value: MarketplaceConfigSource | undefined) => (
  configSourceOrder.find(source => source === value) ?? 'user'
)
const sourceFilterOptions: MarketplaceSourceFilter[] = ['all', 'builtIn', ...configSourceOrder]
const statusFilterOptions: MarketplaceStatusFilter[] = ['all', 'enabled', 'disabled']
const defaultMarketplaceFormats: MarketplaceExternalFormat[] = ['claude-code', 'codex']
const ALL_MARKETPLACES = ''
const PLUGIN_PAGE_SIZE = 20
const pluginInstallTargets: PluginMarketplaceInstallTarget[] = ['project', 'global']

const marketplaceFormatPresentation: Record<MarketplaceFormat, { iconId: string; label: string }> = {
  oneworks: { iconId: 'extension', label: 'One Works' },
  'claude-code': { iconId: 'anthropic', label: 'Claude Code' },
  codex: { iconId: 'openai', label: 'Codex' }
}

export function MarketplaceFormatIcon({ type }: { type: MarketplaceFormat }) {
  const presentation = marketplaceFormatPresentation[type] ?? marketplaceFormatPresentation.oneworks
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

const renderMarketplacePluginIcon = (item: PluginMarketplaceCatalogPlugin) => {
  const icon = sanitizePluginIconRef(item.icon)
  return icon == null
    ? <MarketplaceFormatIcon type={item.marketplaceType} />
    : renderIconRef({
      icon,
      imageClassName: 'plugin-marketplace__format-icon-image',
      symbolClassName: 'plugin-marketplace__format-icon-symbol'
    })
}

export const buildMarketplaceCapabilityGroups = (
  item: PluginMarketplaceCatalogPlugin
): MarketplaceCapabilityGroup[] => [
  { icon: 'psychology', key: 'skills', values: projectPluginPresentationList(item.skills) },
  { icon: 'terminal', key: 'commands', values: projectPluginPresentationList(item.commands) },
  { icon: 'groups', key: 'agents', values: projectPluginPresentationList(item.agents) }
]

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

const resolveMarketplaceAdapter = (
  type: MarketplaceConfigEntry['type']
): PluginMarketplaceUninstallIdentity['adapter'] | undefined => (
  type === 'codex' ? 'codex' : type === 'claude-code' ? 'claude' : undefined
)

export const resolveMarketplacePluginInstallIdentity = (
  configRes: ConfigResponse | undefined,
  item: Pick<
    PluginMarketplaceCatalogPlugin,
    | 'builtIn'
    | 'configSource'
    | 'declared'
    | 'enabled'
    | 'installedSources'
    | 'marketplace'
    | 'marketplaceEnabled'
    | 'marketplaceType'
    | 'name'
  >,
  target: PluginMarketplaceInstallTarget,
  runtimeInstances: readonly PluginRuntimeInstance[] = []
) => {
  const hasAuthoritativeCatalogSource = item.configSource === 'project' || (
    item.builtIn === true && item.configSource == null
  )
  if (
    target !== 'project' ||
    item.declared !== true ||
    item.enabled !== true ||
    item.marketplaceEnabled !== true ||
    item.installedSources?.length !== 1 ||
    item.installedSources[0] !== 'project' ||
    !hasAuthoritativeCatalogSource
  ) {
    return undefined
  }
  const entry = getMarketplaces(configRes, 'project')[item.marketplace]
  const declaration = entry?.plugins?.[item.name]
  const adapter = entry == null ? undefined : resolveMarketplaceAdapter(entry.type)
  if (
    entry == null ||
    entry.enabled === false ||
    entry.type !== item.marketplaceType ||
    adapter == null ||
    declaration == null ||
    declaration.enabled === false
  ) {
    return undefined
  }
  const configuredScope = declaration.scope?.trim()
  const matchingRuntimeInstances = configuredScope == null || configuredScope === ''
    ? runtimeInstances.filter(instance => (
      instance.sourceGroup === 'project' &&
      instance.source?.kind === 'marketplace' &&
      instance.source.adapter === adapter &&
      instance.source.marketplace === item.marketplace &&
      instance.source.plugin === item.name
    ))
    : []
  const scope = configuredScope || (
    matchingRuntimeInstances.length === 1
      ? matchingRuntimeInstances[0]?.scope
      : undefined
  )
  if (scope == null || scope === '') return undefined
  return {
    adapter,
    marketplace: item.marketplace,
    plugin: item.name,
    scope
  }
}

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
        sanitizePluginPresentationValue(item.name),
        sanitizePluginPresentationValue(item.category),
        resolveMarketplacePluginDisplayName(item),
        resolveMarketplacePluginDescription(item),
        sanitizePluginPresentationValue(item.version),
        sanitizePluginPresentationValue(item.marketplace),
        sanitizePluginPresentationValue(item.marketplaceTitle),
        resolveMarketplacePluginSourceDisplay(item),
        ...projectPluginPresentationList(item.skills),
        ...projectPluginPresentationList(item.commands),
        ...projectPluginPresentationList(item.agents),
        ...projectPluginPresentationList(item.searchKeywords)
      ].map(value => sanitizePluginPresentationValue(value)).filter(Boolean).join(' ').toLowerCase()
        .includes(normalizedQuery)
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

interface MarketplacePluginTargetActionProps {
  installed: boolean
  item: PluginMarketplaceCatalogPlugin
  onToggle: () => void
  pending: boolean
  refreshAfterRemoval: (authority: MarketplaceConvergenceAuthority) => PluginMarketplaceUninstallConvergenceTasks
  identity?: PluginMarketplaceUninstallIdentity
  serverBaseUrl?: string
  target: PluginMarketplaceInstallTarget
}

const MarketplacePluginTargetAction = ({
  installed,
  identity,
  item,
  onToggle,
  pending,
  refreshAfterRemoval,
  serverBaseUrl,
  target
}: MarketplacePluginTargetActionProps) => {
  const { t } = useTranslation()
  const hasManagedProjectRemoval = installed && target === 'project'
  const uninstall = usePluginMarketplaceUninstall({
    displayName: resolveMarketplacePluginDisplayName(item),
    identity: hasManagedProjectRemoval ? identity : undefined,
    refreshAfterRemoval,
    serverBaseUrl,
    surfaceKey: `marketplace-card:${
      resolveMarketplaceServerKey(serverBaseUrl)
    }:${item.marketplace}:${item.name}:${target}`
  })
  const isManagedProjectRemoval = target === 'project' && (installed || uninstall.pending)
  const title = t(
    isManagedProjectRemoval || installed
      ? 'pluginStore.removeMarketplacePlugin'
      : target === 'global'
      ? 'pluginStore.installMarketplacePluginGlobal'
      : 'pluginStore.installMarketplacePluginProject'
  )

  return (
    <>
      <Tooltip title={title}>
        <Button
          type={isManagedProjectRemoval || installed ? 'default' : 'primary'}
          className='marketplace-card__icon-button'
          aria-label={title}
          disabled={!isMarketplacePluginInstallable(item) || pending || (
            isManagedProjectRemoval && (uninstall.pending || !uninstall.available)
          )}
          loading={isManagedProjectRemoval ? uninstall.pending : pending}
          onClick={(event) => {
            event.stopPropagation()
            if (isManagedProjectRemoval) {
              uninstall.confirm()
            } else {
              onToggle()
            }
          }}
          icon={<MaterialSymbol name={target === 'global' ? 'public' : 'folder'} />}
        />
      </Tooltip>
      <PluginMarketplaceUninstallStatus active={uninstall.indeterminate} />
    </>
  )
}

export function PluginMarketplaceLanding({
  marketplaceSelection,
  onOpenPlugin,
  onPluginsChanged,
  onQueryChange,
  query,
  runtimeInstances,
  serverBaseUrl
}: PluginMarketplaceLandingProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [sourceForm] = Form.useForm<MarketplaceSourceFormValues>()
  const { data: configRes, mutate: mutateConfig } = useSWR<ConfigResponse>(
    ['/api/config', serverBaseUrl ?? 'current'],
    () => getConfig({ serverBaseUrl })
  )
  const { data: catalogRes, isLoading: isCatalogLoading, mutate: mutateCatalog } = useSWR(
    ['/api/plugins/marketplace/catalog', serverBaseUrl ?? 'current'],
    () => listPluginMarketplaceCatalog({ serverBaseUrl })
  )
  const [sourceModalOpen, setSourceModalOpen] = useState(false)
  const [savingSourceKey, setSavingSourceKey] = useState<string>()
  const [expandedPanel, setExpandedPanel] = useState<MarketplacePanel>()
  const [sourceFilter, setSourceFilter] = useState<MarketplaceSourceFilter>('all')
  const [statusFilter, setStatusFilter] = useState<MarketplaceStatusFilter>('all')
  const [marketplaceFilter, setMarketplaceFilter] = useState(ALL_MARKETPLACES)
  const [formatFilter, setFormatFilter] = useState<MarketplaceFormatFilter>('all')
  const [sortKey, setSortKey] = useState<MarketplaceSortKey>('default')
  const [pluginPage, setPluginPage] = useState(1)
  const serverKey = resolveMarketplaceServerKey(serverBaseUrl)
  const sourceServerLifecycleRef = useRef({ key: serverKey, revision: 0 })
  if (sourceServerLifecycleRef.current.key !== serverKey) {
    sourceServerLifecycleRef.current = {
      key: serverKey,
      revision: sourceServerLifecycleRef.current.revision + 1
    }
  }
  const sourceViewRevisionRef = useRef(0)

  const mergedMarketplaces = useMemo(() => getMarketplaces(configRes, 'merged'), [configRes])
  const userPluginConfig = configRes?.sources?.user?.plugins ?? {}
  const userMarketplaces = userPluginConfig.marketplaces ?? {}
  const latestUserPluginConfigRef = useRef(userPluginConfig)
  const latestUserMarketplacesRef = useRef(userMarketplaces)
  const latestMergedMarketplacesRef = useRef(mergedMarketplaces)
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
  const sourcePresentationNames = useMemo(
    () => sourceItems.map(item => projectPluginPresentationValue(item.key)),
    [sourceItems]
  )
  const accessibleSourceNames = useMemo(() => {
    const presentationCounts = new Map<string, number>()
    const presentationOrdinals = new Map<string, number>()
    sourcePresentationNames.forEach((name) => {
      presentationCounts.set(name, (presentationCounts.get(name) ?? 0) + 1)
    })
    return sourcePresentationNames.map((name) => {
      if (presentationCounts.get(name) === 1) return name
      const ordinal = (presentationOrdinals.get(name) ?? 0) + 1
      presentationOrdinals.set(name, ordinal)
      return t('pluginStore.marketplaceSourceDisambiguated', { index: ordinal, source: name })
    })
  }, [sourcePresentationNames, t])
  const marketplaceOptions = useMemo(() => [
    { label: t('pluginStore.marketplaceFilterAll'), value: ALL_MARKETPLACES },
    ...sourceItems.map(item => ({
      label: projectPluginPresentationValue(catalogSourcesByKey.get(item.key)?.title ?? item.key),
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
  useEffect(() => {
    latestUserPluginConfigRef.current = userPluginConfig
    latestUserMarketplacesRef.current = userMarketplaces
    latestMergedMarketplacesRef.current = mergedMarketplaces
  }, [mergedMarketplaces, userMarketplaces, userPluginConfig])
  useEffect(() => {
    setSavingSourceKey(undefined)
    setSourceModalOpen(false)
  }, [serverKey])
  useEffect(() => () => {
    sourceViewRevisionRef.current += 1
  }, [])
  const claimSourceMutationLifecycle = (): MarketplaceSourceMutationLifecycle => {
    const serverRevision = sourceServerLifecycleRef.current.revision
    const viewRevision = sourceViewRevisionRef.current + 1
    sourceViewRevisionRef.current = viewRevision
    return {
      isServerCurrent: () => sourceServerLifecycleRef.current.revision === serverRevision,
      isViewCurrent: () =>
        sourceServerLifecycleRef.current.revision === serverRevision &&
        sourceViewRevisionRef.current === viewRevision
    }
  }
  const runSourceMutation = async (
    sourceKey: string,
    lifecycle: MarketplaceSourceMutationLifecycle,
    mutate: (authority: MarketplaceConvergenceAuthority) => Promise<void>
  ) => {
    if (!lifecycle.isViewCurrent()) return
    setSavingSourceKey(sourceKey)
    const pending = serializeMarketplaceSourceMutation(serverKey, async () => {
      if (!lifecycle.isServerCurrent()) return
      const authority = claimMarketplaceConvergenceAuthority(serverKey, lifecycle.isServerCurrent)
      try {
        await mutate(authority)
      } finally {
        authority.release()
      }
    })
    try {
      await pending
    } finally {
      if (lifecycle.isViewCurrent()) setSavingSourceKey(undefined)
    }
  }
  const refreshAfterUninstall = useCallback((authority: MarketplaceConvergenceAuthority) => ({
    catalog: applyMarketplaceCacheRefresh({
      authority: authority.catalog,
      load: () => listPluginMarketplaceCatalog({ serverBaseUrl }),
      mutate: mutateCatalog
    }),
    config: applyMarketplaceCacheRefresh({
      authority: authority.config,
      load: () => getConfig({ serverBaseUrl }),
      mutate: mutateConfig
    }),
    runtime: onPluginsChanged({ isCurrent: authority.runtime.isCurrent }).then(result => ({
      applied: result.applied && authority.runtime.isCurrent()
    }))
  }), [mutateCatalog, mutateConfig, onPluginsChanged, serverBaseUrl])
  const createSourceConvergenceTasks = (authority: MarketplaceConvergenceAuthority) => [
    applyMarketplaceCacheRefresh({
      authority: authority.config,
      load: () => getConfig({ serverBaseUrl }),
      mutate: mutateConfig
    }),
    applyMarketplaceCacheRefresh({
      authority: authority.catalog,
      load: () => listPluginMarketplaceCatalog({ serverBaseUrl }),
      mutate: mutateCatalog
    }),
    onPluginsChanged({ isCurrent: authority.runtime.isCurrent })
  ]
  const convergeSourceMutation = async (
    authority: MarketplaceConvergenceAuthority,
    committedMarketplaces: string[] = []
  ) => {
    const supersedeCommittedSelections = captureMarketplaceSelectionSupersession(
      serverKey,
      committedMarketplaces.map(marketplace => ({ marketplace }))
    )
    await Promise.all(createSourceConvergenceTasks(authority))
    if (
      committedMarketplaces.length > 0 &&
      authority.config.isCurrent() &&
      authority.catalog.isCurrent() &&
      authority.runtime.isCurrent()
    ) {
      supersedeCommittedSelections()
    }
  }
  const convergeSourceMutationAfterFailure = async (
    authority: MarketplaceConvergenceAuthority,
    lifecycle: MarketplaceSourceMutationLifecycle
  ) => {
    if (!lifecycle.isServerCurrent()) return
    await Promise.allSettled(createSourceConvergenceTasks(authority))
  }
  const writeUserMarketplaces = async (
    nextMarketplaces: MarketplaceConfig,
    authority: MarketplaceConvergenceAuthority
  ) => {
    const currentUserPluginConfig = latestUserPluginConfigRef.current
    await commitMarketplaceConfigUpdate(
      () =>
        updateConfig('user', 'plugins', {
          ...currentUserPluginConfig,
          marketplaces: nextMarketplaces
        }),
      () =>
        applyMarketplaceCacheRefresh({
          authority: authority.config,
          load: () => getConfig({ serverBaseUrl }),
          mutate: mutateConfig
        })
    )
    if (authority.config.isCurrent()) {
      latestUserPluginConfigRef.current = {
        ...currentUserPluginConfig,
        marketplaces: nextMarketplaces
      }
      latestUserMarketplacesRef.current = nextMarketplaces
    }
  }

  const restoreUserMarketplaces = async (
    authority: MarketplaceConvergenceAuthority,
    previousUserPluginConfig: typeof userPluginConfig,
    previousUserMarketplaces: MarketplaceConfig
  ) => {
    await commitMarketplaceConfigUpdate(
      () =>
        updateConfig('user', 'plugins', {
          ...previousUserPluginConfig,
          marketplaces: previousUserMarketplaces
        }),
      () =>
        applyMarketplaceCacheRefresh({
          authority: authority.config,
          load: () => getConfig({ serverBaseUrl }),
          mutate: mutateConfig
        })
    )
    if (authority.config.isCurrent()) {
      latestUserPluginConfigRef.current = previousUserPluginConfig
      latestUserMarketplacesRef.current = previousUserMarketplaces
    }
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
    const lifecycle = claimSourceMutationLifecycle()
    let values: MarketplaceSourceFormValues
    try {
      values = await sourceForm.validateFields()
    } catch {
      return
    }
    if (!lifecycle.isViewCurrent()) return
    const url = values.url.trim()
    const explicitKey = normalizeSourceKey(values.name ?? '')
    const baseKey = explicitKey !== '' ? explicitKey : deriveSourceKeyFromUrl(url)
    await runSourceMutation(baseKey, lifecycle, async (authority) => {
      const sourceIntents: MarketplaceSourceIntentAuthority[] = []
      try {
        const entries = createMarketplaceSourceEntries({
          baseKey,
          formats: values.types,
          occupied: latestMergedMarketplacesRef.current,
          options: {
            source: {
              source: 'git',
              url,
              ...((values.ref?.trim() ?? '') !== '' ? { ref: values.ref?.trim() } : {}),
              ...((values.path?.trim() ?? '') !== '' ? { path: values.path?.trim() } : {})
            }
          }
        })
        sourceIntents.push(
          ...Object.keys(entries).map(marketplace => (
            claimMarketplaceSourceIntentAuthority(serverKey, marketplace)
          ))
        )
        await writeUserMarketplaces({
          ...latestUserMarketplacesRef.current,
          ...entries
        }, authority)
        if (!lifecycle.isServerCurrent()) return
        latestMergedMarketplacesRef.current = {
          ...latestMergedMarketplacesRef.current,
          ...entries
        }
        await convergeSourceMutation(authority, Object.keys(entries))
        if (!lifecycle.isViewCurrent()) return
        void message.success(t('pluginStore.marketplaceSourceSaved'))
        setSourceModalOpen(false)
        sourceForm.resetFields()
      } catch (error) {
        await convergeSourceMutationAfterFailure(authority, lifecycle)
        if (!lifecycle.isViewCurrent()) return
        void message.error(projectPluginPresentationValue(
          getApiErrorMessage(error, t('pluginStore.marketplaceSourceSaveFailed'))
        ))
      } finally {
        sourceIntents.forEach(intent => intent.release())
      }
    })
  }

  const handleToggleSource = async (item: MarketplaceSourceItem, enabled: boolean) => {
    const lifecycle = claimSourceMutationLifecycle()
    const sourceIntent = claimMarketplaceSourceIntentAuthority(serverKey, item.key)
    try {
      await runSourceMutation(item.key, lifecycle, async (authority) => {
        const previousUserPluginConfig = latestUserPluginConfigRef.current
        const previousUserMarketplaces = latestUserMarketplacesRef.current
        try {
          const currentOverride = previousUserMarketplaces[item.key]
          await writeUserMarketplaces({
            ...previousUserMarketplaces,
            [item.key]: createMarketplaceEnabledOverride(item.entry.type, currentOverride, enabled)
          }, authority)
          if (!lifecycle.isServerCurrent()) return
          try {
            await syncSourcePlugins(item, enabled)
          } catch (error) {
            if (!lifecycle.isServerCurrent()) return
            try {
              await restoreUserMarketplaces(authority, previousUserPluginConfig, previousUserMarketplaces)
            } catch {
              // The authoritative refresh below still runs and the original sync error stays visible.
            }
            throw error
          }
          if (!lifecycle.isServerCurrent()) return
          await convergeSourceMutation(authority, [item.key])
          if (!lifecycle.isViewCurrent()) return
          void message.success(
            enabled
              ? t('pluginStore.marketplaceSourceEnabled')
              : t('pluginStore.marketplaceSourceDisabled')
          )
        } catch (error) {
          await convergeSourceMutationAfterFailure(authority, lifecycle)
          if (!lifecycle.isViewCurrent()) return
          void message.error(projectPluginPresentationValue(
            getApiErrorMessage(error, t('pluginStore.marketplaceSourceSaveFailed'))
          ))
        }
      })
    } finally {
      sourceIntent.release()
    }
  }

  const handleRemoveSource = async (item: MarketplaceSourceItem) => {
    const lifecycle = claimSourceMutationLifecycle()
    const sourceIntent = claimMarketplaceSourceIntentAuthority(serverKey, item.key)
    try {
      await runSourceMutation(item.key, lifecycle, async (authority) => {
        const previousUserPluginConfig = latestUserPluginConfigRef.current
        const previousUserMarketplaces = latestUserMarketplacesRef.current
        try {
          const currentOverride = previousUserMarketplaces[item.key]
          await writeUserMarketplaces({
            ...previousUserMarketplaces,
            [item.key]: createMarketplaceEnabledOverride(item.entry.type, currentOverride, false)
          }, authority)
          if (!lifecycle.isServerCurrent()) return
          try {
            await syncSourcePlugins(item, false)
          } catch (error) {
            if (!lifecycle.isServerCurrent()) return
            try {
              await restoreUserMarketplaces(authority, previousUserPluginConfig, previousUserMarketplaces)
              await convergeSourceMutation(authority)
            } catch {
              // The outer compensation keeps the original sync error and retries convergence.
            }
            throw error
          }
          if (!lifecycle.isServerCurrent()) return
          const nextMarketplaces = { ...latestUserMarketplacesRef.current }
          delete nextMarketplaces[item.key]
          await writeUserMarketplaces(nextMarketplaces, authority)
          await convergeSourceMutation(authority, [item.key])
          if (lifecycle.isViewCurrent()) {
            void message.success(t('pluginStore.marketplaceSourceRemoved'))
          }
        } catch (error) {
          if (!lifecycle.isServerCurrent()) return
          try {
            await restoreUserMarketplaces(authority, previousUserPluginConfig, previousUserMarketplaces)
            if (item.entry.enabled !== false) {
              await syncSourcePlugins(item, true)
            }
          } catch {
            // Keep the original error; authoritative convergence still runs below.
          }
          await convergeSourceMutationAfterFailure(authority, lifecycle)
          if (!lifecycle.isViewCurrent()) return
          void message.error(projectPluginPresentationValue(
            getApiErrorMessage(error, t('pluginStore.marketplaceSourceSaveFailed'))
          ))
        }
      })
    } finally {
      sourceIntent.release()
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
              : sourceItems.map((item, index) => {
                const summary = formatSourceSummary(item.entry)
                const catalogSource: PluginMarketplaceCatalogSource | undefined = catalogSourcesByKey.get(item.key)
                const isUserSource = item.configSource === 'user' && item.builtIn !== true
                const sourceName = sourcePresentationNames[index] ?? projectPluginPresentationValue(item.key)
                const accessibleSourceName = accessibleSourceNames[index] ?? sourceName
                const sourceTitle = projectPluginPresentationValue(summary.title)
                const sourceDetail = summary.detail === '' ? '' : projectPluginPresentationValue(summary.detail)
                const sourceError = catalogSource?.error == null
                  ? undefined
                  : projectPluginPresentationValue(catalogSource.error)
                const rawPluginCount = catalogSource?.pluginCount
                const pluginCount = typeof rawPluginCount === 'number' &&
                    Number.isSafeInteger(rawPluginCount) && rawPluginCount >= 0
                  ? rawPluginCount
                  : undefined
                return (
                  <div key={item.key} className='plugin-marketplace__source-item' role='listitem'>
                    <MaterialSymbol className='plugin-marketplace__source-icon' name={summary.icon} />
                    <div className='plugin-marketplace__source-copy'>
                      <div className='plugin-marketplace__source-title-row'>
                        <span className='plugin-marketplace__source-name'>{sourceName}</span>
                        <Tag>
                          {item.builtIn === true
                            ? t('pluginStore.marketplaceSourceBuiltIn')
                            : t(`config.sources.${resolveMarketplaceConfigSource(item.configSource)}`)}
                        </Tag>
                        <MarketplaceFormatIcon type={item.entry.type} />
                        {pluginCount != null && <Tag>{pluginCount}</Tag>}
                      </div>
                      <span className='plugin-marketplace__source-url' title={sourceTitle}>{sourceTitle}</span>
                      {sourceDetail !== '' &&
                        <span className='plugin-marketplace__source-detail'>{sourceDetail}</span>}
                      {sourceError != null &&
                        <span className='plugin-marketplace__source-error'>{sourceError}</span>}
                    </div>
                    <div className='plugin-marketplace__source-actions'>
                      <Switch
                        aria-label={t(
                          item.entry.enabled !== false
                            ? 'pluginStore.disableMarketplaceSourceNamed'
                            : 'pluginStore.enableMarketplaceSourceNamed',
                          { source: accessibleSourceName }
                        )}
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
                            aria-label={t('pluginStore.removeMarketplaceSourceNamed', {
                              source: accessibleSourceName
                            })}
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
                  const displayedVersion = item.version ?? resolvedPluginVersionMap.get(
                    JSON.stringify([item.marketplace, item.name])
                  )
                  const projectState = marketplaceSelection.getState(item, 'project')
                  const globalState = marketplaceSelection.getState(item, 'global')
                  const projectInstalled = projectState.installed
                  const globalInstalled = globalState.installed
                  const sourceKind = item.builtIn === true
                    ? t('pluginStore.marketplaceSourceBuiltIn')
                    : t(`config.sources.${resolveMarketplaceConfigSource(item.configSource)}`)
                  const capabilityGroups = buildMarketplaceCapabilityGroups(item)
                  const capabilityCount = capabilityGroups.reduce((count, group) => count + group.values.length, 0)
                  return (
                    <MarketplaceCard
                      icon={renderMarketplacePluginIcon(item)}
                      onSelect={() => onOpenPlugin(item)}
                      title={resolveMarketplacePluginDisplayName(item)}
                      titleMeta={
                        <>
                          {projectInstalled && <Tag>{t('pluginStore.marketplacePluginInstalledProjectStatus')}</Tag>}
                          {globalInstalled && <Tag>{t('pluginStore.marketplacePluginInstalledGlobalStatus')}</Tag>}
                          {displayedVersion != null && (
                            <Tag>{projectPluginPresentationValue(displayedVersion)}</Tag>
                          )}
                        </>
                      }
                      subtitle={
                        <>
                          <span>{projectPluginPresentationValue(item.marketplaceTitle ?? item.marketplace)}</span>
                          <span aria-hidden='true'>·</span>
                          <span>{sourceKind}</span>
                        </>
                      }
                      description={resolveMarketplacePluginDescription(item)}
                      footer={
                        <>
                          {capabilityCount > 0 && (
                            <MarketplaceCapabilityTags
                              groups={capabilityGroups}
                            />
                          )}
                          <div
                            className='plugin-marketplace__plugin-source'
                            title={resolveMarketplacePluginSourceDisplay(item)}
                          >
                            {resolveMarketplacePluginSourceDisplay(item)}
                          </div>
                        </>
                      }
                      actions={pluginInstallTargets.map((target) => {
                        const selectionState = target === 'global' ? globalState : projectState
                        return (
                          <MarketplacePluginTargetAction
                            installed={selectionState.installed}
                            item={item}
                            key={target}
                            onToggle={() => void marketplaceSelection.toggle(item, target)}
                            pending={selectionState.pending}
                            refreshAfterRemoval={refreshAfterUninstall}
                            identity={resolveMarketplacePluginInstallIdentity(
                              configRes,
                              item,
                              target,
                              runtimeInstances
                            )}
                            serverBaseUrl={serverBaseUrl}
                            target={target}
                          />
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
        onCancel={() => {
          sourceViewRevisionRef.current += 1
          setSourceModalOpen(false)
        }}
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
