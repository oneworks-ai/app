/* eslint-disable max-lines -- generic adapter validation and additions-only persistence share one boundary. */
import process from 'node:process'

import { updateConfigFile } from '@oneworks/config'
import { modelServiceConfigSchema } from '@oneworks/core/config-schema'
import type {
  AdapterModelProviderImportSource,
  AdapterModelProviderImporterDescriptor,
  AdapterRuntimeTarget,
  ModelServiceConfig
} from '@oneworks/types'
import { tryLoadAdapterModelProviderImportCapability } from '@oneworks/types'
import { mergeProcessEnvWithProjectEnv } from '@oneworks/utils'

import { resolveSelectableAdapterRuntimeTargets } from '#~/services/adapter-imports.js'
import { loadConfigState } from '#~/services/config/index.js'

import { ModelProvidersServiceError } from './errors.js'

type ConfigState = Awaited<ReturnType<typeof loadConfigState>>

const isImportSource = (value: unknown): value is AdapterModelProviderImportSource => (
  value === 'global' || value === 'project' || value === 'user'
)

const resolveImportAdapterTargets = async (state: ConfigState) => {
  return resolveSelectableAdapterRuntimeTargets({
    config: state.mergedConfig,
    workspaceFolder: state.workspaceFolder
  })
}

const selectSourceConfig = (state: ConfigState, source: AdapterModelProviderImportSource) => {
  if (source === 'global') return state.globalSource?.resolvedConfig ?? state.globalSource?.rawConfig
  if (source === 'project') return state.projectSource?.resolvedConfig ?? state.projectSource?.rawConfig
  return state.userSource?.resolvedConfig ?? state.userSource?.rawConfig
}

const isJsonCompatibleValue = (value: unknown, seen = new WeakSet<object>()): boolean => {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      return value.every(item => isJsonCompatibleValue(item, seen))
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    if (Object.getOwnPropertySymbols(value).length > 0) return false
    return Object.entries(Object.getOwnPropertyDescriptors(value)).every(([key, descriptor]) => (
      key !== '__proto__' &&
      key !== 'constructor' &&
      key !== 'prototype' &&
      'value' in descriptor &&
      isJsonCompatibleValue(descriptor.value, seen)
    ))
  } finally {
    seen.delete(value)
  }
}

const asModelServiceDiscovery = (value: unknown) => {
  try {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) return undefined
    const result = value as Record<string, unknown>
    if (
      typeof result.found !== 'boolean' ||
      result.modelServices == null ||
      typeof result.modelServices !== 'object' ||
      Array.isArray(result.modelServices) ||
      !Array.isArray(result.skippedProviderIds) ||
      !result.skippedProviderIds.every(item => typeof item === 'string')
    ) return undefined

    const modelServices: Record<string, ModelServiceConfig> = {}
    for (const [key, service] of Object.entries(result.modelServices as Record<string, unknown>)) {
      if (
        key.trim() === '' ||
        key === '__proto__' ||
        key === 'constructor' ||
        key === 'prototype' ||
        !isJsonCompatibleValue(service)
      ) return undefined
      const parsed = modelServiceConfigSchema.safeParse(service)
      if (!parsed.success || !isJsonCompatibleValue(parsed.data)) return undefined
      modelServices[key] = parsed.data as ModelServiceConfig
    }
    if (!result.found && Object.keys(modelServices).length > 0) return undefined
    return {
      found: result.found,
      modelServices,
      skippedProviderIds: result.skippedProviderIds
    }
  } catch {
    return undefined
  }
}

const loadImportDescriptor = async (
  state: ConfigState,
  target: AdapterRuntimeTarget
): Promise<AdapterModelProviderImporterDescriptor | undefined> => {
  const capability = await tryLoadAdapterModelProviderImportCapability(target.loadSpecifier, {
    cwd: state.workspaceFolder
  })
  if (capability == null) return undefined
  return {
    adapterKey: target.instanceKey,
    ...(capability.descriptor.description == null
      ? {}
      : { description: capability.descriptor.description }),
    runtimeAdapter: target.runtimeAdapter,
    supportedSources: [...capability.descriptor.supportedSources],
    title: capability.descriptor.title
  }
}

