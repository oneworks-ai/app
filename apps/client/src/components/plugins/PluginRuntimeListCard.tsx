import { Tag } from 'antd'
import { useTranslation } from 'react-i18next'

import { renderIconAsset } from '#~/components/icons/IconAsset'
import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import { MarketplaceCard } from '#~/components/marketplace/MarketplaceCard'

import type { PluginListItem } from './plugin-runtime-list-items'

export function PluginRuntimeListCard({
  item,
  onOpen
}: {
  item: PluginListItem
  onOpen: (item: PluginListItem) => void
}) {
  const { t } = useTranslation()

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
      title={item.name}
      titleMeta={
        <>
          {item.version != null && <Tag>{item.version}</Tag>}
        </>
      }
      subtitle={
        <>
          <MaterialSymbol
            className='plugin-runtime-list__type-icon'
            name={item.kind === 'native' ? 'deployed_code' : 'extension'}
            aria-hidden='true'
          />
          <span>{item.kind === 'native' ? item.adapter : 'OneWorks'}</span>
          <span>·</span>
          <span>{t(`pluginStore.sources.${item.source}`, { defaultValue: item.source })}</span>
        </>
      }
      description={item.description}
      footer={item.kind === 'native' && (
        <div className='plugin-runtime-list__native-note'>{t('pluginStore.nativeReadOnly')}</div>
      )}
    />
  )
}
