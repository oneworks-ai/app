import { Tooltip } from 'antd'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import type { PluginDetailAssetGroup, PluginMarketplaceCatalogPlugin } from '@oneworks/types'

import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import type { PluginRuntimeInstance } from '#~/plugins/plugin-manifest'
import {
  projectPluginPresentationList,
  projectPluginPresentationValue,
  resolveMarketplacePluginDescription,
  resolveMarketplacePluginDisplayName,
  resolveMarketplacePluginSourceDisplay
} from '#~/plugins/plugin-presentation'

import { PluginAssetSection } from './PluginAssetSection'
import { PluginDetailView } from './PluginDetailView'
import { PluginReadmeSection } from './PluginReadmeSection'

const MARKETPLACE_DETAIL_TAB_QUERY_PARAM = 'tab'
const marketplaceDetailTabs = new Set(['readme', 'data-assets'])

const toAssetGroup = (
  values: unknown
): PluginDetailAssetGroup | undefined => {
  const labels = projectPluginPresentationList(values)
  if (labels.length === 0) return undefined
  return {
    kind: 'skills',
    files: labels.map(value => ({
      content: value,
      contentKind: 'text',
      path: value,
      size: new TextEncoder().encode(value).byteLength
    }))
  }
}

export function MarketplacePluginDetailPanel({
  plugin,
  version = plugin.version
}: {
  plugin: PluginMarketplaceCatalogPlugin
  version?: string
}) {
  const { i18n, t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const overviewPlugin = useMemo<PluginRuntimeInstance>(() => ({
    displayName: resolveMarketplacePluginDisplayName(plugin),
    description: resolveMarketplacePluginDescription(plugin),
    name: plugin.name,
    packageId: projectPluginPresentationValue(plugin.marketplaceTitle ?? plugin.marketplace),
    requestId: projectPluginPresentationValue(plugin.sourceType),
    requestedVersion: projectPluginPresentationValue(plugin.marketplaceType),
    rootDir: resolveMarketplacePluginSourceDisplay(plugin),
    scope: `${plugin.marketplace}:${plugin.name}`,
    version
  }), [
    plugin.marketplace,
    plugin.marketplaceTitle,
    plugin.marketplaceType,
    plugin.description,
    plugin.displayName,
    plugin.icon,
    plugin.name,
    plugin.sourceLabel,
    plugin.sourceType,
    version
  ])
  const sourceDisplay = resolveMarketplacePluginSourceDisplay(plugin)
  const descriptionDisplay = resolveMarketplacePluginDescription(plugin)
  const readme = useMemo(() => ({
    content: [
      descriptionDisplay,
      sourceDisplay === '' ? undefined : `\`${sourceDisplay.replace(/`/gu, '\\`')}\``
    ]
      .filter((value): value is string => value != null && value !== '')
      .join('\n\n'),
    path: sourceDisplay || '-'
  }), [descriptionDisplay, sourceDisplay])
  const assetGroups = useMemo(() =>
    [
      {
        group: toAssetGroup(plugin.skills),
        icon: 'psychology',
        key: 'skills',
        title: t('knowledge.tabs.skills')
      },
      {
        group: toAssetGroup(plugin.commands),
        icon: 'terminal',
        key: 'commands',
        title: t('pluginStore.marketplaceDetailCommands')
      },
      {
        group: toAssetGroup(plugin.agents),
        icon: 'groups',
        key: 'agents',
        title: t('pluginStore.marketplaceDetailAgents')
      }
    ].filter(item => item.group != null), [plugin.agents, plugin.commands, plugin.skills, t])
  const requestedTab = searchParams.get(MARKETPLACE_DETAIL_TAB_QUERY_PARAM)
  const activeTabKey = requestedTab != null && marketplaceDetailTabs.has(requestedTab) ? requestedTab : 'readme'
  const handleTabChange = useCallback((key: string) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous)
      if (key === 'readme') next.delete(MARKETPLACE_DETAIL_TAB_QUERY_PARAM)
      else next.set(MARKETPLACE_DETAIL_TAB_QUERY_PARAM, key)
      return next
    }, { replace: true })
  }, [setSearchParams])

  return (
    <PluginDetailView
      activeTabKey={activeTabKey}
      overviewLabels={{
        clientDevEntry: t('pluginDetail.clientDevEntry'),
        clientEntry: t('pluginDetail.clientEntry'),
        disabled: t('pluginStore.disabled'),
        overview: t('pluginDetail.overview'),
        package: t('pluginStore.marketplaceSources'),
        request: t('pluginStore.marketplaceDetailSourceType'),
        requestedVersion: t('pluginStore.marketplaceSourceType'),
        root: t('pluginStore.marketplaceDetailSource'),
        serverEntry: t('pluginDetail.serverEntry'),
        version: t('pluginDetail.version')
      }}
      overviewPlugin={overviewPlugin}
      onTabChange={handleTabChange}
      items={[
        {
          children: (
            <PluginReadmeSection
              emptyText={t('pluginDetail.readmeEmpty')}
              loading={false}
              preferredLanguage={i18n.resolvedLanguage ?? i18n.language}
              pluginScope={overviewPlugin.scope}
              readme={readme.content === '' ? undefined : readme}
              showTitle={false}
              title={t('pluginDetail.readme')}
            />
          ),
          key: 'readme',
          label: (
            <Tooltip title={t('pluginDetail.readme')}>
              <span className='plugin-detail-route__tab-label' aria-label={t('pluginDetail.readme')}>
                <MaterialSymbol name='article' aria-hidden='true' />
                <span>{t('pluginDetail.readme')}</span>
              </span>
            </Tooltip>
          )
        },
        {
          children: assetGroups.length === 0
            ? (
              <PluginAssetSection
                emptyText={t('pluginDetail.assetsEmpty')}
                loading={false}
                title={t('pluginDetail.dataAssets')}
              />
            )
            : (
              <div className='plugin-detail-route__data-assets'>
                {assetGroups.map(item => (
                  <PluginAssetSection
                    key={item.key}
                    emptyText={t('pluginDetail.assetsEmpty')}
                    group={item.group}
                    icon={item.icon}
                    loading={false}
                    showHeading
                    title={item.title}
                  />
                ))}
              </div>
            ),
          key: 'data-assets',
          label: (
            <Tooltip title={t('pluginDetail.dataAssets')}>
              <span className='plugin-detail-route__tab-label' aria-label={t('pluginDetail.dataAssets')}>
                <MaterialSymbol name='database' aria-hidden='true' />
                <span>{t('pluginDetail.dataAssets')}</span>
              </span>
            </Tooltip>
          )
        }
      ]}
    />
  )
}
