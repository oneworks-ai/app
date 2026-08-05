import { Tag } from 'antd'
import { useTranslation } from 'react-i18next'

import { renderIconAsset } from '#~/components/icons/IconAsset'
import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import { MarketplaceCard } from '#~/components/marketplace/MarketplaceCard'
import { projectPluginPresentationValue } from '#~/plugins/plugin-presentation'

import type { PluginListItem } from './plugin-runtime-list-items'

export function PluginRuntimeListCard({
  item,
  onOpen
}: {
  item: PluginListItem
  onOpen: (item: PluginListItem) => void
}) {
  const { t } = useTranslation()
  const safeSource = projectPluginPresentationValue(item.source)

  return (
    <MarketplaceCard
      icon={renderIconAsset({ active: false, icon: item.icon })}
      iconBadge={
        <span
          className={`plugin-runtime-list__status-dot is-${item.state}`}
          aria-label={t(`pluginStore.states.${item.state}`)}
          title={t(`pluginStore.states.${item.state}`)}
        />
      }
      onSelect={() => onOpen(item)}
      title={projectPluginPresentationValue(item.name)}
      titleMeta={
        <>
          {item.version != null && <Tag>{projectPluginPresentationValue(item.version)}</Tag>}
        </>
      }
      subtitle={
        <>
          <MaterialSymbol
            className='plugin-runtime-list__type-icon'
            name={item.kind === 'native' ? 'deployed_code' : 'extension'}
            aria-hidden='true'
          />
          <span>{item.kind === 'native' ? projectPluginPresentationValue(item.adapter) : 'OneWorks'}</span>
          <span>·</span>
          <span>
            {t(`pluginStore.sources.${safeSource}`, {
              defaultValue: safeSource
            })}
          </span>
        </>
      }
      description={item.description == null ? undefined : projectPluginPresentationValue(item.description)}
      footer={item.kind === 'native' && (
        <div className='plugin-runtime-list__native-note'>{t('pluginStore.nativeReadOnly')}</div>
      )}
    />
  )
}
