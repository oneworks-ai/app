import React, { createElement, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import type {
  AdapterBuiltinModel,
  ConfigResponse,
  ModelMetadataConfig,
  ModelServiceConfig,
  RecommendedModelConfig
} from '@oneworks/types'

import { getConfig, updateConfig } from '#~/api.js'
import { ModelSelectOptionLabel } from '#~/components/chat/sender/@components/model-select/ModelSelectOptionLabel'
import { useResolvedThemeMode } from '#~/hooks/use-resolved-theme-mode'
import { getAdapterDisplay, resolveAdapterDisplayIcon } from '#~/resources/adapters.js'
import {
  BUILTIN_NATIVE_ADAPTERS,
  DEFAULT_NATIVE_ADAPTER,
  filterServiceModelsForAdapter,
  hasRunnableChatModelSelection,
  isBuiltinNativeAdapter,
  listServiceModels,
  normalizeNonEmptyString,
  resolveAdapterForChatModelSelection,
  resolveAdapterModelCompatibility,
  resolveChatAdapterSelection,
  resolveChatModelSelection,
  resolveDefaultChatModelSelection,
  resolveModelForChatAdapterSelection,
  resolveSelectableAdapterKeys
} from './model-selector'
import { buildModelSelectorData } from './model-selector-data'
import type { ModelSelectGroupData, ModelSelectOptionData } from './model-selector-data'
import {
  buildRecommendedModelKey,
  buildUpdatedUserGeneralSection,
  isModelSelectorRecommendation,
  toggleModelSelectorRecommendation
} from './model-selector-recommendations'

export interface ModelSelectOption extends ModelSelectOptionData {
  canToggleRecommendation: boolean
  isRecommended: boolean
  isUserRecommended: boolean
  label: React.ReactNode
}

export interface ModelSelectGroup {
  key: string
  label: React.ReactNode
  options: ModelSelectOption[]
}

export interface ModelSelectMenuGroup extends Omit<ModelSelectGroupData, 'options'> {
  options: ModelSelectOption[]
}

export interface ChatAdapterSelectOption {
  displayLabel: React.ReactNode
  kind: 'builtin' | 'configured'
  label: React.ReactNode
  searchText: string
  value: string
}

export interface HiddenBuiltinAdapterOption {
  fallbackIcon: string
  iconUrl?: string
  onRestore: () => void
  title: string
  value: string
}

type SelectionDriver = 'adapter' | 'model'

const ADAPTER_STORAGE_KEY = 'oneworks_chat_adapter'
const MODEL_STORAGE_KEY = 'oneworks_chat_selected_model'
const DRIVER_STORAGE_KEY = 'oneworks_chat_selection_driver'
const HIDDEN_BUILTIN_ADAPTERS_STORAGE_KEY = 'oneworks_chat_hidden_builtin_adapters'

const readStorageValue = (key: string) => {
  try {
    const raw = localStorage.getItem(key)
    return raw == null || raw.trim() === '' ? undefined : raw
  } catch {
    return undefined
  }
}

const readSelectionDriver = (): SelectionDriver => {
  const raw = readStorageValue(DRIVER_STORAGE_KEY)
  return raw === 'model' ? 'model' : 'adapter'
}

const readStorageStringArray = (key: string) => {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null || raw.trim() === '') return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return Array.from(
      new Set(
        parsed
          .map(item => normalizeNonEmptyString(item))
          .filter((item): item is string => Boolean(item))
      )
    )
  } catch {
    return []
  }
}

const stopAdapterOptionAction = (event: React.MouseEvent) => {
  event.preventDefault()
  event.stopPropagation()
}

const buildBuiltinModelValues = (models: AdapterBuiltinModel[] | undefined) => (
  Array.isArray(models) ? models.map(model => model.value) : []
)

