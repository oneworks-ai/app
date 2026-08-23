import { Button, Tooltip } from 'antd'

import { ConfigRecordRow } from './ConfigRecordList'
import { DetailCollectionFieldActions } from './DetailCollectionFieldActions'
import type { DetailCollectionMoveAction } from './DetailCollectionFieldActions'
import type { SortableRecordGridRenderProps } from './SortableRecordGrid'
import type { ConfigDetailRoute, DetailCollectionEntry } from './configDetail'
import type { DetailCollectionContext, DetailListCollectionSpec } from './configSchema'
import type { TranslationFn } from './configUtils'

const resolveNarrowMoveActions = ({
  itemCount,
  localIndex,
  searchable,
  t
}: {
  itemCount: number
  localIndex: number
  searchable: boolean
  t: TranslationFn
}): DetailCollectionMoveAction[] => {
  if (searchable) return []
  return [
    ...(localIndex > 0
      ? [{
        className: 'conversation-template-collection__narrow-move-action',
        direction: -1 as const,
        icon: 'keyboard_arrow_up',
        label: t('config.editor.moveUp')
      }]
      : []),
    ...(localIndex < itemCount - 1
      ? [{
        className: 'conversation-template-collection__narrow-move-action',
        direction: 1 as const,
        icon: 'keyboard_arrow_down',
        label: t('config.editor.moveDown')
      }]
      : [])
  ]
}

export const ConversationTemplateSortableCard = ({
  detailCollection,
  detailContext,
  entry,
  fieldPath,
  itemCount,
  onMove,
  onOpenDetail,
  onRemove,
  searchable,
  sortable,
  t
}: {
  detailCollection: DetailListCollectionSpec
  detailContext: DetailCollectionContext
  entry: DetailCollectionEntry
  fieldPath: string[]
  itemCount: number
  onMove: (localIndex: number, direction: -1 | 1) => void
  onOpenDetail: (route: ConfigDetailRoute) => void
  onRemove: (localIndex: number) => void
  searchable: boolean
  sortable: SortableRecordGridRenderProps
  t: TranslationFn
}) => {
  const title = detailCollection.getItemTitle(entry.item, entry.key, entry.index, detailContext)
  const subtitle = detailCollection.getItemSubtitle?.(entry.item, entry.key, entry.index, detailContext)
  const description = detailCollection.getItemDescription?.(entry.item, entry.key, entry.index, detailContext)
  const localIndex = entry.localIndex
  const actions = entry.source === 'local' && localIndex != null
    ? (
      <DetailCollectionFieldActions
        className='conversation-template-collection__card-actions'
        index={localIndex}
        itemCount={itemCount}
        leadingAction={searchable ? undefined : (
          <Tooltip title={t('config.editor.reorder')}>
            <Button
              {...sortable.dragHandleProps}
              size='small'
              type='text'
              className='config-view__icon-button config-view__icon-button--compact conversation-template-collection__drag-handle'
              aria-label={t('config.editor.reorder')}
              icon={<span className='material-symbols-rounded'>drag_indicator</span>}
            />
          </Tooltip>
        )}
        moveActions={resolveNarrowMoveActions({
          itemCount,
          localIndex,
          searchable,
          t
        })}
        onMove={direction => onMove(localIndex, direction)}
        onRemove={() => onRemove(localIndex)}
        t={t}
      />
    )
    : undefined

  return (
    <ConfigRecordRow
      ref={sortable.ref}
      className={[
        'conversation-template-collection__card',
        entry.source === 'inherited' && 'config-view__record-card--readonly',
        sortable.isDragging && 'is-dragging'
      ].filter(Boolean).join(' ')}
      descriptions={[description]}
      rightSlot={actions}
      subtitle={subtitle}
      title={title}
      onClick={() =>
        onOpenDetail({
          kind: 'detailCollectionItem',
          fieldPath,
          itemKey: entry.key
        })}
      style={sortable.style}
    />
  )
}
