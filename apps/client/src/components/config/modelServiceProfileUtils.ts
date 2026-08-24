import type { ModelServiceConfig } from '@oneworks/types'
import {
  DEFAULT_MODEL_SERVICE_PROFILE_KEY,
  promoteModelServiceToProvider,
  resolveUniqueModelServiceKey
} from '@oneworks/utils/model-providers'

export { DEFAULT_MODEL_SERVICE_PROFILE_KEY, promoteModelServiceToProvider, resolveUniqueModelServiceKey }

export const createProviderModelServiceConfig = (): Record<string, unknown> => ({
  kind: 'collection',
  title: '',
  description: '',
  profiles: {
    [DEFAULT_MODEL_SERVICE_PROFILE_KEY]: {
      extra: {}
    }
  }
})

export const createProviderCopyFromModelService = ({
  existingKeys,
  modelServices,
  service,
  serviceKey
}: {
  existingKeys: Set<string>
  modelServices: Record<string, unknown>
  service: ModelServiceConfig
  serviceKey: string
}) => {
  const providerKey = resolveUniqueModelServiceKey(`${serviceKey}-provider`, existingKeys)
  return {
    modelServices: {
      ...modelServices,
      [providerKey]: promoteModelServiceToProvider(service)
    },
    providerKey
  }
}
