/* eslint-disable max-lines -- marketplace source form, list, and config writes are one cohesive route panel. */

import './PluginMarketplaceLanding.scss'

import { App, Button, Empty, Input, Switch, Tag, Tooltip } from 'antd'
import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import type {
  ConfigResponse,
  MarketplaceConfig,
  MarketplaceConfigEntry,
  PluginMarketplaceCatalogPlugin,
  PluginMarketplaceCatalogSource,
  PluginMarketplaceConfigSource
} from '@oneworks/types'

import { getApiErrorMessage, getConfig, updateConfig } from '#~/api.js'
import { ActionSearchToolbar } from '#~/components/action-search-toolbar/ActionSearchToolbar'
import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import { listPluginMarketplaceCatalog } from '#~/plugins/api'

type MarketplaceConfigSource = PluginMarketplaceConfigSource
type MarketplacePanel = 'config' | 'filter'
type MarketplaceSourceFilter = MarketplaceConfigSource | 'all'
type MarketplaceStatusFilter = 'all' | 'disabled' | 'enabled'

interface PluginMarketplaceLandingProps {
  query: string
  onQueryChange: (query: string) => void
}

interface MarketplaceSourceItem {
  configSource?: MarketplaceConfigSource
  entry: MarketplaceConfigEntry
  key: string
}

const configSourceOrder: MarketplaceConfigSource[] = ['user', 'project', 'global']
const sourceFilterOptions: MarketplaceSourceFilter[] = ['all', ...configSourceOrder]
const statusFilterOptions: MarketplaceStatusFilter[] = ['all', 'enabled', 'disabled']

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

