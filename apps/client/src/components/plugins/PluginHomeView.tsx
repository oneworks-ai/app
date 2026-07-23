import './PluginHomeView.scss'

import { RouteContainerHeaderActionButton } from '@oneworks/components/route-layout'
import { Spin, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'

import type { PluginMarketplaceCatalogPlugin } from '@oneworks/types'

import { renderIconAsset } from '#~/components/icons/IconAsset'
import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import { MarketplaceCard } from '#~/components/marketplace/MarketplaceCard'
import { renderIconRef } from '#~/utils/model-provider-icons'

import { MarketplaceFormatIcon, interleaveMarketplacePlugins } from './PluginMarketplaceLanding'
import type { PluginListItem } from './plugin-runtime-list-items'

const RECOMMENDATION_LIMIT = 10

export const selectRecommendedMarketplacePlugins = (
  plugins: PluginMarketplaceCatalogPlugin[],
  limit = RECOMMENDATION_LIMIT
) => {
  const availablePlugins = plugins.filter(plugin => (
    plugin.builtIn === true &&
    plugin.marketplaceEnabled &&
    plugin.nativeInstalled !== true &&
    (plugin.installedSources?.length ?? 0) === 0
  ))
  const featuredPlugins = availablePlugins.filter(plugin => plugin.featured === true)

  return interleaveMarketplacePlugins(
    featuredPlugins.length > 0 ? featuredPlugins : availablePlugins
  ).slice(0, limit)
}

export function PluginHomeView({
  catalogLoading,
  catalogPlugins,
  installedItems,
  onOpenInstalledItem,
  onOpenList,
  onOpenStore
}: {
  catalogLoading: boolean
  catalogPlugins: PluginMarketplaceCatalogPlugin[]
  installedItems: PluginListItem[]
  onOpenInstalledItem: (item: PluginListItem) => void
  onOpenList: () => void
  onOpenStore: (plugin?: PluginMarketplaceCatalogPlugin) => void
}) {
  const { t } = useTranslation()
  const recommendedPlugins = selectRecommendedMarketplacePlugins(catalogPlugins)

  return (
    <div className='plugin-home-view'>
      {installedItems.length > 0 && (
        <section className='plugin-home-view__section plugin-home-view__section--installed'>
          <div className='plugin-home-view__section-header'>
            <h2>{t('pluginStore.homeInstalled')}</h2>
            <RouteContainerHeaderActionButton
              item={{
                icon: <MaterialSymbol name='settings' />,
                key: 'manage-plugins',
                label: t('pluginStore.managePlugins'),
                onSelect: onOpenList
              }}
            />
          </div>
          <ul className='plugin-home-view__installed' aria-label={t('pluginStore.homeInstalled')}>
            {installedItems.map(item => (
              <li key={item.id} className='plugin-home-view__installed-entry'>
                <Tooltip title={item.name}>
                  <button
                    className='plugin-home-view__installed-item'
                    type='button'
                    aria-label={item.name}
                    onClick={() => onOpenInstalledItem(item)}
                  >
                    {renderIconAsset({ active: false, icon: item.icon })}
                  </button>
                </Tooltip>
              </li>
            ))}
          </ul>
        </section>
      )}

      {catalogLoading
        ? <div className='plugin-home-view__loading'>
          <Spin size='small' />
        </div>
        : recommendedPlugins.length > 0 && (
          <section className='plugin-home-view__section'>
            <div className='plugin-home-view__section-header'>
              <h2>{t('pluginStore.homeRecommended')}</h2>
              <RouteContainerHeaderActionButton
                item={{
                  icon: <MaterialSymbol name='storefront' />,
                  key: 'explore-plugins',
                  label: t('pluginStore.exploreMorePlugins'),
                  onSelect: onOpenStore
                }}
              />
            </div>
            <ul className='plugin-home-view__recommendations'>
              {recommendedPlugins.map(plugin => (
                <MarketplaceCard
                  key={`${plugin.marketplace}:${plugin.name}`}
                  icon={plugin.icon == null
                    ? <MarketplaceFormatIcon type={plugin.marketplaceType} />
                    : renderIconRef({
                      icon: plugin.icon,
                      imageClassName: 'plugin-marketplace__format-icon-image',
                      symbolClassName: 'plugin-marketplace__format-icon-symbol'
                    })}
                  title={plugin.displayName ?? plugin.name}
                  subtitle={plugin.marketplaceTitle ?? plugin.marketplace}
                  description={plugin.description}
                  onSelect={() => onOpenStore(plugin)}
                />
              ))}
            </ul>
          </section>
        )}
    </div>
  )
}
