import type { ConfigUiRecordKind } from '@oneworks/types'

import { ConfigRecordRow } from '../ConfigRecordList'
import { DetailCollectionFieldActions } from '../DetailCollectionFieldActions'
import type { ConfigDetailRoute, DetailCollectionEntry } from '../configDetail'
import type { FieldSpec } from '../configSchema'
import type { TranslationFn } from '../configUtils'

import { getChannelDescription, getChannelDisplayTitle, getChannelType } from './channel-collection-model'

export const ChannelCollectionCard = ({
  entry,
  field,
  index,
  itemCount,
  kind,
  onOpenDetail,
  onRemove,
  t
}: {
  entry: DetailCollectionEntry
  field: FieldSpec
  index: number
  itemCount: number
  kind?: ConfigUiRecordKind
  onOpenDetail: (route: ConfigDetailRoute) => void
  onRemove: () => void
  t: TranslationFn
}) => {
  const { item, key, source, hasResolvedOverlay } = entry
  const type = getChannelType(item)
  const title = getChannelDisplayTitle(item, key)
  const typeLabel = kind?.label ?? (type || t('config.editor.unknownChannelType'))
  const enabled = item.enabled !== false
  const subtitle = title === key
    ? typeLabel
    : (
      <span className='channel-collection__subtitle'>
        <span>{typeLabel}</span>
        <span>{key}</span>
      </span>
    )

  return (
    <ConfigRecordRow
      className='channel-collection__card'
      title={title}
      subtitle={subtitle}
      descriptions={[getChannelDescription(item, kind)]}
      onClick={() =>
        onOpenDetail({
          kind: 'detailCollectionItem',
          fieldPath: field.path,
          itemKey: key,
          nestedPath: ['overview']
        })}
      rightSlot={
        <div className='channel-collection__state-tray'>
          <span
            className={`channel-collection__state${enabled ? '' : ' channel-collection__state--disabled'}`}
          >
            {enabled
              ? t('config.channels.status.configured')
              : t('config.channels.status.disabled')}
          </span>
          {source === 'inherited' && (
            <span className='config-view__detail-badge config-view__detail-badge--readonly'>
              {t('config.detail.inheritedBadge')}
            </span>
          )}
          {source === 'local' && hasResolvedOverlay && (
            <span className='config-view__detail-badge config-view__detail-badge--override'>
              {t('config.detail.overrideBadge')}
            </span>
          )}
          {source === 'local' && (
            <DetailCollectionFieldActions
              index={index}
              itemCount={itemCount}
              onRemove={onRemove}
              t={t}
            />
          )}
        </div>
      }
    />
  )
}

export const UnconfiguredChannelCard = ({
  kind,
  onSelect,
  t
}: {
  kind: ConfigUiRecordKind
  onSelect: () => void
  t: TranslationFn
}) => (
  <ConfigRecordRow
    className='channel-collection__card channel-collection__card--unconfigured'
    title={kind.label ?? kind.key}
    subtitle={kind.key}
    descriptions={[kind.description]}
    onClick={onSelect}
    rightSlot={
      <span className='channel-collection__state channel-collection__state--unconfigured'>
        {t('config.channels.status.unconfigured')}
      </span>
    }
  />
)