const formatSourceSummary = (entry: MarketplaceConfigEntry) => {
  const source = entry.options?.source
  if (source == null) {
    return { detail: '', icon: 'storefront', title: '-' }
  }

  switch (source.source) {
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
  onQueryChange,
  query
}: PluginMarketplaceLandingProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { data: configRes, mutate: mutateConfig } = useSWR<ConfigResponse>('/api/config', getConfig)
  const { data: catalogRes, mutate: mutateCatalog } = useSWR(
    '/api/plugins/marketplace/catalog',
    listPluginMarketplaceCatalog
  )
  const [sourceName, setSourceName] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceRef, setSourceRef] = useState('')
  const [sourcePath, setSourcePath] = useState('')
  const [savingSourceKey, setSavingSourceKey] = useState<string>()
  const [savingPluginKey, setSavingPluginKey] = useState<string>()
  const [expandedPanel, setExpandedPanel] = useState<MarketplacePanel>()
  const [sourceFilter, setSourceFilter] = useState<MarketplaceSourceFilter>('all')
  const [statusFilter, setStatusFilter] = useState<MarketplaceStatusFilter>('all')

  const mergedMarketplaces = useMemo(() => getMarketplaces(configRes, 'merged'), [configRes])
  const userPluginConfig = configRes?.sources?.user?.plugins ?? {}
  const userMarketplaces = userPluginConfig.marketplaces ?? {}
  const catalogPlugins = catalogRes?.plugins ?? []
  const catalogSourcesByKey = useMemo(() =>
    new Map(
      (catalogRes?.sources ?? []).map(source => [source.key, source])
    ), [catalogRes?.sources])
  const sourceItems = useMemo<MarketplaceSourceItem[]>(() => (
    Object.entries(mergedMarketplaces)
      .map(([key, entry]) => ({
        configSource: configSourceOrder.find(source => getMarketplaces(configRes, source)[key] != null),
        entry,
        key
      }))
      .sort((left, right) => left.key.localeCompare(right.key))
  ), [configRes, mergedMarketplaces])

  const normalizedQuery = query.trim().toLowerCase()
  const filteredPluginItems = useMemo(() => (
    catalogPlugins.filter((item) => {
      const matchesQuery = normalizedQuery === '' ||
        [
          item.name,
          item.description,
          item.version,
          item.marketplace,
          item.marketplaceTitle,
          item.sourceLabel,
          ...(item.skills ?? []),
          ...(item.commands ?? []),
          ...(item.agents ?? [])
        ].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery)
      const matchesSource = sourceFilter === 'all' || (item.configSource ?? 'user') === sourceFilter
      const isEnabled = item.enabled
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'enabled' ? isEnabled : !isEnabled)
      return matchesQuery && matchesSource && matchesStatus
    })
  ), [catalogPlugins, normalizedQuery, sourceFilter, statusFilter])
  const pendingSourceKey = useMemo(() => {
    const explicitKey = normalizeSourceKey(sourceName)
    const baseKey = explicitKey !== '' ? explicitKey : deriveSourceKeyFromUrl(sourceUrl)
    return getUniqueSourceKey(baseKey, mergedMarketplaces)
  }, [mergedMarketplaces, sourceName, sourceUrl])

  const writeUserMarketplaces = async (nextMarketplaces: MarketplaceConfig, successMessage: string) => {
    await updateConfig('user', 'plugins', {
      ...userPluginConfig,
      marketplaces: nextMarketplaces
    })
    await mutateConfig()
    await mutateCatalog()
    void message.success(successMessage)
  }

  const togglePanel = (panel: MarketplacePanel) => {
    setExpandedPanel(current => current === panel ? undefined : panel)
  }

  const handleAddSource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const url = sourceUrl.trim()
    if (url === '') {
      void message.error(t('pluginStore.marketplaceSourceUrlRequired'))
      return
    }

    const explicitKey = normalizeSourceKey(sourceName)
    const baseKey = explicitKey !== '' ? explicitKey : deriveSourceKeyFromUrl(url)
    const key = getUniqueSourceKey(baseKey, mergedMarketplaces)
    setSavingSourceKey(key)
    try {
      await writeUserMarketplaces({
        ...userMarketplaces,
        [key]: {
          type: 'claude-code',
          enabled: true,
          options: {
            source: {
              source: 'git',
              url,
              ...(sourceRef.trim() !== '' ? { ref: sourceRef.trim() } : {}),
              ...(sourcePath.trim() !== '' ? { path: sourcePath.trim() } : {})
            }
          }
        }
      }, t('pluginStore.marketplaceSourceSaved'))
      setSourceName('')
      setSourceUrl('')
      setSourceRef('')
      setSourcePath('')
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('pluginStore.marketplaceSourceSaveFailed')))
    } finally {
      setSavingSourceKey(undefined)
    }
  }

  const handleToggleSource = async (item: MarketplaceSourceItem, enabled: boolean) => {
    setSavingSourceKey(item.key)
    try {
      await writeUserMarketplaces({
        ...userMarketplaces,
        [item.key]: {
          ...item.entry,
          enabled
        }
      }, enabled ? t('pluginStore.marketplaceSourceEnabled') : t('pluginStore.marketplaceSourceDisabled'))
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('pluginStore.marketplaceSourceSaveFailed')))
    } finally {
      setSavingSourceKey(undefined)
    }
  }

  const handleTogglePlugin = async (item: PluginMarketplaceCatalogPlugin, enabled: boolean) => {
    const pluginKey = `${item.marketplace}:${item.name}`
    setSavingPluginKey(pluginKey)
    try {
      const currentEntry: MarketplaceConfigEntry = userMarketplaces[item.marketplace] ?? { type: 'claude-code' }
      const currentPluginConfig = currentEntry.plugins?.[item.name] ?? {}
      await writeUserMarketplaces({
        ...userMarketplaces,
        [item.marketplace]: {
          ...currentEntry,
          type: 'claude-code',
          plugins: {
            ...currentEntry.plugins,
            [item.name]: {
              ...currentPluginConfig,
              enabled
            }
          }
        }
      }, enabled ? t('pluginStore.marketplacePluginEnabled') : t('pluginStore.marketplacePluginDisabled'))
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('pluginStore.marketplacePluginSaveFailed')))
    } finally {
      setSavingPluginKey(undefined)
    }
  }

  const handleRemoveSource = async (key: string) => {
    setSavingSourceKey(key)
    try {
      const nextMarketplaces = { ...userMarketplaces }
      delete nextMarketplaces[key]
      await writeUserMarketplaces(nextMarketplaces, t('pluginStore.marketplaceSourceRemoved'))
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('pluginStore.marketplaceSourceSaveFailed')))
    } finally {
      setSavingSourceKey(undefined)
    }
  }

  return (
    <div className='plugin-marketplace'>
      <ActionSearchToolbar
        query={query}
        placeholder={t('pluginStore.marketplaceSearchPlaceholder')}
        onQueryChange={onQueryChange}
        actions={[
          {
            active: expandedPanel === 'filter',
            ariaLabel: t('pluginStore.marketplaceFilter'),
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

      {expandedPanel === 'filter' && (
        <div className='plugin-marketplace__panel plugin-marketplace__panel--filter'>
          <div className='plugin-marketplace__filter-row'>
            <span className='plugin-marketplace__filter-label'>{t('pluginStore.marketplaceFilterStatus')}</span>
            <div className='plugin-marketplace__filter-options'>
              {statusFilterOptions.map(option => (
                <Button
                  key={option}
                  className={`plugin-marketplace__filter-option${statusFilter === option ? ' is-active' : ''}`}
                  type='text'
                  size='small'
                  onClick={() => setStatusFilter(option)}
                >
                  {t(`pluginStore.marketplaceFilterStatus_${option}`)}
                </Button>
              ))}
            </div>
          </div>
          <div className='plugin-marketplace__filter-row'>
            <span className='plugin-marketplace__filter-label'>{t('pluginStore.marketplaceFilterSource')}</span>
            <div className='plugin-marketplace__filter-options'>
              {sourceFilterOptions.map(option => (
                <Button
                  key={option}
                  className={`plugin-marketplace__filter-option${sourceFilter === option ? ' is-active' : ''}`}
                  type='text'
                  size='small'
                  onClick={() => setSourceFilter(option)}
                >
                  {option === 'all' ? t('pluginStore.marketplaceFilterAll') : t(`config.sources.${option}`)}
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}

      {expandedPanel === 'config' && (
        <div className='plugin-marketplace__panel plugin-marketplace__panel--config'>
          <form className='plugin-marketplace__source-form' onSubmit={event => void handleAddSource(event)}>
            <Input
              aria-label={t('pluginStore.marketplaceSourceName')}
              placeholder={t('pluginStore.marketplaceSourceName')}
              value={sourceName}
              onChange={event => setSourceName(event.target.value)}
            />
            <Input
              aria-label={t('pluginStore.marketplaceSourceUrl')}
              placeholder={t('pluginStore.marketplaceSourceUrl')}
              value={sourceUrl}
              onChange={event => setSourceUrl(event.target.value)}
            />
            <div className='plugin-marketplace__source-form-row'>
              <Input
                aria-label={t('pluginStore.marketplaceSourceRef')}
                placeholder={t('pluginStore.marketplaceSourceRef')}
                value={sourceRef}
                onChange={event => setSourceRef(event.target.value)}
              />
              <Input
                aria-label={t('pluginStore.marketplaceSourcePath')}
                placeholder={t('pluginStore.marketplaceSourcePath')}
                value={sourcePath}
                onChange={event => setSourcePath(event.target.value)}
              />
              <Tooltip title={t('pluginStore.addMarketplaceSource')}>
                <Button
                  className='plugin-marketplace__icon-button'
                  htmlType='submit'
                  loading={savingSourceKey === pendingSourceKey}
                  aria-label={t('pluginStore.addMarketplaceSource')}
                  icon={<MaterialSymbol name='add' />}
                />
              </Tooltip>
            </div>
          </form>
          <div className='plugin-marketplace__config-source-list' role='list'>
            {sourceItems.length === 0
              ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('pluginStore.marketplaceSourcesEmpty')} />
              : sourceItems.map((item) => {
                const summary = formatSourceSummary(item.entry)
                const catalogSource: PluginMarketplaceCatalogSource | undefined = catalogSourcesByKey.get(item.key)
                const isUserSource = item.configSource === 'user'
                return (
                  <div key={item.key} className='plugin-marketplace__source-item' role='listitem'>
                    <MaterialSymbol className='plugin-marketplace__source-icon' name={summary.icon} />
                    <div className='plugin-marketplace__source-copy'>
                      <div className='plugin-marketplace__source-title-row'>
                        <span className='plugin-marketplace__source-name'>{item.key}</span>
                        <Tag>{t(`config.sources.${item.configSource ?? 'user'}`)}</Tag>
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
                            onClick={() => void handleRemoveSource(item.key)}
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
          <div className='plugin-marketplace__plugin-list' role='list'>
            {filteredPluginItems.length === 0
              ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('pluginStore.marketplacePluginsEmpty')} />
              : filteredPluginItems.map((item) => {
                const pluginKey = `${item.marketplace}:${item.name}`
                return (
                  <div key={pluginKey} className='plugin-marketplace__plugin-item' role='listitem'>
                    <MaterialSymbol className='plugin-marketplace__plugin-icon' name='extension' />
                    <div className='plugin-marketplace__plugin-copy'>
                      <div className='plugin-marketplace__plugin-title-row'>
                        <span className='plugin-marketplace__plugin-name'>{item.name}</span>
                        <Tag>{t(`config.sources.${item.configSource ?? 'user'}`)}</Tag>
                        <Tag>{item.marketplaceTitle ?? item.marketplace}</Tag>
                        {item.version != null && <Tag>{item.version}</Tag>}
                      </div>
                      {item.description != null &&
                        <span className='plugin-marketplace__plugin-description'>{item.description}</span>}
                      <span className='plugin-marketplace__plugin-source' title={item.sourceLabel}>
                        {item.sourceLabel}
                      </span>
                      {(item.skills?.length ?? 0) + (item.commands?.length ?? 0) + (item.agents?.length ?? 0) > 0 && (
                        <div className='plugin-marketplace__plugin-meta'>
                          {item.skills?.map(skill => <Tag key={`skill:${skill}`}>{skill}</Tag>)}
                          {item.commands?.map(command => <Tag key={`command:${command}`}>{command}</Tag>)}
                          {item.agents?.map(agent => <Tag key={`agent:${agent}`}>{agent}</Tag>)}
                        </div>
                      )}
                    </div>
                    <div className='plugin-marketplace__plugin-actions'>
                      <Switch
                        size='small'
                        checked={item.enabled}
                        disabled={!item.marketplaceEnabled}
                        loading={savingPluginKey === pluginKey}
                        onChange={checked => void handleTogglePlugin(item, checked)}
                      />
                    </div>
                  </div>
                )
              })}
          </div>
        </section>
      </div>
    </div>
  )
}
