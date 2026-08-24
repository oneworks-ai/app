import type { ConfigSource } from '@oneworks/types'
import {
  buildCollectionModelServiceKey,
  getModelProviderDefinition,
  getModelServiceProfiles,
  isModelServiceCollection,
  resolveCollectionModelService,
  resolveModelProviderIdentity
} from '@oneworks/utils/model-providers'

import { ModelServiceQuotaPreview } from './ModelServiceQuotaPreview'
import type { TranslationFn } from './configUtils'
import { toModelServiceConfig } from './modelServiceProviderActionUtils'

export const ModelServiceProviderQuotaPreview = ({
  item,
  serviceKey,
  source,
  t,
  onOpenProfiles,
  variant = 'compact'
}: {
  item: unknown
  serviceKey: string
  source: ConfigSource
  t: TranslationFn
  onOpenProfiles?: () => void
  variant?: 'cardFooter' | 'compact'
}) => {
  const service = toModelServiceConfig(item)
  if (!isModelServiceCollection(service)) {
    return (
      <ModelServiceQuotaPreview
        item={service}
        serviceKey={serviceKey}
        source={source}
        t={t}
        variant={variant}
      />
    )
  }

  const profiles = getModelServiceProfiles(service) ?? {}
  const previewProfiles = Object.keys(profiles).flatMap((profileKey) => {
    const profile = resolveCollectionModelService(service, profileKey)
    if (profile == null) return []
    const identity = resolveModelProviderIdentity(profile)
    const provider = identity.provider == null ? undefined : getModelProviderDefinition(identity.provider)
    if (provider?.capabilities?.balance !== 'api') return []
    const title = typeof profile.title === 'string' && profile.title.trim() !== ''
      ? profile.title.trim()
      : profileKey
    return [{ profile, profileKey, title }]
  })
  if (previewProfiles.length === 0) return null

  const hasMoreProfiles = previewProfiles.length > 3
  const visibleProfiles = previewProfiles.slice(0, hasMoreProfiles ? 2 : 3)
  const quotaPreview = (
    <div
      className='config-view__model-service-profile-quota-summary'
      aria-label={t('config.modelServices.profileQuotaSummary', { count: previewProfiles.length })}
    >
      {visibleProfiles.map(({ profile, profileKey, title }) => (
        <div className='config-view__model-service-profile-quota' key={profileKey}>
          <div className='config-view__model-service-profile-quota-title'>{title}</div>
          <ModelServiceQuotaPreview
            item={profile}
            serviceKey={buildCollectionModelServiceKey(serviceKey, profileKey)}
            source={source}
            t={t}
            variant={variant === 'cardFooter' ? 'list' : 'compact'}
          />
        </div>
      ))}
      {hasMoreProfiles && (
        onOpenProfiles == null
          ? (
            <div className='config-view__model-service-profile-quota-more'>
              +{previewProfiles.length - visibleProfiles.length}
            </div>
          )
          : (
            <button
              type='button'
              className='config-view__model-service-profile-quota-more'
              onClick={onOpenProfiles}
            >
              {t('config.modelServices.profileQuotaMore', { count: previewProfiles.length })}
            </button>
          )
      )}
    </div>
  )

  return variant === 'cardFooter'
    ? <div className='model-service-collection__quota-footer'>{quotaPreview}</div>
    : quotaPreview
}
