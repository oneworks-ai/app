import type {
  AdapterBuiltinModel,
  ModelMetadataConfig,
  ModelServiceConfig,
  RecommendedModelConfig
} from '@oneworks/types'

import type { ServiceModelEntry } from './model-selector'
import { resolveModelServiceTitle } from './model-selector'
import {
  buildBuiltinModelGroups,
  buildRecommendedModelOptions,
  buildServiceModelGroups
} from './model-selector-data-builders'
import { sortOptionsByDisplayLabel } from './model-selector-data-option-utils'
import type { ModelSelectGroupData, ModelSelectOptionData, ModelSelectorData } from './model-selector-data-types'

export type { ModelSelectGroupData, ModelSelectOptionData, ModelSelectorData } from './model-selector-data-types'

const DEFAULT_BUILTIN_PREVIEW_LIMIT = 2

const resolveBuiltinPreviewGroup = (
  builtinGroups: ModelSelectGroupData[],
  adapterKey: string | undefined
) => {
  if (adapterKey != null && adapterKey.trim() !== '') {
    return builtinGroups.find(group => group.key === `builtin:${adapterKey}`)
  }

  return builtinGroups.length === 1 ? builtinGroups[0] : undefined
}

export const buildModelSelectorData = (params: {
  activeBuiltinModels: Record<string, AdapterBuiltinModel[]>
  availableServiceModels: ServiceModelEntry[]
  builtinPreviewAdapter?: string
  builtinPreviewLimit?: number
  defaultModelService?: string
  mergedModels: Record<string, ModelMetadataConfig>
  mergedModelServices: Record<string, ModelServiceConfig>
  recommendedModels: RecommendedModelConfig[]
  recommendedGroupTitle: string
  servicePreviewGroupTitle: string
  builtinGroupTitle: (adapterKey: string) => string
}): ModelSelectorData => {
  const modelToService = new Map<string, { key: string; title: string }>()
  for (const entry of params.availableServiceModels) {
    const serviceValue = params.mergedModelServices[entry.serviceKey]
    const serviceTitle = resolveModelServiceTitle({
      serviceKey: entry.serviceKey,
      service: serviceValue
    })
    if (!modelToService.has(entry.model)) {
      modelToService.set(entry.model, { key: entry.serviceKey, title: serviceTitle })
    }
  }

  const serviceGroups = buildServiceModelGroups({
    availableServiceModels: params.availableServiceModels,
    mergedModelServices: params.mergedModelServices,
    mergedModels: params.mergedModels
  })
  const builtinGroups = buildBuiltinModelGroups({
    activeBuiltinModels: params.activeBuiltinModels,
    builtinGroupTitle: params.builtinGroupTitle,
    mergedModels: params.mergedModels
  })
  const configuredRecommendedOptions = buildRecommendedModelOptions({
    availableServiceModels: params.availableServiceModels,
    defaultModelService: params.defaultModelService,
    mergedModels: params.mergedModels,
    mergedModelServices: params.mergedModelServices,
    recommendedModels: params.recommendedModels,
    modelToService
  })

  const servicePreviewOptions = serviceGroups
    .map(group => group.options[0] ?? null)
    .filter((option): option is ModelSelectOptionData => option != null)
  const builtinPreviewGroup = resolveBuiltinPreviewGroup(builtinGroups, params.builtinPreviewAdapter)
  const builtinPreviewLimit = params.builtinPreviewLimit ?? DEFAULT_BUILTIN_PREVIEW_LIMIT
  const builtinPreviewOptions = builtinPreviewLimit > 0
    ? builtinPreviewGroup?.options.slice(0, builtinPreviewLimit) ?? []
    : []

  const recommendedOptions = sortOptionsByDisplayLabel(configuredRecommendedOptions)

  const flatGroups: ModelSelectGroupData[] = []
  if (servicePreviewOptions.length > 0) {
    flatGroups.push({
      key: 'service-preview',
      title: params.servicePreviewGroupTitle,
      options: servicePreviewOptions
    })
  }

  if (builtinPreviewOptions.length > 0 && builtinPreviewGroup != null) {
    flatGroups.push({
      key: 'builtin-preview',
      title: builtinPreviewGroup.title,
      description: builtinPreviewGroup.description,
      options: builtinPreviewOptions
    })
  }

  if (recommendedOptions.length > 0) {
    flatGroups.push({
      key: 'recommended',
      title: params.recommendedGroupTitle,
      options: recommendedOptions
    })
  }

  const moreModelGroups = [...builtinGroups, ...serviceGroups]
  flatGroups.push(...moreModelGroups)

  const searchOptionMap = new Map<string, ModelSelectOptionData>()
  for (
    const option of [
      ...recommendedOptions,
      ...builtinPreviewOptions,
      ...servicePreviewOptions,
      ...moreModelGroups.flatMap(group => group.options)
    ]
  ) {
    if (!searchOptionMap.has(option.value)) {
      searchOptionMap.set(option.value, option)
    }
  }

  const searchOptions = Array.from(searchOptionMap.values())

  return {
    builtinPreviewOptions,
    servicePreviewOptions,
    recommendedOptions,
    moreModelGroups,
    flatGroups,
    searchOptions
  }
}
