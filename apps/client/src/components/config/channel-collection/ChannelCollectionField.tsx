import './ChannelCollectionField.scss'

import { useMemo, useState } from 'react'

import type { ConfigUiSection } from '@oneworks/types'

import { ConfigRecordList } from '../ConfigRecordList'
import type { ConfigDetailRoute } from '../configDetail'
import { toDetailCollectionEntries } from '../configDetail'
import type { FieldSpec } from '../configSchema'
import { setValueByPath } from '../configUtils'
import type { TranslationFn } from '../configUtils'
import { buildConfigUiObjectDefaultValue } from '../record-editors/schemaRecordUtils'

import { ChannelCollectionCard, UnconfiguredChannelCard } from './ChannelCollectionCard'
import { ChannelCollectionToolbar } from './ChannelCollectionToolbar'
import { ChannelCreateModal } from './ChannelCreateModal'
import type { ChannelCollectionFilter } from './channel-collection-model'
import {
  getChannelDescription,
  getChannelDisplayTitle,
  getChannelType,
  matchesChannelQuery,
  normalizeChannelSearchText
} from './channel-collection-model'

export const ChannelCollectionField = ({
  field,
  value,
  resolvedValue,
  onChange,
  onOpenDetail,
  uiSection,
  t
}: {
  field: FieldSpec
  value: unknown
  resolvedValue?: unknown
  onChange: (nextValue: unknown) => void
  onOpenDetail: (route: ConfigDetailRoute) => void
  uiSection?: ConfigUiSection
  t: TranslationFn
}) => {
  const [createOpen, setCreateOpen] = useState(false)
  const [filter, setFilter] = useState<ChannelCollectionFilter>('all')
  const [newRecordKey, setNewRecordKey] = useState('')
  const [newRecordKind, setNewRecordKind] = useState(
    uiSection?.kind === 'recordMap' ? (uiSection.recordMap.entryKinds?.[0]?.key ?? '') : ''
  )
  const [query, setQuery] = useState('')

  const items = toDetailCollectionEntries({ field, value, resolvedValue })
  const entryKinds = uiSection?.kind === 'recordMap'
    ? (uiSection.recordMap.entryKinds ?? [])
    : []
  const kindsByKey = useMemo(
    () => new Map(entryKinds.map(kind => [kind.key, kind])),
    [entryKinds]
  )
  const configuredTypes = new Set(items.map(({ item }) => getChannelType(item)).filter(Boolean))
  const unconfiguredKinds = entryKinds.filter(kind => !configuredTypes.has(kind.key))
  const normalizedQuery = normalizeChannelSearchText(query)
  const visibleItems = filter === 'unconfigured'
    ? []
    : items.filter(({ item, key }) => {
      const type = getChannelType(item)
      const kind = kindsByKey.get(type)
      return matchesChannelQuery(
        normalizedQuery,
        key,
        getChannelDisplayTitle(item, key),
        type,
        kind?.label,
        getChannelDescription(item, kind)
      )
    })
  const visibleUnconfiguredKinds = filter === 'configured'
    ? []
    : unconfiguredKinds.filter(kind =>
      matchesChannelQuery(
        normalizedQuery,
        kind.key,
        kind.label,
        kind.description
      )
    )
  const kindOptions = entryKinds.map(kind => ({
    value: kind.key,
    label: kind.label ?? kind.key
  }))
  const trimmedNewRecordKey = newRecordKey.trim()
  const canAddRecordItem = trimmedNewRecordKey !== '' &&
    newRecordKind !== '' &&
    !items.some(item => item.key === trimmedNewRecordKey)

  const closeCreate = () => {
    setCreateOpen(false)
    setNewRecordKey('')
  }

  const openCreate = (kind = newRecordKind) => {
    setNewRecordKind(kind)
    setCreateOpen(true)
  }

  const addRecordItem = () => {
    if (!canAddRecordItem || uiSection?.kind !== 'recordMap') return false
    const schema = uiSection.recordMap.schemas[newRecordKind] ?? uiSection.recordMap.unknownSchema
    const discriminatorField = uiSection.recordMap.discriminatorField ?? 'type'
    const nextItem = setValueByPath(
      buildConfigUiObjectDefaultValue(schema),
      [discriminatorField],
      newRecordKind
    ) as Record<string, unknown>

    onChange(setValueByPath(value, [trimmedNewRecordKey], nextItem))
    onOpenDetail({
      kind: 'detailCollectionItem',
      fieldPath: field.path,
      itemKey: trimmedNewRecordKey,
      nestedPath: ['overview']
    })
    return true
  }

  const removeRecordItem = (itemKey: string) => {
    const currentValue = value != null && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {}
    delete currentValue[itemKey]
    onChange(currentValue)
  }

  const toggleFilter = (nextFilter: Exclude<ChannelCollectionFilter, 'all'>) => {
    setFilter(current => current === nextFilter ? 'all' : nextFilter)
  }

  return (
    <div className='channel-collection'>
      <ChannelCollectionToolbar
        addDisabled={kindOptions.length === 0}
        filter={filter}
        query={query}
        onQueryChange={setQuery}
        onFilterChange={toggleFilter}
        onAdd={() => openCreate()}
        t={t}
      />

      <ConfigRecordList className='channel-collection__grid'>
        {visibleItems.map((entry, index) => (
          <ChannelCollectionCard
            key={entry.key}
            entry={entry}
            field={field}
            index={index}
            itemCount={items.length}
            kind={kindsByKey.get(getChannelType(entry.item))}
            onOpenDetail={onOpenDetail}
            onRemove={() => removeRecordItem(entry.key)}
            t={t}
          />
        ))}

        {visibleUnconfiguredKinds.map(kind => (
          <UnconfiguredChannelCard
            key={`unconfigured:${kind.key}`}
            kind={kind}
            onSelect={() => openCreate(kind.key)}
            t={t}
          />
        ))}

        {visibleItems.length === 0 && visibleUnconfiguredKinds.length === 0 && (
          <div className='config-view__detail-list-empty channel-collection__empty'>
            <div className='config-view__detail-list-empty-desc'>
              {t('config.channels.noMatches')}
            </div>
          </div>
        )}
      </ConfigRecordList>

      <ChannelCreateModal
        open={createOpen}
        canSubmit={canAddRecordItem}
        name={newRecordKey}
        kind={newRecordKind}
        kindOptions={kindOptions}
        onNameChange={setNewRecordKey}
        onKindChange={setNewRecordKind}
        onCancel={closeCreate}
        onSubmit={() => {
          if (addRecordItem()) closeCreate()
        }}
        t={t}
      />
    </div>
  )
}
