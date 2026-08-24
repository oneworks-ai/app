import './ModelServiceCollectionView.scss'
/* eslint-disable max-lines -- provider-first creation keeps catalog, filters, and compatibility creation together. */

import { useMemo, useState } from 'react'

import type { ConfigSource, ModelProviderDefinition, ModelServiceConfig } from '@oneworks/types'
import {
  getModelProviderDefinition,
  listModelProviderDefinitions,
  resolveModelProviderIdentity
} from '@oneworks/utils/model-providers'

import type { AdapterImportAction } from './AdapterImportRow'
import { ModelServiceAvailableGroup, ModelServiceConfiguredGroup } from './ModelServiceCollectionGroups'
import { ModelServiceCollectionToolbar } from './ModelServiceCollectionToolbar'
import type { ConfigDetailRoute } from './configDetail'
import { toDetailCollectionEntries } from './configDetail'
import type { FieldSpec } from './configSchema'
import type { TranslationFn } from './configUtils'
import { getModelServiceProviderDescription, normalizeModelServiceText } from './modelServiceCollectionUtils'
import type { ModelServiceConfigSessionRequest } from './modelServiceConfigSession'
import { resolveUniqueModelServiceKey } from './modelServiceProfileUtils'

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
  const createKinds = field.detailCollection?.collectionKind === 'recordMap'
    ? (field.detailCollection.createKinds ?? [])
    : []
  const [newRecordKind, setNewRecordKind] = useState(createKinds[0]?.key ?? 'service')

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
  const providerConfigurationCounts = useMemo(() => {
    const counts = new Map<string, number>()
    entries.forEach((entry) => {
      const providerId = resolveModelProviderIdentity(entry.item as ModelServiceConfig).provider
      if (providerId == null) return
      counts.set(providerId, (counts.get(providerId) ?? 0) + 1)
    })
    return counts
  }, [entries])
  const catalogProviders = useMemo(
    () => listModelProviderDefinitions().filter(provider => provider.category !== 'custom'),
    []
  )
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
    ? catalogProviders.filter(provider =>
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
  const openProfiles = (itemKey: string) => {
    onOpenDetail({
      kind: 'detailCollectionItem',
      fieldPath: field.path,
      itemKey,
      nestedPath: ['profiles']
    })
  }

  const createService = ({
    baseKey,
    itemKind,
    provider
  }: {
    baseKey: string
    itemKind: string
    provider?: ModelProviderDefinition
  }) => {
    const normalizedBaseKey = baseKey.trim()
    if (normalizedBaseKey === '') return
    const itemKey = resolveUniqueModelServiceKey(normalizedBaseKey, existingKeys)
    const nextItem = field.detailCollection?.collectionKind === 'recordMap'
      ? field.detailCollection.createItem?.(itemKey, itemKind) ?? {}
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
        newRecordKind={newRecordKind}
        onNewRecordKindChange={setNewRecordKind}
        createKindOptions={createKinds.map(item => ({
          value: item.key,
          label: t(item.labelKey)
        }))}
        existingKeys={existingKeys}
        modelServiceImportAction={modelServiceImportAction}
        onCreateManual={baseKey => createService({ baseKey, itemKind: newRecordKind })}
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
        onOpenProfiles={openProfiles}
        onRemove={removeService}
        t={t}
      />

      <ModelServiceAvailableGroup
        providers={visibleProviders}
        providerConfigurationCounts={providerConfigurationCounts}
        onConfigure={provider => createService({ baseKey: provider.id, itemKind: 'provider', provider })}
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
