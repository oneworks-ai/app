import type {
  AdapterBuiltinModel,
  IconRef,
  ModelMetadataConfig,
  ModelServiceConfig,
  RecommendedModelConfig
} from '@oneworks/types'

import { getAdapterDisplay } from '#~/resources/adapters.js'

import type { ServiceModelEntry, ServiceModelOption } from './model-selector'
import {
  buildServiceModelSelector,
  resolveModelDisplayMetadata,
  resolveModelServiceTitle,
  resolveServiceModelSelector
} from './model-selector'
import { buildModelSelectOption } from './model-selector-data-option-utils'

type ServiceModelOptionLike = ServiceModelEntry & Partial<Pick<ServiceModelOption, 'serviceIcon' | 'modelIcon'>>

const buildAdapterIconRef = (adapterKey: string): IconRef => {
  const { darkIcon, icon } = getAdapterDisplay(adapterKey)
  if (icon != null && icon.trim() !== '') {
    return {
      kind: 'url',
      url: icon,
      darkUrl: darkIcon?.trim() || undefined
    }
  }

  return { kind: 'material', name: 'deployed_code' }
}

export const buildServiceModelGroups = (params: {
  availableServiceModels: ServiceModelOptionLike[]
  mergedModelServices: Record<string, ModelServiceConfig>
  mergedModels: Record<string, ModelMetadataConfig>
}) => {
  const serviceModelsByKey = new Map<string, ServiceModelOptionLike[]>()
  for (const entry of params.availableServiceModels) {
    const entries = serviceModelsByKey.get(entry.serviceKey) ?? []
    entries.push(entry)
    serviceModelsByKey.set(entry.serviceKey, entries)
  }

  return Object.entries(params.mergedModelServices)
    .map(([serviceKey, serviceValue]) => {
      const service = (serviceValue != null && typeof serviceValue === 'object')
        ? serviceValue
        : undefined
      const serviceTitle = resolveModelServiceTitle({
        serviceKey,
        service
      })
      const title = serviceTitle?.trim() !== '' ? serviceTitle : serviceKey
      const models = serviceModelsByKey.get(serviceKey) ?? []

      if (models.length === 0) return null

      return {
        key: `service:${serviceKey}`,
        title,
        description: service?.description?.trim() || undefined,
        options: models.map((entry) => {
          const value = buildServiceModelSelector(serviceKey, entry.model)
          const metadata = resolveModelDisplayMetadata({
            model: value,
            models: params.mergedModels
          })

          return buildModelSelectOption({
            value,
            title: metadata?.title ?? metadata?.aliases[0] ?? entry.model,
            modelName: entry.model,
            description: metadata?.description,
            aliases: metadata?.aliases,
            serviceKey,
            serviceTitle,
            serviceIcon: entry.serviceIcon,
            modelIcon: entry.modelIcon,
            searchTerms: [entry.model, ...(metadata?.aliases ?? []), metadata?.title]
          })
        })
      }
    })
    .filter((group): group is NonNullable<typeof group> => group != null)
}

export const buildBuiltinModelGroups = (params: {
  activeBuiltinModels: Record<string, AdapterBuiltinModel[]>
  builtinGroupTitle: (adapterKey: string) => string
  mergedModels: Record<string, ModelMetadataConfig>
}) => {
  return Object.entries(params.activeBuiltinModels)
    .map(([adapterKey, models]) => {
      if (!Array.isArray(models) || models.length === 0) return null

      const adapterIcon = buildAdapterIconRef(adapterKey)

      return {
        key: `builtin:${adapterKey}`,
        title: params.builtinGroupTitle(adapterKey),
        options: models.map((model) => {
          const metadata = resolveModelDisplayMetadata({
            model: model.value,
            models: params.mergedModels
          })

          return buildModelSelectOption({
            value: model.value,
            title: metadata?.title ?? metadata?.aliases[0] ?? model.title,
            modelName: model.value,
            description: metadata?.description ?? model.description,
            aliases: metadata?.aliases,
            modelIcon: adapterIcon,
            searchTerms: [model.value, ...(metadata?.aliases ?? []), metadata?.title]
          })
        })
      }
    })
    .filter((group): group is NonNullable<typeof group> => group != null)
}

export const buildRecommendedModelOptions = (params: {
  availableServiceModels: ServiceModelOptionLike[]
  defaultModelService?: string
  mergedModels: Record<string, ModelMetadataConfig>
  mergedModelServices: Record<string, ModelServiceConfig>
  recommendedModels: RecommendedModelConfig[]
  modelToService: Map<string, { key: string; title: string }>
}) => {
  return params.recommendedModels
    .filter((item) => {
      if (item.placement && item.placement !== 'modelSelector') return false

      return resolveServiceModelSelector({
        value: item.service ? buildServiceModelSelector(item.service, item.model) : item.model,
        serviceModels: params.availableServiceModels,
        preferredServiceKey: item.service ?? params.defaultModelService
      }) != null
    })
    .map((item) => {
      const serviceInfo = item.service ? params.mergedModelServices[item.service] : undefined
      const serviceTitle = item.service
        ? resolveModelServiceTitle({
          serviceKey: item.service,
          service: serviceInfo
        })
        : params.modelToService.get(item.model)?.title
      const resolvedModel = item.service ? buildServiceModelSelector(item.service, item.model) : item.model
      const metadata = resolveModelDisplayMetadata({
        model: resolvedModel,
        models: params.mergedModels
      })
      const recommendedTitle = item.title?.trim()
      const recommendedDescription = item.description?.trim()
      const value = resolveServiceModelSelector({
        value: resolvedModel,
        serviceModels: params.availableServiceModels,
        preferredServiceKey: item.service ?? params.defaultModelService
      }) ?? item.model
      const serviceModelOption = params.availableServiceModels.find(entry => entry.selectorValue === value)

      return buildModelSelectOption({
        value,
        title: recommendedTitle || metadata?.title || metadata?.aliases[0] || item.model,
        modelName: item.model,
        description: recommendedDescription || metadata?.description,
        aliases: metadata?.aliases,
        serviceKey: item.service ?? params.modelToService.get(item.model)?.key,
        serviceTitle,
        serviceIcon: serviceModelOption?.serviceIcon,
        modelIcon: serviceModelOption?.modelIcon,
        searchTerms: [item.model, ...(metadata?.aliases ?? []), metadata?.title]
      })
    })
}