export function useChatModelAdapterSelection({
  adapterLocked = false
}: {
  adapterLocked?: boolean
} = {}) {
  const { t } = useTranslation()
  const { resolvedThemeMode } = useResolvedThemeMode()
  const [selectedAdapter, setSelectedAdapter] = useState<string | undefined>(() =>
    readStorageValue(ADAPTER_STORAGE_KEY)
  )
  const [selectedModel, setSelectedModel] = useState<string | undefined>(() => readStorageValue(MODEL_STORAGE_KEY))
  const [selectionDriver, setSelectionDriver] = useState<SelectionDriver>(() => readSelectionDriver())
  const [hiddenBuiltinAdapters, setHiddenBuiltinAdapters] = useState<string[]>(() =>
    readStorageStringArray(HIDDEN_BUILTIN_ADAPTERS_STORAGE_KEY)
  )
  const [updatingRecommendedModelValue, setUpdatingRecommendedModelValue] = useState<string | undefined>()
  const { data: configRes, mutate } = useSWR<ConfigResponse>('/api/config', getConfig)

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

  const userRecommendedModels = useMemo(() => {
    const raw = configRes?.sources?.user?.general?.recommendedModels
    if (!Array.isArray(raw)) return []
    return raw.filter((item): item is RecommendedModelConfig => (
      item != null && typeof item === 'object' && typeof item.model === 'string' && item.model.trim() !== ''
    ))
  }, [configRes?.sources?.user?.general?.recommendedModels])

  const userRecommendedModelKeySet = useMemo(() => {
    return new Set(
      userRecommendedModels
        .filter(isModelSelectorRecommendation)
        .map(item =>
          buildRecommendedModelKey({
            model: item.model,
            service: item.service
          })
        )
    )
  }, [userRecommendedModels])

  const mergedRecommendedModelKeySet = useMemo(() => {
    return new Set(
      recommendedModels
        .filter(isModelSelectorRecommendation)
        .map(item =>
          buildRecommendedModelKey({
            model: item.model,
            service: item.service
          })
        )
    )
  }, [recommendedModels])

  const adapterBuiltinModels = useMemo(() => {
    return (configRes?.sources?.merged?.adapterBuiltinModels ?? {}) as Record<string, AdapterBuiltinModel[]>
  }, [configRes?.sources?.merged?.adapterBuiltinModels])

  const defaultAdapter = normalizeNonEmptyString(configRes?.sources?.merged?.general?.defaultAdapter)
  const defaultModelService = normalizeNonEmptyString(configRes?.sources?.merged?.general?.defaultModelService)
  const defaultModel = normalizeNonEmptyString(configRes?.sources?.merged?.general?.defaultModel)

  const allServiceModels = useMemo(() => listServiceModels(mergedModelServices), [mergedModelServices])
  const visibleHiddenBuiltinAdapters = adapterLocked ? [] : hiddenBuiltinAdapters
  const availableAdapters = useMemo(() => (
    resolveSelectableAdapterKeys({
      builtinAdapters: BUILTIN_NATIVE_ADAPTERS,
      configuredAdapters: Object.keys(mergedAdapters),
      defaultAdapter,
      hiddenBuiltinAdapters: visibleHiddenBuiltinAdapters
    })
  ), [defaultAdapter, mergedAdapters, visibleHiddenBuiltinAdapters])
  const availableAdapterSet = useMemo(() => new Set(availableAdapters), [availableAdapters])
  const allBuiltinModelValues = useMemo(() => (
    Object.values(adapterBuiltinModels).flatMap(models => buildBuiltinModelValues(models))
  ), [adapterBuiltinModels])
  const activeBuiltinModels = useMemo(() => {
    if (selectedAdapter && adapterBuiltinModels[selectedAdapter]) {
      return { [selectedAdapter]: adapterBuiltinModels[selectedAdapter] }
    }
    if (selectedAdapter != null) {
      return {}
    }
    return adapterBuiltinModels
  }, [adapterBuiltinModels, selectedAdapter])
  const activeBuiltinModelValues = useMemo(() => (
    Object.values(activeBuiltinModels).flatMap(models => buildBuiltinModelValues(models))
  ), [activeBuiltinModels])

  const resolveAdapterValue = useCallback((value?: string) => {
    return resolveChatAdapterSelection({
      value,
      availableAdapters,
      defaultAdapter
    })
  }, [availableAdapters, defaultAdapter])

  const getServiceModelsForAdapter = useCallback((adapter?: string) => {
    return filterServiceModelsForAdapter({
      adapter,
      modelServices: mergedModelServices,
      models: mergedModels,
      serviceModels: allServiceModels
    })
  }, [allServiceModels, mergedModelServices, mergedModels])

  const activeServiceAdapter = resolveAdapterValue(selectedAdapter)
  const availableServiceModels = useMemo(() => (
    getServiceModelsForAdapter(activeServiceAdapter)
  ), [activeServiceAdapter, getServiceModelsForAdapter])
  const hasAvailableModels = useMemo(() => (
    hasRunnableChatModelSelection({
      availableAdapters,
      builtinModels: activeBuiltinModelValues,
      serviceModels: availableServiceModels
    })
  ), [activeBuiltinModelValues, availableAdapters, availableServiceModels])

  const isModelAvailableForAdapter = useCallback((model: string | undefined, adapter: string | undefined) => {
    return resolveChatModelSelection({
      value: model,
      builtinModels: buildBuiltinModelValues(adapter != null ? adapterBuiltinModels[adapter] : undefined),
      serviceModels: getServiceModelsForAdapter(adapter),
      defaultModelService
    }) != null
  }, [adapterBuiltinModels, defaultModelService, getServiceModelsForAdapter])

  const resolveSelectableModel = useCallback(
    (value?: string, builtinModels?: Iterable<string>, preserveUnknown = false) => {
      return resolveChatModelSelection({
        value,
        builtinModels,
        serviceModels: availableServiceModels,
        defaultModelService,
        preserveUnknown
      })
    },
    [availableServiceModels, defaultModelService]
  )

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

  const resolveCompatibleModelForAdapter = useCallback((adapter: string | undefined, model: string | undefined) => {
    if (!adapter || !model) return model

    const compatibility = resolveAdapterModelCompatibility({
      adapter,
      model,
      adapterConfig: mergedAdapters[adapter],
      builtinModels: buildBuiltinModelValues(adapterBuiltinModels[adapter]),
      serviceModels: getServiceModelsForAdapter(adapter),
      preferredServiceKey: defaultModelService,
      preserveUnknownDefaultModel: false
    })

    return compatibility.model ?? model
  }, [
    adapterBuiltinModels,
    defaultModelService,
    getServiceModelsForAdapter,
    mergedAdapters
  ])

  const resolveAdapterForModel = useCallback((model?: string) => {
    const currentAdapter = resolveAdapterValue(selectedAdapter)
    if (isModelAvailableForAdapter(model, currentAdapter)) return currentAdapter

    return resolveAdapterForChatModelSelection({
      model,
      availableAdapters,
      defaultAdapter,
      adapterBuiltinModels,
      modelMetadata: mergedModels
    })
  }, [
    adapterBuiltinModels,
    availableAdapters,
    defaultAdapter,
    isModelAvailableForAdapter,
    mergedModels,
    resolveAdapterValue,
    selectedAdapter
  ])

  const resolvedDefaultModel = useMemo(() => {
    return resolveDefaultChatModelSelection({
      defaultModel,
      defaultModelService,
      builtinModels: allBuiltinModelValues,
      serviceModels: availableServiceModels,
      preserveUnknownDefaultModel: false
    })
  }, [allBuiltinModelValues, availableServiceModels, defaultModel, defaultModelService])

  useEffect(() => {
    if (adapterLocked) return

    if (availableAdapters.length === 0) {
      setSelectedAdapter(undefined)
      if (!hasAvailableModels) setSelectedModel(undefined)
      return
    }

    if (!hasAvailableModels) {
      setSelectedModel(undefined)
      setSelectedAdapter((prev) => resolveAdapterValue(prev))
      return
    }

    if (selectionDriver === 'model') {
      const nextModelCandidate = resolveSelectableModel(selectedModel, allBuiltinModelValues, false) ??
        resolvedDefaultModel
      const nextAdapter = resolveAdapterForModel(nextModelCandidate) ?? resolveAdapterValue(selectedAdapter)
      const nextModel = resolveCompatibleModelForAdapter(nextAdapter, nextModelCandidate)
      setSelectedModel((prev) => prev === nextModel ? prev : nextModel)
      setSelectedAdapter((prev) => prev === nextAdapter ? prev : nextAdapter)
      return
    }

    const nextAdapter = resolveAdapterValue(selectedAdapter)
    const nextModel = resolveModelForAdapter(nextAdapter)
    setSelectedAdapter((prev) => prev === nextAdapter ? prev : nextAdapter)
    setSelectedModel((prev) => prev === nextModel ? prev : nextModel)
  }, [
    adapterLocked,
    allBuiltinModelValues,
    availableAdapters.length,
    hasAvailableModels,
    resolveAdapterForModel,
    resolveCompatibleModelForAdapter,
    resolveAdapterValue,
    resolveModelForAdapter,
    resolveSelectableModel,
    resolvedDefaultModel,
    selectedAdapter,
    selectedModel,
    selectionDriver
  ])

  useEffect(() => {
    try {
      if (selectedAdapter == null || selectedAdapter.trim() === '') {
        localStorage.removeItem(ADAPTER_STORAGE_KEY)
      } else {
        localStorage.setItem(ADAPTER_STORAGE_KEY, selectedAdapter)
      }
    } catch {}
  }, [selectedAdapter])

  useEffect(() => {
    try {
      if (selectedModel == null || selectedModel.trim() === '') {
        localStorage.removeItem(MODEL_STORAGE_KEY)
      } else {
        localStorage.setItem(MODEL_STORAGE_KEY, selectedModel)
      }
    } catch {}
  }, [selectedModel])

  useEffect(() => {
    try {
      localStorage.setItem(DRIVER_STORAGE_KEY, selectionDriver)
    } catch {}
  }, [selectionDriver])

  useEffect(() => {
    try {
      localStorage.setItem(
        HIDDEN_BUILTIN_ADAPTERS_STORAGE_KEY,
        JSON.stringify(hiddenBuiltinAdapters.filter(isBuiltinNativeAdapter))
      )
    } catch {}
  }, [hiddenBuiltinAdapters])

  const setBuiltinAdapterHidden = useCallback((adapter: string, hidden: boolean) => {
    const normalizedAdapter = normalizeNonEmptyString(adapter)
    if (!isBuiltinNativeAdapter(normalizedAdapter)) return

    setHiddenBuiltinAdapters((current) => {
      const currentSet = new Set(current.filter(isBuiltinNativeAdapter))
      if (hidden) {
        currentSet.add(normalizedAdapter)
      } else {
        currentSet.delete(normalizedAdapter)
      }
      return Array.from(currentSet)
    })
  }, [])

  const updateSelectedModel = useCallback((value?: string) => {
    const builtinModels = adapterLocked
      ? buildBuiltinModelValues(selectedAdapter != null ? adapterBuiltinModels[selectedAdapter] : undefined)
      : allBuiltinModelValues
    const nextModel = resolveSelectableModel(value, builtinModels, false)
    if (!nextModel) return

    setSelectionDriver('model')
    const nextAdapter = adapterLocked
      ? selectedAdapter
      : (resolveAdapterForModel(nextModel) ?? resolveAdapterValue(selectedAdapter))
    const resolvedNextModel = resolveCompatibleModelForAdapter(nextAdapter, nextModel)
    setSelectedModel((prev) => prev === resolvedNextModel ? prev : resolvedNextModel)

    if (adapterLocked) return

    setSelectedAdapter((prev) => prev === nextAdapter ? prev : nextAdapter)
  }, [
    adapterBuiltinModels,
    adapterLocked,
    allBuiltinModelValues,
    resolveCompatibleModelForAdapter,
    resolveAdapterForModel,
    resolveAdapterValue,
    resolveSelectableModel,
    selectedAdapter
  ])

  const updateSelectedAdapter = useCallback((value?: string) => {
    const nextAdapter = resolveAdapterValue(value)
    setSelectionDriver('adapter')
    setSelectedAdapter((prev) => prev === nextAdapter ? prev : nextAdapter)

    if (adapterLocked) return

    const nextModel = resolveModelForAdapter(nextAdapter)
    setSelectedModel((prev) => prev === nextModel ? prev : nextModel)
  }, [adapterLocked, resolveAdapterValue, resolveModelForAdapter])

  const applySessionSelection = useCallback((params: { model?: string; adapter?: string }) => {
    const nextAdapter = normalizeNonEmptyString(params.adapter) ?? resolveAdapterValue(undefined)
    const sessionBuiltinModels = buildBuiltinModelValues(
      nextAdapter != null ? adapterBuiltinModels[nextAdapter] : undefined
    )
    const nextModel = resolveSelectableModel(params.model, sessionBuiltinModels, true) ??
      resolveSelectableModel(params.model, allBuiltinModelValues, true) ??
      normalizeNonEmptyString(params.model) ??
      resolveModelForAdapter(nextAdapter)

    setSelectedAdapter((prev) => prev === nextAdapter ? prev : nextAdapter)
    setSelectedModel((prev) => prev === nextModel ? prev : nextModel)
  }, [
    adapterBuiltinModels,
    allBuiltinModelValues,
    resolveAdapterValue,
    resolveModelForAdapter,
    resolveSelectableModel
  ])

  const selectedModelWithService = useMemo(() => (
    resolveSelectableModel(selectedModel, activeBuiltinModelValues, true) ?? selectedModel
  ), [activeBuiltinModelValues, resolveSelectableModel, selectedModel])

  const adapterOptions = useMemo<ChatAdapterSelectOption[]>(() => {
    const visibleBuiltinAdapterCount = availableAdapters.filter(isBuiltinNativeAdapter).length
    const visibleCustomAdapterCount = availableAdapters.length - visibleBuiltinAdapterCount
    const canHideAnotherBuiltinAdapter = visibleBuiltinAdapterCount + visibleCustomAdapterCount > 1

    return availableAdapters.map((key) => {
      const display = getAdapterDisplay(key)
      const displayIcon = resolveAdapterDisplayIcon(display, resolvedThemeMode)
      const isBuiltin = isBuiltinNativeAdapter(key)
      const kind = isBuiltin ? 'builtin' : 'configured'
      const iconNode = displayIcon != null
        ? createElement('img', {
          key: 'icon',
          className: 'adapter-option__icon',
          src: displayIcon,
          alt: '',
          'aria-hidden': true
        })
        : createElement('span', {
          key: 'fallback-icon',
          className: 'adapter-option__icon adapter-option__icon--fallback material-symbols-rounded',
          'aria-hidden': true
        }, 'deployed_code')
      const displayLabel = createElement('span', { className: 'adapter-option adapter-option--display' }, [
        iconNode,
        createElement('span', { key: 'text', className: 'adapter-option__text' }, display.title)
      ])
      const hideDisabled = !canHideAnotherBuiltinAdapter

      return {
        displayLabel,
        kind,
        value: key,
        searchText: `${key} ${display.title}`,
        label: createElement('div', {
          className: [
            'adapter-option',
            'adapter-option--menu',
            `adapter-option--${kind}`
          ].join(' ')
        }, [
          createElement('span', { key: 'main', className: 'adapter-option__main' }, [
            iconNode,
            createElement('span', { key: 'copy', className: 'adapter-option__copy' }, [
              createElement('span', { key: 'text', className: 'adapter-option__text' }, display.title)
            ])
          ]),
          ...(isBuiltin
            ? [
              createElement(
                'button',
                {
                  key: 'hide',
                  type: 'button',
                  className: 'adapter-option__visibility-button',
                  'aria-label': t('chat.adapterHideBuiltin', { adapter: display.title }),
                  title: hideDisabled
                    ? t('chat.adapterHideLastBuiltinDisabled')
                    : t('chat.adapterHideBuiltin', { adapter: display.title }),
                  disabled: hideDisabled,
                  onMouseDown: stopAdapterOptionAction,
                  onClick: (event: React.MouseEvent) => {
                    stopAdapterOptionAction(event)
                    if (hideDisabled) return
                    setBuiltinAdapterHidden(key, true)
                  }
                },
                createElement('span', {
                  className: 'material-symbols-rounded',
                  'aria-hidden': true
                }, 'visibility_off')
              )
            ]
            : [])
        ])
      }
    })
  }, [availableAdapters, resolvedThemeMode, setBuiltinAdapterHidden, t])

  const hiddenBuiltinAdapterOptions = useMemo<HiddenBuiltinAdapterOption[]>(() => {
    return hiddenBuiltinAdapters
      .filter(isBuiltinNativeAdapter)
      .filter(key => !availableAdapterSet.has(key))
      .map((key) => {
        const display = getAdapterDisplay(key)

        return {
          fallbackIcon: 'deployed_code',
          iconUrl: resolveAdapterDisplayIcon(display, resolvedThemeMode),
          onRestore: () => setBuiltinAdapterHidden(key, false),
          title: display.title,
          value: key
        }
      })
  }, [availableAdapterSet, hiddenBuiltinAdapters, resolvedThemeMode, setBuiltinAdapterHidden, t])

  const toggleRecommendedModel = useCallback(async (option: ModelSelectOption) => {
    const serviceKey = option.serviceKey?.trim()
    const modelName = option.modelName.trim()
    if (
      configRes?.sources == null ||
      !serviceKey ||
      modelName === '' ||
      updatingRecommendedModelValue === option.value
    ) {
      return
    }

    setUpdatingRecommendedModelValue(option.value)

    try {
      const { recommendedModels: nextRecommendedModels } = toggleModelSelectorRecommendation({
        currentRecommendedModels: configRes?.sources?.user?.general?.recommendedModels,
        nextRecommendedModel: {
          service: serviceKey,
          model: modelName,
          placement: 'modelSelector'
        }
      })
      const nextUserGeneralSection = buildUpdatedUserGeneralSection({
        currentGeneral: configRes?.sources?.user?.general,
        recommendedModels: nextRecommendedModels
      })

      await updateConfig('user', 'general', nextUserGeneralSection)
      await mutate()
    } catch (error) {
      console.error('[chat] failed to update recommended models', error)
    } finally {
      setUpdatingRecommendedModelValue(undefined)
    }
  }, [configRes?.sources?.user?.general, mutate, updatingRecommendedModelValue])

  const decorateModelOption = useCallback((option: ModelSelectOptionData): ModelSelectOption => {
    const recommendationKey = option.serviceKey == null
      ? undefined
      : buildRecommendedModelKey({
        model: option.modelName,
        service: option.serviceKey
      })
    const decoratedOption: ModelSelectOption = {
      ...option,
      canToggleRecommendation: option.serviceKey != null && option.modelName.trim() !== '',
      isRecommended: recommendationKey != null && mergedRecommendedModelKeySet.has(recommendationKey),
      isUserRecommended: recommendationKey != null && userRecommendedModelKeySet.has(recommendationKey),
      label: null
    }

    decoratedOption.label = (
      <ModelSelectOptionLabel
        option={decoratedOption}
        onToggleRecommendedModel={toggleRecommendedModel}
        updatingRecommendedModelValue={updatingRecommendedModelValue}
      />
    )

    return decoratedOption
  }, [mergedRecommendedModelKeySet, toggleRecommendedModel, updatingRecommendedModelValue, userRecommendedModelKeySet])

  const modelSelectorData = useMemo(() => {
    return buildModelSelectorData({
      activeBuiltinModels,
      availableServiceModels,
      builtinPreviewAdapter: selectedAdapter ?? defaultAdapter ?? DEFAULT_NATIVE_ADAPTER,
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
    mergedModels,
    mergedModelServices,
    recommendedModels,
    selectedAdapter,
    t
  ])

  const builtinPreviewModelOptions = useMemo<ModelSelectOption[]>(() => {
    return modelSelectorData.builtinPreviewOptions.map(decorateModelOption)
  }, [decorateModelOption, modelSelectorData.builtinPreviewOptions])

  const modelSearchOptions = useMemo<ModelSelectOption[]>(() => {
    return modelSelectorData.searchOptions.map(decorateModelOption)
  }, [decorateModelOption, modelSelectorData.searchOptions])

  const recommendedModelOptions = useMemo<ModelSelectOption[]>(() => {
    return modelSelectorData.recommendedOptions.map(decorateModelOption)
  }, [decorateModelOption, modelSelectorData.recommendedOptions])

  const servicePreviewModelOptions = useMemo<ModelSelectOption[]>(() => {
    return modelSelectorData.servicePreviewOptions.map(decorateModelOption)
  }, [decorateModelOption, modelSelectorData.servicePreviewOptions])

  const modelMenuGroups = useMemo<ModelSelectMenuGroup[]>(() => {
    return modelSelectorData.moreModelGroups.map(group => ({
      ...group,
      options: group.options.map(decorateModelOption)
    }))
  }, [decorateModelOption, modelSelectorData.moreModelGroups])

  const modelOptions = useMemo<ModelSelectGroup[]>(() => {
    return modelSelectorData.flatGroups.map(group => ({
      key: group.key,
      label: (
        <div className='model-group-label'>
          <div className='model-group-title'>{group.title}</div>
          {group.description && <div className='model-group-desc'>{group.description}</div>}
        </div>
      ),
      options: group.options.map(decorateModelOption)
    }))
  }, [decorateModelOption, modelSelectorData.flatGroups])

  return {
    adapterOptions,
    applySessionSelection,
    hasAvailableModels,
    hiddenBuiltinAdapterOptions,
    builtinPreviewModelOptions,
    modelMenuGroups,
    modelOptions,
    modelSearchOptions,
    recommendedModelOptions,
    servicePreviewModelOptions,
    selectedAdapter,
    selectedModel,
    selectedModelWithService,
    setSelectedAdapter: updateSelectedAdapter,
    setSelectedModel: updateSelectedModel,
    toggleRecommendedModel,
    updatingRecommendedModelValue
  }
}
