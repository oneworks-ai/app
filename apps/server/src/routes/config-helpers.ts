import { buildConfigSections } from '@oneworks/config'
import type { AdapterBuiltinModel, Config } from '@oneworks/types'
import { loadAdapterBuiltinModels as loadAdapterPackageBuiltinModels } from '@oneworks/types'
import { BUILTIN_NATIVE_ADAPTERS, normalizeNonEmptyString } from '@oneworks/utils/model-selection'

import { getServerAppInfo } from '#~/utils/app-info.js'

const sanitize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(item => sanitize(item))
  }
  if (value != null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    return entries.reduce<Record<string, unknown>>((acc, [key, val]) => {
      acc[key] = sanitize(val)
      return acc
    }, {})
  }
  return value
}

export const buildSections = (config: Config | undefined) => {
  const sections = sanitize(buildConfigSections(config)) as ReturnType<typeof buildConfigSections>

  return {
    ...sections,
    adapterBuiltinModels: {} as Record<string, AdapterBuiltinModel[]>
  }
}

export const loadAdapterBuiltinModels = (
  config: Config
): Record<string, AdapterBuiltinModel[]> => {
  const result: Record<string, AdapterBuiltinModel[]> = {}
  const adapterKeys = Array.from(
    new Set(
      [
        ...BUILTIN_NATIVE_ADAPTERS,
        ...Object.keys(config.adapters ?? {}),
        config.defaultAdapter
      ]
        .map(item => normalizeNonEmptyString(item))
        .filter((item): item is string => Boolean(item))
    )
  )
  for (const adapterKey of adapterKeys) {
    try {
      const builtinModels = loadAdapterPackageBuiltinModels(adapterKey)
      if (Array.isArray(builtinModels)) {
        result[adapterKey] = builtinModels
      }
    } catch {
      // Adapter does not export builtin models, skip.
    }
  }
  return result
}

export const buildConfigAbout = async () => {
  const appInfo = await getServerAppInfo()
  return {
    version: appInfo.version,
    lastReleaseAt: appInfo.lastReleaseAt,
    urls: {
      repo: 'https://github.com/oneworks-ai/app',
      docs: 'https://github.com/oneworks-ai/app',
      contact: 'https://github.com/oneworks-ai/app',
      issues: 'https://github.com/oneworks-ai/app/issues',
      releases: 'https://github.com/oneworks-ai/app/releases'
    }
  }
}
