import type { ConfigSource, ModelProviderDefinition } from '@oneworks/types'

import { ConfigRecordList } from './ConfigRecordList'
import { ModelServiceAvailableCard, ModelServiceConfiguredCard } from './ModelServiceCollectionCards'
import type { ModelServiceCollectionEntry } from './ModelServiceCollectionCards'
import type { TranslationFn } from './configUtils'
import type { ModelServiceConfigSessionRequest } from './modelServiceConfigSession'

export function ModelServiceConfiguredGroup({
  creatingModelServiceSessionKey,
  entries,
  onCreateModelServiceSession,
  onOpen,
  onRemove,
  source,
  t
}: {
  creatingModelServiceSessionKey?: string | null
  entries: ModelServiceCollectionEntry[]
  onCreateModelServiceSession?: (request: ModelServiceConfigSessionRequest) => void | Promise<void>
  onOpen: (itemKey: string) => void
  onRemove: (itemKey: string) => void
  source: ConfigSource
  t: TranslationFn
}) {
  if (entries.length === 0) return null
  return (
    <section className='model-service-collection__section'>
      <div className='model-service-collection__section-heading'>
        <span>{t('config.modelServices.collection.groups.configured')}</span>
        <span aria-label={t('config.modelServices.collection.count', { count: entries.length })}>
          {entries.length}
        </span>
      </div>
      <ConfigRecordList className='model-service-collection__grid'>
        {entries.map(entry => (
          <ModelServiceConfiguredCard
            key={entry.key}
            entry={entry}
            source={source}
            creatingModelServiceSessionKey={creatingModelServiceSessionKey}
            onCreateModelServiceSession={onCreateModelServiceSession}
            onOpen={() => onOpen(entry.key)}
            onRemove={() => onRemove(entry.key)}
            t={t}
          />
        ))}
      </ConfigRecordList>
    </section>
  )
}

export function ModelServiceAvailableGroup({
  onConfigure,
  providerConfigurationCounts,
  providers,
  t
}: {
  onConfigure: (provider: ModelProviderDefinition) => void
  providerConfigurationCounts: ReadonlyMap<string, number>
  providers: ModelProviderDefinition[]
  t: TranslationFn
}) {
  if (providers.length === 0) return null
  return (
    <section className='model-service-collection__section'>
      <div className='model-service-collection__section-heading'>
        <span>{t('config.modelServices.collection.groups.available')}</span>
        <span aria-label={t('config.modelServices.collection.count', { count: providers.length })}>
          {providers.length}
        </span>
      </div>
      <ConfigRecordList className='model-service-collection__grid'>
        {providers.map(provider => (
          <ModelServiceAvailableCard
            key={provider.id}
            provider={provider}
            configuredCount={providerConfigurationCounts.get(provider.id) ?? 0}
            onConfigure={() => onConfigure(provider)}
            t={t}
          />
        ))}
      </ConfigRecordList>
    </section>
  )
}
