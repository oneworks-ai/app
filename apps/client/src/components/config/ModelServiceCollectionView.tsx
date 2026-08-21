import './ModelServiceCollectionView.scss'

import { useMemo, useState } from 'react'

import type { ConfigSource, ModelProviderDefinition, ModelServiceConfig } from '@oneworks/types'
import {
  getModelProviderDefinition,
  listModelProviderDefinitions,
  resolveModelProviderIdentity
} from '@oneworks/utils/model-providers'

import { AdapterImportRow } from './AdapterImportRow'
import type { AdapterImportAction } from './AdapterImportRow'
import { ModelServiceAvailableGroup, ModelServiceConfiguredGroup } from './ModelServiceCollectionGroups'
import { ModelServiceCollectionToolbar } from './ModelServiceCollectionToolbar'
import type { ConfigDetailRoute } from './configDetail'
import { toDetailCollectionEntries } from './configDetail'
import type { FieldSpec } from './configSchema'
import type { TranslationFn } from './configUtils'
import { getModelServiceProviderDescription, normalizeModelServiceText } from './modelServiceCollectionUtils'
import type { ModelServiceConfigSessionRequest } from './modelServiceConfigSession'

const resolveUniqueServiceKey = (baseKey: string, existingKeys: Set<string>) => {
  if (!existingKeys.has(baseKey)) return baseKey
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${baseKey}-${index}`
    if (!existingKeys.has(candidate)) return candidate
  }
  return `${baseKey}-${Date.now()}`
}

export function ModelServiceCollectionView({
  field,
  value,
  resolvedValue,
  source,
  onChange,
  onOpenDetail,
  creatingModelServiceSessionKey,
  onCreateModelServiceSession,
  modelServiceImportAction,
  t
}: {
  field: FieldSpec
  value: unknown
  resolvedValue?: unknown
  source: ConfigSource
  onChange: (nextValue: unknown) => void
  onOpenDetail: (route: ConfigDetailRoute) => void
  creatingModelServiceSessionKey?: string | null
  onCreateModelServiceSession?: (request: ModelServiceConfigSessionRequest) => void | Promise<void>
  modelServiceImportAction?: AdapterImportAction
  t: TranslationFn
}) {
  const [query, setQuery] = useState('')
  const [showConfigured, setShowConfigured] = useState(true)
  const [showAvailable, setShowAvailable] = useState(true)
  const [showCreateRow, setShowCreateRow] = useState(false)
  const [newRecordKey, setNewRecordKey] = useState('')

  const entries = useMemo(() =>
    toDetailCollectionEntries({
      field,
      value,
      resolvedValue
    }), [field, resolvedValue, value])
  const localValue = value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const existingKeys = useMemo(() => new Set(entries.map(entry => entry.key)), [entries])
  const configuredProviderIds = useMemo(() =>
    new Set(
      entries
        .map(entry => resolveModelProviderIdentity(entry.item as ModelServiceConfig).provider)
        .filter((providerId): providerId is string => providerId != null)
    ), [entries])
  const availableProviders = useMemo(() =>
    listModelProviderDefinitions()
      .filter(provider => provider.category !== 'custom' && !configuredProviderIds.has(provider.id)), [
    configuredProviderIds
  ])
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matchesQuery = (...values: Array<string | undefined>) => (
    normalizedQuery === '' || values.some(value => value?.toLocaleLowerCase().includes(normalizedQuery) === true)
  )
  const visibleEntries = showConfigured
    ? entries.filter((entry) => {
      const service = entry.item as ModelServiceConfig
      const providerId = resolveModelProviderIdentity(service).provider
      const provider = getModelProviderDefinition(providerId)
      return matchesQuery(
        entry.key,
        normalizeModelServiceText(service.title),
        provider?.title,
        getModelServiceProviderDescription(service, t)
      )
    })
    : []
  const visibleProviders = showAvailable
    ? availableProviders.filter(provider =>
      matchesQuery(
        provider.id,
        provider.title,
        t(`config.options.modelProviderDescriptions.${provider.id}`, {
          defaultValue: provider.description ?? ''
        })
      )
    )
    : []
  const openDetail = (itemKey: string) => {
    onOpenDetail({
      kind: 'detailCollectionItem',
      fieldPath: field.path,
      itemKey
    })
  }

  const createService = ({
    baseKey,
    provider
  }: {
    baseKey: string
    provider?: ModelProviderDefinition
  }) => {
    const normalizedBaseKey = baseKey.trim()
    if (normalizedBaseKey === '') return
    const itemKey = resolveUniqueServiceKey(normalizedBaseKey, existingKeys)
    const nextItem = field.detailCollection?.collectionKind === 'recordMap'
      ? field.detailCollection.createItem?.(itemKey) ?? {}
      : {}
    const service = provider == null
      ? nextItem
      : { ...nextItem, provider: provider.id }
    onChange({ ...localValue, [itemKey]: service })
    setNewRecordKey('')
    setShowCreateRow(false)
    openDetail(itemKey)
  }

  const removeService = (itemKey: string) => {
    const nextValue = { ...localValue }
    delete nextValue[itemKey]
    onChange(nextValue)
  }

  const noResults = visibleEntries.length === 0 && visibleProviders.length === 0

  return (
    <div className='model-service-collection'>
      {modelServiceImportAction != null && (
        <AdapterImportRow action={modelServiceImportAction} />
      )}
      <ModelServiceCollectionToolbar
        query={query}
        onQueryChange={setQuery}
        showConfigured={showConfigured}
        onShowConfiguredChange={setShowConfigured}
        showAvailable={showAvailable}
        onShowAvailableChange={setShowAvailable}
        showCreateRow={showCreateRow}
        onShowCreateRowChange={setShowCreateRow}
        newRecordKey={newRecordKey}
        onNewRecordKeyChange={setNewRecordKey}
        existingKeys={existingKeys}
        onCreateManual={baseKey => createService({ baseKey })}
        source={source}
        creatingModelServiceSessionKey={creatingModelServiceSessionKey}
        onCreateModelServiceSession={onCreateModelServiceSession}
        t={t}
      />

      <ModelServiceConfiguredGroup
        entries={visibleEntries}
        source={source}
        creatingModelServiceSessionKey={creatingModelServiceSessionKey}
        onCreateModelServiceSession={onCreateModelServiceSession}
        onOpen={openDetail}
        onRemove={removeService}
        t={t}
      />

      <ModelServiceAvailableGroup
        providers={visibleProviders}
        onConfigure={provider => createService({ baseKey: provider.id, provider })}
        t={t}
      />

      {noResults && (
        <div className='config-view__detail-list-empty model-service-collection__empty'>
          <div className='config-view__detail-list-empty-title'>
            {t('config.modelServices.collection.empty.title')}
          </div>
          <div className='config-view__detail-list-empty-desc'>
            {t('config.modelServices.collection.empty.description')}
          </div>
        </div>
      )}
    </div>
  )
}
