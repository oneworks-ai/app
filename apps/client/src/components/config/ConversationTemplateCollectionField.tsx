import './ConversationTemplateCollectionField.scss'

import { useMemo, useState } from 'react'

import { ActionSearchToolbar } from '#~/components/action-search-toolbar/ActionSearchToolbar'

import { ConfigRecordList } from './ConfigRecordList'
import { ConversationTemplateSortableCard } from './ConversationTemplateSortableCard'
import { SortableRecordGrid } from './SortableRecordGrid'
import type { ConfigDetailRoute } from './configDetail'
import { toDetailCollectionEntries } from './configDetail'
import type { FieldSpec } from './configSchema'
import type { TranslationFn } from './configUtils'

const normalizeSearchText = (value: unknown) => (
  typeof value === 'string' ? value.trim().toLocaleLowerCase() : ''
)

export const ConversationTemplateCollectionField = ({
  field,
  mergedAdapters,
  mergedModelServices,
  onChange,
  onOpenDetail,
  resolvedValue,
  t,
  value
}: {
  field: FieldSpec
  mergedAdapters: Record<string, unknown>
  mergedModelServices: Record<string, unknown>
  onChange: (nextValue: unknown) => void
  onOpenDetail: (route: ConfigDetailRoute) => void
  resolvedValue?: unknown
  t: TranslationFn
  value: unknown
}) => {
  const [query, setQuery] = useState('')
  const detailCollection = field.detailCollection
  const entries = toDetailCollectionEntries({ field, value, resolvedValue })
  const localItems = Array.isArray(value)
    ? value.filter(item => item != null && typeof item === 'object' && !Array.isArray(item)) as Array<
      Record<string, unknown>
    >
    : []
  const normalizedQuery = normalizeSearchText(query)
  const detailContext = useMemo(
    () => ({ mergedAdapters, mergedModelServices, t }),
    [mergedAdapters, mergedModelServices, t]
  )
  const visibleEntries = useMemo(() =>
    entries.filter((entry) => {
      if (normalizedQuery === '') return true
      const title = detailCollection?.getItemTitle(entry.item, entry.key, entry.index, detailContext) ?? ''
      const subtitle = detailCollection?.getItemSubtitle?.(entry.item, entry.key, entry.index, detailContext) ?? ''
      const description = detailCollection?.getItemDescription?.(entry.item, entry.key, entry.index, detailContext) ??
        ''
      return [title, subtitle, description]
        .some(value => normalizeSearchText(value).includes(normalizedQuery))
    }), [detailCollection, detailContext, entries, normalizedQuery])

  if (detailCollection?.collectionKind !== 'list') return null

  const openDetail = (itemKey: string) => {
    onOpenDetail({
      kind: 'detailCollectionItem',
      fieldPath: field.path,
      itemKey
    })
  }

  const updateLocalItems = (nextItems: Array<Record<string, unknown>>) => {
    onChange(nextItems)
  }

  const moveItemToIndex = (localIndex: number, targetIndex: number) => {
    if (localIndex === targetIndex || targetIndex < 0 || targetIndex >= localItems.length) return
    const nextItems = [...localItems]
    const [item] = nextItems.splice(localIndex, 1)
    if (item == null) return
    nextItems.splice(targetIndex, 0, item)
    updateLocalItems(nextItems)
  }

  const moveItem = (localIndex: number, direction: -1 | 1) => {
    moveItemToIndex(localIndex, localIndex + direction)
  }

  const sortableEntries = visibleEntries.map(entry => ({
    disabled: normalizedQuery !== '' || entry.source !== 'local' || entry.localIndex == null,
    id: entry.key
  }))

  const removeItem = (localIndex: number) => {
    updateLocalItems(localItems.filter((_, index) => index !== localIndex))
  }

  const addItem = () => {
    const nextItems = [...localItems, detailCollection.createItem()]
    updateLocalItems(nextItems)
    const nextEntries = toDetailCollectionEntries({ field, value: nextItems, resolvedValue })
    const nextEntry = nextEntries.find(entry => entry.localIndex === nextItems.length - 1)
    openDetail(nextEntry?.key ?? String(nextItems.length - 1))
  }

  return (
    <div className='conversation-template-collection'>
      <ActionSearchToolbar
        className='conversation-template-collection__toolbar'
        inset={false}
        placeholder={t('config.conversationTemplates.searchPlaceholder')}
        query={query}
        onQueryChange={setQuery}
        actions={[{
          ariaLabel: t('config.editor.addItem'),
          icon: 'add',
          key: 'add',
          title: t('config.editor.addItem'),
          onClick: addItem
        }]}
      />

      <ConfigRecordList className='conversation-template-collection__grid'>
        <SortableRecordGrid
          items={sortableEntries}
          onReorder={(activeId, overId) => {
            const activeEntry = visibleEntries.find(entry => entry.key === activeId)
            const overEntry = visibleEntries.find(entry => entry.key === overId)
            if (activeEntry?.localIndex == null || overEntry?.localIndex == null) return
            moveItemToIndex(activeEntry.localIndex, overEntry.localIndex)
          }}
        >
          {(sortableItem, sortable) => {
            const entry = visibleEntries.find(candidate => candidate.key === sortableItem.id)
            if (entry == null) return null
            return (
              <ConversationTemplateSortableCard
                detailCollection={detailCollection}
                detailContext={detailContext}
                entry={entry}
                fieldPath={field.path}
                itemCount={localItems.length}
                onMove={moveItem}
                onOpenDetail={onOpenDetail}
                onRemove={removeItem}
                searchable={normalizedQuery !== ''}
                sortable={sortable}
                t={t}
              />
            )
          }}
        </SortableRecordGrid>

        {visibleEntries.length === 0 && (
          <div className='config-view__detail-list-empty conversation-template-collection__empty'>
            <div className='config-view__detail-list-empty-desc'>
              {normalizedQuery === '' ? t('common.noData') : t('config.conversationTemplates.noMatches')}
            </div>
          </div>
        )}
      </ConfigRecordList>
    </div>
  )
}
