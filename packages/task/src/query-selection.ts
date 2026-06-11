import { resolveAdapterCommonConfig } from '@oneworks/config'
import type { AdapterCtx } from '@oneworks/types'
import {
  listServiceModels,
  normalizeNonEmptyString,
  resolveAdapterConfiguredDefaultModel,
  resolveDefaultModelSelection,
  resolveModelDefaultAdapter,
  resolveModelSelection,
  resolveRunnableAdapterKeys
} from '@oneworks/utils'

const pickFirstNonEmptyString = (values: unknown[]) =>
  values
    .map(normalizeNonEmptyString)
    .find((value): value is string => value != null)

const parseAdapterPrefixedModelSelection = (
  inputModel: string | undefined,
  availableAdapters: string[]
) => {
  const normalizedModel = normalizeNonEmptyString(inputModel)
  if (normalizedModel == null) {
    return undefined
  }

  const separatorIndex = normalizedModel.indexOf('/')
  if (separatorIndex <= 0 || separatorIndex >= normalizedModel.length - 1) {
    return undefined
  }

  const adapter = normalizeNonEmptyString(normalizedModel.slice(0, separatorIndex))
  const model = normalizeNonEmptyString(normalizedModel.slice(separatorIndex + 1))
  if (adapter == null || model == null || !availableAdapters.includes(adapter)) {
    return undefined
  }

  return {
    adapter,
    model
  }
}

export const resolveQuerySelection = (params: {
  mergedConfig?: AdapterCtx['configs'][0]
  inputAdapter?: string
  inputModel?: string
}) => {
  const mergedAdapters = params.mergedConfig?.adapters as Record<string, unknown> | undefined
  const mergedModels = params.mergedConfig?.models
  const mergedModelServices = params.mergedConfig?.modelServices ?? {}
  const serviceModels = listServiceModels(mergedModelServices)
  const mergedDefaultModelService = pickFirstNonEmptyString([params.mergedConfig?.defaultModelService])
  const mergedDefaultAdapter = pickFirstNonEmptyString([params.mergedConfig?.defaultAdapter])
  const availableAdapters = resolveRunnableAdapterKeys([
    ...Object.keys(mergedAdapters ?? {}),
    mergedDefaultAdapter
  ])
  const explicitAdapterInput = normalizeNonEmptyString(params.inputAdapter)
  const adapterPrefixedModelSelection = explicitAdapterInput == null
    ? parseAdapterPrefixedModelSelection(params.inputModel, availableAdapters)
    : undefined
  const explicitAdapter = explicitAdapterInput ?? adapterPrefixedModelSelection?.adapter
  const explicitModel = resolveModelSelection({
    value: adapterPrefixedModelSelection?.model ?? params.inputModel,
    serviceModels,
    preferredServiceKey: mergedDefaultModelService,
    preserveUnknown: true
  })
  const mergedDefaultModel = pickFirstNonEmptyString([params.mergedConfig?.defaultModel])
  const resolvedDefaultModel = resolveDefaultModelSelection({
    defaultModel: mergedDefaultModel,
    defaultModelService: mergedDefaultModelService,
    serviceModels,
    preserveUnknownDefaultModel: true
  })

  const resolveAdapterFallback = () => explicitAdapter ?? mergedDefaultAdapter ?? availableAdapters[0]

  const resolveAdapterForModel = (model: string) => (
    explicitAdapter ??
      resolveModelDefaultAdapter({
        model,
        models: mergedModels
      }) ??
      mergedDefaultAdapter ??
      availableAdapters[0]
  )

  const resolveModelForAdapter = (adapter: string | undefined) => {
    const adapterCommonConfig = adapter == null
      ? undefined
      : resolveAdapterCommonConfig(adapter, {
        mergedConfig: params.mergedConfig as AdapterCtx['configs'][0]
      })
    const adapterConfiguredModel = resolveAdapterConfiguredDefaultModel({
      adapterConfig: adapterCommonConfig,
      serviceModels,
      preferredServiceKey: mergedDefaultModelService,
      preserveUnknown: true
    })
    return adapterConfiguredModel ?? resolvedDefaultModel
  }

  if (explicitModel != null) {
    return {
      adapter: resolveAdapterForModel(explicitModel),
      model: explicitModel
    }
  }

  if (explicitAdapter != null) {
    return {
      adapter: explicitAdapter,
      model: resolveModelForAdapter(explicitAdapter)
    }
  }

  if (resolvedDefaultModel != null) {
    return {
      adapter: resolveAdapterForModel(resolvedDefaultModel),
      model: resolvedDefaultModel
    }
  }

  const adapter = resolveAdapterFallback()
  return {
    adapter,
    model: resolveModelForAdapter(adapter)
  }
}
