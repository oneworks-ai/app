import type { ConfigSource, ModelProviderDefinition, ModelServiceConfig } from '@oneworks/types'
import {
  getModelProviderDefinition,
  resolveModelProviderIdentity,
  resolveModelServiceHomepageUrl,
  resolveModelServiceIcon
} from '@oneworks/utils/model-providers'

import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import { renderIconRef } from '#~/utils/model-provider-icons'

import type { ConfigRecordAction } from './ConfigRecordList'
import { ConfigRecordRow } from './ConfigRecordList'
import { ModelServiceProviderQuotaPreview } from './ModelServiceProviderQuotaPreview'
import type { TranslationFn } from './configUtils'
import {
  getModelServiceProviderDescription,
  getModelServiceTypeKey,
  normalizeModelServiceText
} from './modelServiceCollectionUtils'
import { getModelServiceConfigSessionActionKey } from './modelServiceConfigSession'
import type { ModelServiceConfigSessionRequest } from './modelServiceConfigSession'
import { normalizePortalUrl, openExternalUrl } from './modelServiceProviderActionUtils'

const renderProviderIcon = (service: ModelServiceConfig) => (
  <span className='config-view__adapter-icon-wrap' aria-hidden='true'>
    {renderIconRef({
      icon: resolveModelServiceIcon(service),
      imageClassName: 'config-view__adapter-icon',
      symbolClassName: 'config-view__adapter-icon-fallback'
    })}
  </span>
)

export interface ModelServiceCollectionEntry {
  hasResolvedOverlay: boolean
  item: Record<string, unknown>
  key: string
  source: 'inherited' | 'local' | 'placeholder'
}

export function ModelServiceConfiguredCard({
  creatingModelServiceSessionKey,
  entry,
  onCreateModelServiceSession,
  onOpen,
  onRemove,
  source,
  t
}: {
  creatingModelServiceSessionKey?: string | null
  entry: ModelServiceCollectionEntry
  onCreateModelServiceSession?: (request: ModelServiceConfigSessionRequest) => void | Promise<void>
  onOpen: () => void
  onRemove: () => void
  source: ConfigSource
  t: TranslationFn
}) {
  const service = entry.item as ModelServiceConfig
  const provider = getModelProviderDefinition(resolveModelProviderIdentity(service).provider)
  const title = normalizeModelServiceText(service.title) ?? provider?.title ?? entry.key
  const typeLabel = t(`config.modelServices.collection.types.${getModelServiceTypeKey(service, provider)}`)
  const badgeKey = entry.source === 'inherited'
    ? 'inherited'
    : entry.hasResolvedOverlay
    ? 'override'
    : 'configured'
  const badgeClass = badgeKey === 'inherited' ? 'readonly' : badgeKey
  const actions: ConfigRecordAction[] = []
  const updateSessionActionKey = getModelServiceConfigSessionActionKey({
    mode: 'update',
    serviceKey: entry.key,
    source
  })

  if (onCreateModelServiceSession != null) {
    actions.push({
      ariaLabel: t('config.actions.configureModelServiceWithSession'),
      disabled: creatingModelServiceSessionKey != null &&
        creatingModelServiceSessionKey !== updateSessionActionKey,
      icon: <MaterialSymbol name='forum' />,
      key: 'session',
      loading: creatingModelServiceSessionKey === updateSessionActionKey,
      onClick: () =>
        void onCreateModelServiceSession({
          mode: 'update',
          service: entry.item,
          serviceKey: entry.key,
          source
        }),
      title: t('config.actions.configureModelServiceWithSession')
    })
  }

  const homepageUrl = normalizePortalUrl(resolveModelServiceHomepageUrl(service))
  if (homepageUrl != null) {
    actions.push({
      ariaLabel: t('config.actions.openModelServiceHomepage'),
      icon: <MaterialSymbol name='open_in_new' />,
      key: 'homepage',
      onClick: () => void openExternalUrl(homepageUrl),
      title: t('config.actions.openModelServiceHomepage')
    })
  }

  if (entry.source === 'local') {
    actions.push({
      ariaLabel: t('common.delete'),
      danger: true,
      icon: <MaterialSymbol name='delete' />,
      key: 'delete',
      onClick: onRemove,
      title: t('common.delete')
    })
  }

  return (
    <ConfigRecordRow
      className='model-service-collection__card model-service-collection__card--configured'
      icon={renderProviderIcon(service)}
      title={
        <span className='model-service-collection__card-title'>
          <span>{title}</span>
          <span className={`config-view__detail-badge config-view__detail-badge--${badgeClass}`}>
            {t(`config.modelServices.collection.states.${badgeKey}`)}
          </span>
        </span>
      }
      subtitle={typeLabel}
      descriptions={[getModelServiceProviderDescription(service, t)]}
      rightSlot={
        <ModelServiceProviderQuotaPreview
          item={entry.item}
          serviceKey={entry.key}
          source={source}
          t={t}
        />
      }
      actions={actions}
      onClick={onOpen}
    />
  )
}

export function ModelServiceAvailableCard({
  onConfigure,
  provider,
  t
}: {
  onConfigure: () => void
  provider: ModelProviderDefinition
  t: TranslationFn
}) {
  const service: ModelServiceConfig = { provider: provider.id }
  const description = t(`config.options.modelProviderDescriptions.${provider.id}`, {
    defaultValue: provider.description ?? ''
  })
  return (
    <ConfigRecordRow
      className='model-service-collection__card model-service-collection__card--available'
      icon={renderProviderIcon(service)}
      title={
        <span className='model-service-collection__card-title'>
          <span>{provider.title}</span>
          <span className='config-view__detail-badge model-service-collection__available-badge'>
            {t('config.modelServices.collection.states.available')}
          </span>
        </span>
      }
      subtitle={t(`config.modelServices.collection.types.${getModelServiceTypeKey(service, provider)}`)}
      descriptions={[description]}
      actions={[{
        ariaLabel: t('config.modelServices.collection.actions.configure', { provider: provider.title }),
        icon: <MaterialSymbol name='add' />,
        key: 'configure',
        onClick: onConfigure,
        title: t('config.modelServices.collection.actions.configure', { provider: provider.title }),
        type: 'primary'
      }]}
    />
  )
}