const adaptModelServiceForAdapterInstance = (
  service: ModelServiceConfig,
  target: AdapterRuntimeTarget
): ModelServiceConfig => {
  if (target.instanceKey === target.runtimeAdapter) return service
  const expandRuntimeAdapterAlias = (adapters: string[] | undefined) => (
    adapters?.includes(target.runtimeAdapter) === true && !adapters.includes(target.instanceKey)
      ? [...adapters, target.instanceKey]
      : adapters
  )
  const supportedAdapters = expandRuntimeAdapterAlias(service.supportedAdapters)
  const unsupportedAdapters = expandRuntimeAdapterAlias(service.unsupportedAdapters)
  if (
    supportedAdapters === service.supportedAdapters &&
    unsupportedAdapters === service.unsupportedAdapters
  ) return service
  return {
    ...service,
    ...(supportedAdapters == null ? {} : { supportedAdapters }),
    ...(unsupportedAdapters == null ? {} : { unsupportedAdapters })
  }
}

export const listModelServiceImporters = async () => {
  const state = await loadConfigState()
  const targets = await resolveImportAdapterTargets(state)
  const importers = await Promise.all(targets.map(target => loadImportDescriptor(state, target)))
  return {
    importers: importers.filter(
      (item): item is AdapterModelProviderImporterDescriptor => item != null
    )
  }
}

export const importModelServicesFromAdapter = async (params: {
  adapterKey: string
  source: unknown
}) => {
  if (!isImportSource(params.source)) {
    throw new ModelProvidersServiceError(
      'invalid_import_source',
      'Invalid model service import config source.',
      { source: params.source }
    )
  }

  const state = await loadConfigState()
  const target = (await resolveImportAdapterTargets(state)).find(
    item => item.instanceKey === params.adapterKey
  )
  if (target == null) {
    throw new ModelProvidersServiceError(
      'model_service_importer_not_found',
      `Adapter "${params.adapterKey}" is not available for model service import.`,
      { adapterKey: params.adapterKey }
    )
  }

  const capability = await tryLoadAdapterModelProviderImportCapability(target.loadSpecifier, {
    cwd: state.workspaceFolder
  })
  if (capability == null) {
    throw new ModelProvidersServiceError(
      'model_service_importer_not_found',
      `Adapter "${params.adapterKey}" does not support model service import.`,
      { adapterKey: params.adapterKey }
    )
  }
  if (!capability.descriptor.supportedSources.includes(params.source)) {
    throw new ModelProvidersServiceError(
      'invalid_import_source',
      `Adapter "${params.adapterKey}" does not support model service import into this config source.`,
      {
        adapterKey: params.adapterKey,
        source: params.source,
        supportedSources: capability.descriptor.supportedSources
      }
    )
  }

  const sourceConfig = selectSourceConfig(state, params.source)
  const env = mergeProcessEnvWithProjectEnv(process.env, { workspaceFolder: state.workspaceFolder })
  const discovery = asModelServiceDiscovery(
    await capability.discover({
      cwd: state.workspaceFolder,
      env,
      source: params.source
    })
  )
  if (discovery == null) {
    throw new ModelProvidersServiceError(
      'invalid_model_service_import_result',
      `Adapter "${params.adapterKey}" returned an invalid model service import result.`,
      { adapterKey: params.adapterKey }
    )
  }

  const discoveredModelServices = Object.fromEntries(
    Object.entries(discovery.modelServices).map(([key, service]) => [
      key,
      adaptModelServiceForAdapterInstance(service, target)
    ])
  )

  const protectedModelServices = sourceConfig?.modelServices ?? {}
  const candidates = Object.fromEntries(
    Object.entries(discoveredModelServices).filter(([key]) => !Object.hasOwn(protectedModelServices, key))
  )
  let importedServiceKeys: string[] = []
  let persistedModelServices = protectedModelServices

  if (Object.keys(candidates).length > 0) {
    const { updatedConfig } = await updateConfigFile({
      env,
      resolveValue: currentConfig => {
        const currentModelServices = currentConfig.modelServices ?? {}
        const additions = Object.fromEntries(
          Object.entries(candidates).filter(([key]) => !Object.hasOwn(currentModelServices, key))
        )
        importedServiceKeys = Object.keys(additions)
        return { ...additions, ...currentModelServices }
      },
      section: 'modelServices',
      source: params.source,
      workspaceFolder: state.workspaceFolder
    })
    persistedModelServices = {
      ...protectedModelServices,
      ...(updatedConfig.modelServices ?? {})
    }
  }

  const importedKeys = new Set(importedServiceKeys)
  return {
    adapterKey: params.adapterKey,
    existingServiceKeys: Object.keys(discoveredModelServices).filter(key => (
      !importedKeys.has(key) && Object.hasOwn(persistedModelServices, key)
    )),
    found: discovery.found,
    importedServiceKeys,
    providerCount: Object.keys(discoveredModelServices).length,
    skippedProviderIds: discovery.skippedProviderIds,
    source: params.source
  }
}
