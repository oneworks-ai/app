import './PluginHomeView.scss'

import { RouteContainerHeaderActionButton } from '@oneworks/components/route-layout'
import { Spin, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'

import type { PluginMarketplaceCatalogPlugin } from '@oneworks/types'

import { renderIconAsset } from '#~/components/icons/IconAsset'
import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import { MarketplaceCard } from '#~/components/marketplace/MarketplaceCard'
import {
  projectPluginPresentationValue,
  resolveMarketplacePluginDescription,
  resolveMarketplacePluginDisplayName,
  sanitizePluginIconRef
} from '#~/plugins/plugin-presentation'
import { renderIconRef } from '#~/utils/model-provider-icons'

import { MarketplaceFormatIcon } from './PluginMarketplaceLanding'
import { groupRecommendedMarketplacePlugins, selectRecommendedMarketplacePlugins } from './plugin-recommendations'
import type { PluginListItem } from './plugin-runtime-list-items'

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
  const recommendedPluginGroups = groupRecommendedMarketplacePlugins(
    selectRecommendedMarketplacePlugins(catalogPlugins)
  )

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
        : recommendedPluginGroups.length > 0 && (
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
            <div className='plugin-home-view__recommendation-groups'>
              {recommendedPluginGroups.map(group => (
                <section
                  key={group.category}
                  className='plugin-home-view__recommendation-group'
                  aria-labelledby={`plugin-recommendation-category-${group.category}`}
                >
                  <h3 id={`plugin-recommendation-category-${group.category}`}>
                    {t(`pluginStore.recommendationCategories.${group.category}`)}
                  </h3>
                  <ul className='plugin-home-view__recommendations'>
                    {group.plugins.map(plugin => (
                      <MarketplaceCard
                        key={`${plugin.marketplace}:${plugin.name}`}
                        icon={sanitizePluginIconRef(plugin.icon) == null
                          ? <MarketplaceFormatIcon type={plugin.marketplaceType} />
                          : renderIconRef({
                            icon: sanitizePluginIconRef(plugin.icon),
                            imageClassName: 'plugin-marketplace__format-icon-image',
                            symbolClassName: 'plugin-marketplace__format-icon-symbol'
                          })}
                        title={resolveMarketplacePluginDisplayName(plugin)}
                        subtitle={projectPluginPresentationValue(plugin.marketplaceTitle ?? plugin.marketplace)}
                        description={resolveMarketplacePluginDescription(plugin)}
                        onSelect={() => onOpenStore(plugin)}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </section>
        )}
    </div>
  )
}
