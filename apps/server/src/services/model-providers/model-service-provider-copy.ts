import { updateConfigFile } from '@oneworks/config'
import { modelServiceConfigSchema } from '@oneworks/core/config-schema'
import type { ConfigSource, ModelServiceConfig } from '@oneworks/types'
import {
  isModelServiceCollection,
  promoteModelServiceToProvider,
  resolveUniqueModelServiceKey
} from '@oneworks/utils/model-providers'

import { getWorkspaceFolder } from '#~/services/config/index.js'

import { ModelProvidersServiceError } from './errors.js'

const isConfigSource = (value: unknown): value is ConfigSource => (
  value === 'global' || value === 'project' || value === 'user'
)

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const mergeMaskedDraftValues = (incoming: unknown, existing: unknown): unknown => {
  if (Array.isArray(incoming)) return incoming
  if (!isRecord(incoming)) return incoming
  const existingRecord = isRecord(existing) ? existing : {}
  return Object.fromEntries(
    Object.entries(incoming).map(([key, value]) => [
      key,
      value === '******' ? existingRecord[key] : mergeMaskedDraftValues(value, existingRecord[key])
    ])
  )
}

export const copyModelServiceToProvider = async ({
  draft,
  serviceKey,
  source
}: {
  draft?: unknown
  serviceKey: string
  source: unknown
}) => {
  if (!isConfigSource(source)) {
    throw new ModelProvidersServiceError('invalid_source', 'Invalid config source.', { source })
  }

  let providerKey = ''
  await updateConfigFile({
    resolveValue: currentConfig => {
      const modelServices = currentConfig.modelServices ?? {}
      const existingService = modelServices[serviceKey]
      if (existingService == null) {
        throw new ModelProvidersServiceError(
          'model_service_not_found',
          `Model service "${serviceKey}" was not found.`,
          { serviceKey, source }
        )
      }
      if (isModelServiceCollection(existingService)) {
        throw new ModelProvidersServiceError(
          'model_service_already_collection',
          `Model service "${serviceKey}" is already a Provider collection.`,
          { serviceKey, source }
        )
      }

      const mergedService = draft == null
        ? existingService
        : mergeMaskedDraftValues(draft, existingService)
      const parsedService = modelServiceConfigSchema.safeParse(mergedService)
      if (!parsedService.success) {
        throw new ModelProvidersServiceError(
          'invalid_model_service_config',
          'The model service draft is invalid.',
          {
            issues: parsedService.error.issues.map(issue => ({
              message: issue.message,
              path: issue.path
            })),
            serviceKey,
            source
          }
        )
      }

      providerKey = resolveUniqueModelServiceKey(
        `${serviceKey}-provider`,
        new Set(Object.keys(modelServices))
      )
      return {
        ...modelServices,
        [providerKey]: promoteModelServiceToProvider(parsedService.data as ModelServiceConfig)
      }
    },
    section: 'modelServices',
    source,
    workspaceFolder: getWorkspaceFolder()
  })

  return { providerKey, source }
}
