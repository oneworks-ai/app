/* eslint-disable max-lines -- sender option assembly keeps config/default resolution in one hook */
import { createElement, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import type {
  AdapterBuiltinModel,
  ConfigResponse,
  ModelMetadataConfig,
  ModelServiceConfig,
  RecommendedModelConfig
} from '@oneworks/types'
import { resolveEffectiveEffort } from '@oneworks/utils/model-selection'

import { getConfig } from '#~/api.js'
import {
  BUILTIN_NATIVE_ADAPTERS,
  DEFAULT_NATIVE_ADAPTER,
  filterServiceModelsForAdapter,
  isBuiltinNativeAdapter,
  listServiceModels,
  normalizeNonEmptyString,
  resolveAdapterModelCompatibility,
  resolveChatAdapterSelection,
  resolveChatModelSelection,
  resolveDefaultChatModelSelection,
  resolveModelForChatAdapterSelection,
  resolveSelectableAdapterKeys
} from '#~/hooks/chat/model-selector'
import { buildModelSelectorData } from '#~/hooks/chat/model-selector-data'
import type { ChatEffort } from '#~/hooks/chat/use-chat-effort'
import type {
  ChatAdapterSelectOption,
  ModelSelectMenuGroup,
  ModelSelectOption
} from '#~/hooks/chat/use-chat-model-adapter-selection'
import { getAdapterDisplay } from '#~/resources/adapters.js'
import { decorateAutomationSenderModelOption, mapAutomationSenderModelMenuGroups } from '../@utils/sender-model-options'

interface AutomationSenderAdapterOption extends ChatAdapterSelectOption {}

const buildBuiltinModelValues = (models: AdapterBuiltinModel[] | undefined) => (
  Array.isArray(models) ? models.map(model => model.value) : []
)

const normalizeChatEffort = (value: unknown): ChatEffort => (
  value === 'low' || value === 'medium' || value === 'high' || value === 'max' ? value : 'default'
)

export function useAutomationStartupOptionsData({
  selectedAdapter,
  selectedEffort,
  selectedModel
}: {
  selectedAdapter?: string
  selectedEffort?: ChatEffort
  selectedModel?: string
}) {
  const { t } = useTranslation()
  const { data: configRes } = useSWR<ConfigResponse>('/api/config', getConfig)

  const mergedAdapters = useMemo(() => {
    return (configRes?.sources?.merged?.adapters ?? {}) as Record<string, unknown>
  }, [configRes?.sources?.merged?.adapters])

  const mergedModels = useMemo(() => {
    return (configRes?.sources?.merged?.models ?? {}) as Record<string, ModelMetadataConfig>
  }, [configRes?.sources?.merged?.models])

  const mergedModelServices = useMemo(() => {
    return (configRes?.sources?.merged?.modelServices ?? {}) as Record<string, ModelServiceConfig>
  }, [configRes?.sources?.merged?.modelServices])

  const recommendedModels = useMemo(() => {
    const raw = configRes?.sources?.merged?.general?.recommendedModels
    if (!Array.isArray(raw)) return []
    return raw.filter((item): item is RecommendedModelConfig => (
      item != null && typeof item === 'object' && typeof item.model === 'string' && item.model.trim() !== ''
    ))
  }, [configRes?.sources?.merged?.general?.recommendedModels])

  const adapterBuiltinModels = useMemo(() => {
    return (configRes?.sources?.merged?.adapterBuiltinModels ?? {}) as Record<string, AdapterBuiltinModel[]>
  }, [configRes?.sources?.merged?.adapterBuiltinModels])

  const defaultAdapter = normalizeNonEmptyString(configRes?.sources?.merged?.general?.defaultAdapter)
  const defaultModel = normalizeNonEmptyString(configRes?.sources?.merged?.general?.defaultModel)
  const normalizedSelectedAdapter = normalizeNonEmptyString(selectedAdapter)
  const normalizedSelectedModel = normalizeNonEmptyString(selectedModel)
  const availableAdapters = useMemo(() => (
    resolveSelectableAdapterKeys({
      builtinAdapters: BUILTIN_NATIVE_ADAPTERS,
      configuredAdapters: Object.keys(mergedAdapters),
      defaultAdapter
    })
  ), [defaultAdapter, mergedAdapters])
  const allBuiltinModelValues = useMemo(() => (
    Object.values(adapterBuiltinModels).flatMap(models => buildBuiltinModelValues(models))
  ), [adapterBuiltinModels])
  const allServiceModels = useMemo(() => listServiceModels(mergedModelServices), [mergedModelServices])
  const defaultModelService = normalizeNonEmptyString(configRes?.sources?.merged?.general?.defaultModelService)

  const resolveAdapterValue = useCallback((value?: string) => (
    resolveChatAdapterSelection({
      value,
      availableAdapters,
      defaultAdapter
    })
  ), [availableAdapters, defaultAdapter])

  const effectiveAdapter = useMemo(() => (
    normalizedSelectedAdapter ?? resolveAdapterValue(undefined)
  ), [normalizedSelectedAdapter, resolveAdapterValue])
  const getServiceModelsForAdapter = useCallback((adapter?: string) => (
    filterServiceModelsForAdapter({
      adapter,
      modelServices: mergedModelServices,
      models: mergedModels,
      serviceModels: allServiceModels
    })
  ), [allServiceModels, mergedModelServices, mergedModels])
  const availableServiceModels = useMemo(() => (
    getServiceModelsForAdapter(effectiveAdapter)
  ), [effectiveAdapter, getServiceModelsForAdapter])

  const activeBuiltinModels = useMemo(() => {
    if (effectiveAdapter != null && adapterBuiltinModels[effectiveAdapter] != null) {
      return { [effectiveAdapter]: adapterBuiltinModels[effectiveAdapter] }
    }
    if (effectiveAdapter != null) {
      return {}
    }
    return adapterBuiltinModels
  }, [adapterBuiltinModels, effectiveAdapter])
  const activeBuiltinModelValues = useMemo(() => (
    Object.values(activeBuiltinModels).flatMap(models => buildBuiltinModelValues(models))
  ), [activeBuiltinModels])

  const resolvedDefaultModel = useMemo(() => (
    resolveDefaultChatModelSelection({
      defaultModel,
      defaultModelService,
      builtinModels: allBuiltinModelValues,
      serviceModels: availableServiceModels,
      preserveUnknownDefaultModel: false
    })
  ), [allBuiltinModelValues, availableServiceModels, defaultModel, defaultModelService])

  const resolveModelForAdapter = useCallback((adapter?: string) => {
    const builtinModels = buildBuiltinModelValues(
      adapter != null ? adapterBuiltinModels[adapter] : undefined
    )
    const serviceModels = getServiceModelsForAdapter(adapter)
    const resolvedModel = resolveModelForChatAdapterSelection({
      adapter,
      adapters: mergedAdapters,
      defaultModel,
      defaultModelService,
      builtinModels,
      fallbackBuiltinModels: allBuiltinModelValues,
      serviceModels
    })
    if (!adapter || !resolvedModel) return resolvedModel

    const compatibility = resolveAdapterModelCompatibility({
      adapter,
      model: resolvedModel,
      adapterConfig: mergedAdapters[adapter],
      builtinModels,
      serviceModels,
      preferredServiceKey: defaultModelService,
      preserveUnknownDefaultModel: false
    })
    return compatibility.model ?? resolvedModel
  }, [
    adapterBuiltinModels,
    allBuiltinModelValues,
    defaultModel,
    defaultModelService,
    getServiceModelsForAdapter,
    mergedAdapters
  ])

  const effectiveModel = useMemo(() => {
    if (normalizedSelectedModel != null) {
      return resolveChatModelSelection({
        value: normalizedSelectedModel,
        builtinModels: activeBuiltinModelValues,
        serviceModels: availableServiceModels,
        defaultModelService,
        preserveUnknown: true
      }) ?? normalizedSelectedModel
    }

    return resolveModelForAdapter(effectiveAdapter) ?? resolvedDefaultModel
  }, [
    activeBuiltinModelValues,
    availableServiceModels,
    defaultModelService,
    effectiveAdapter,
    normalizedSelectedModel,
    resolveModelForAdapter,
    resolvedDefaultModel
  ])

  const effectiveEffort = useMemo<ChatEffort>(() => {
    if (selectedEffort != null && selectedEffort !== 'default') {
      return selectedEffort
    }

    return normalizeChatEffort(
      resolveEffectiveEffort({
        model: effectiveModel,
        adapterConfig: effectiveAdapter != null ? mergedAdapters[effectiveAdapter] : undefined,
        configEffort: configRes?.sources?.merged?.general?.effort,
        models: mergedModels
      }).effort
    )
  }, [
    configRes?.sources?.merged?.general?.effort,
    effectiveAdapter,
    effectiveModel,
    mergedAdapters,
    mergedModels,
    selectedEffort
  ])

  const adapterOptions = useMemo<AutomationSenderAdapterOption[]>(() => {
    return availableAdapters.map((key) => {
      const display = getAdapterDisplay(key)
      const isBuiltin = isBuiltinNativeAdapter(key)
      const iconNode = display.icon != null
        ? createElement('img', {
          key: 'icon',
          className: 'automation-view__sender-adapter-icon',
          src: display.icon,
          alt: '',
          'aria-hidden': true
        })
        : createElement('span', {
          key: 'fallback-icon',
          className:
            'automation-view__sender-adapter-icon automation-view__sender-adapter-icon--fallback material-symbols-rounded',
          'aria-hidden': true
        }, 'deployed_code')
      const displayLabel = createElement('span', { className: 'automation-view__sender-adapter-option' }, [
        iconNode,
        createElement('span', { key: 'text' }, display.title)
      ])

      return {
        value: key,
        displayLabel,
        kind: isBuiltin ? 'builtin' : 'configured',
        searchText: `${key} ${display.title}`,
        label: createElement('span', { className: 'automation-view__sender-adapter-option' }, [
          iconNode,
          createElement('span', { key: 'text' }, display.title)
        ])
      }
    })
  }, [availableAdapters])

  const modelSelectorData = useMemo(() => {
    return buildModelSelectorData({
      activeBuiltinModels,
      availableServiceModels,
      builtinPreviewAdapter: effectiveAdapter ?? defaultAdapter ?? DEFAULT_NATIVE_ADAPTER,
      defaultModelService,
      mergedModels,
      mergedModelServices,
      recommendedModels,
      recommendedGroupTitle: t('chat.modelGroupRecommended', { defaultValue: '推荐模型' }),
      servicePreviewGroupTitle: t('chat.modelGroupServices', { defaultValue: '模型服务' }),
      builtinGroupTitle: (adapterKey) =>
        t('chat.modelGroupBuiltin', {
          adapter: adapterKey,
          defaultValue: `${adapterKey} (Default)`
        })
    })
  }, [
    activeBuiltinModels,
    availableServiceModels,
    defaultAdapter,
    defaultModelService,
    effectiveAdapter,
    mergedModels,
    mergedModelServices,
    recommendedModels,
    t
  ])
  const defaultModelLabel = t('automation.defaultModelLabel', { defaultValue: '默认模型' })

  const modelSearchOptions = useMemo<ModelSelectOption[]>(() => (
    modelSelectorData.searchOptions.map(option => decorateAutomationSenderModelOption(option, { defaultModelLabel }))
  ), [defaultModelLabel, modelSelectorData.searchOptions])

  const builtinPreviewModelOptions = useMemo<ModelSelectOption[]>(() => (
    modelSelectorData.builtinPreviewOptions.map(option =>
      decorateAutomationSenderModelOption(option, { defaultModelLabel })
    )
  ), [defaultModelLabel, modelSelectorData.builtinPreviewOptions])

  const recommendedModelOptions = useMemo<ModelSelectOption[]>(() => (
    modelSelectorData.recommendedOptions.map(option =>
      decorateAutomationSenderModelOption(option, { defaultModelLabel })
    )
  ), [defaultModelLabel, modelSelectorData.recommendedOptions])

  const servicePreviewModelOptions = useMemo<ModelSelectOption[]>(() => (
    modelSelectorData.servicePreviewOptions.map(option =>
      decorateAutomationSenderModelOption(option, { defaultModelLabel })
    )
  ), [defaultModelLabel, modelSelectorData.servicePreviewOptions])

  const modelMenuGroups = useMemo<ModelSelectMenuGroup[]>(() => (
    mapAutomationSenderModelMenuGroups(modelSelectorData.moreModelGroups, { defaultModelLabel })
  ), [defaultModelLabel, modelSelectorData.moreModelGroups])

  return {
    adapterOptions,
    effectiveAdapter,
    effectiveEffort,
    effectiveModel,
    builtinPreviewModelOptions,
    modelMenuGroups,
    modelSearchOptions,
    recommendedModelOptions,
    servicePreviewModelOptions
  }
}
