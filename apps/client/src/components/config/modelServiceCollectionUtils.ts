import type { ModelProviderDefinition, ModelServiceConfig } from '@oneworks/types'
import {
  resolveModelProviderIdentity,
  resolveModelServiceCodingPlan,
  resolveModelServiceDescription
} from '@oneworks/utils/model-providers'

import type { TranslationFn } from './configUtils'

export const normalizeModelServiceText = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

export const getModelServiceProviderDescription = (
  service: ModelServiceConfig,
  t: TranslationFn
) => {
  const fallback = resolveModelServiceDescription(service)
  const providerId = resolveModelProviderIdentity(service).provider
  if (providerId == null) return fallback
  const key = `config.options.modelProviderDescriptions.${providerId}`
  const translated = t(key, { defaultValue: fallback ?? '' }).trim()
  return translated !== '' && translated !== key ? translated : fallback
}

export const getModelServiceTypeKey = (
  service: ModelServiceConfig,
  providerDefinition?: ModelProviderDefinition
) => {
  if (service.kind === 'collection' || service.profiles != null || service.services != null) return 'collection'
  if (resolveModelServiceCodingPlan(service) != null) return 'codingPlan'
  if (providerDefinition?.category === 'relay') return 'relay'
  if (providerDefinition?.category === 'gateway') return 'gateway'
  return resolveModelProviderIdentity(service).provider == null ? 'custom' : 'api'
}
