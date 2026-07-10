import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import useSWR from 'swr'

import type { AdapterBuiltinModel, ConfigResponse, EffortLevel, ModelMetadataConfig } from '@oneworks/types'
import { resolveEffectiveEffort } from '@oneworks/utils/model-selection'

import { getConfig } from '#~/api.js'

import { resolveAdapterModelRuntimeCapabilities } from './model-runtime-capabilities'

export type ChatEffort = 'default' | EffortLevel
export type ExplicitChatEffort = EffortLevel

const EFFORT_STORAGE_KEY = 'oneworks_chat_effort'
const FALLBACK_CHAT_EFFORT: ExplicitChatEffort = 'medium'

export const CHAT_EFFORT_OPTIONS = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '超高' },
  { value: 'max', label: '最高' },
  { value: 'ultra', label: 'Ultra' }
] as const satisfies ReadonlyArray<{ value: ExplicitChatEffort; label: string }>

type EffortSelectionSource = 'configured' | 'fallback' | 'session' | 'stored' | 'user'

interface EffortSelection {
  effort: ExplicitChatEffort
  source: EffortSelectionSource
}

export const isExplicitChatEffort = (value: unknown): value is ExplicitChatEffort => {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' ||
    value === 'max' || value === 'ultra'
}

export const isChatEffort = (value: string): value is ChatEffort => {
  return value === 'default' || isExplicitChatEffort(value)
}

export const resolvePreferredChatEffort = ({
  configuredEffort,
  fallbackEffort = FALLBACK_CHAT_EFFORT,
  storedEffort,
  supportedEfforts
}: {
  configuredEffort?: unknown
  fallbackEffort?: ExplicitChatEffort
  storedEffort?: unknown
  supportedEfforts?: readonly ExplicitChatEffort[]
}): ExplicitChatEffort => {
  const isSupported = (value: unknown): value is ExplicitChatEffort => (
    isExplicitChatEffort(value) && (supportedEfforts == null || supportedEfforts.includes(value))
  )
  if (isSupported(storedEffort)) {
    return storedEffort
  }
  if (isSupported(configuredEffort)) {
    return configuredEffort
  }
  if (isSupported(fallbackEffort)) {
    return fallbackEffort
  }
  return supportedEfforts?.[0] ?? FALLBACK_CHAT_EFFORT
}

const readStoredEffort = (): ExplicitChatEffort | undefined => {
  try {
    const raw = localStorage.getItem(EFFORT_STORAGE_KEY)
    return isExplicitChatEffort(raw) ? raw : undefined
  } catch {
    return undefined
  }
}

const writeStoredEffort = (effort: ExplicitChatEffort) => {
  try {
    localStorage.setItem(EFFORT_STORAGE_KEY, effort)
  } catch {
    // In-memory selection still works when storage is unavailable.
  }
}

const getFallbackSelection = (
  configuredEffort: ExplicitChatEffort,
  configReady: boolean,
  supportedEfforts: readonly ExplicitChatEffort[]
): EffortSelection => {
  const storedEffort = readStoredEffort()
  return {
    effort: resolvePreferredChatEffort({ configuredEffort, storedEffort, supportedEfforts }),
    source: storedEffort != null ? 'stored' : configReady ? 'configured' : 'fallback'
  }
}

export function useChatEffort({
  adapter,
  model
}: {
  adapter?: string
  model?: string
} = {}) {
  const { data: configRes } = useSWR<ConfigResponse>('/api/config', getConfig)
  const modelCapabilities = useMemo(() => {
    const adapterBuiltinModels = configRes?.sources?.merged?.adapterBuiltinModels as
      | Record<string, AdapterBuiltinModel[]>
      | undefined
    return resolveAdapterModelRuntimeCapabilities({
      adapter,
      adapterBuiltinModels,
      model
    })
  }, [adapter, configRes?.sources?.merged?.adapterBuiltinModels, model])
  const supportedEfforts = modelCapabilities.supportedEfforts
  const configuredEffort = useMemo<ExplicitChatEffort>(() => {
    const mergedConfig = configRes?.sources?.merged
    const adapters = (mergedConfig?.adapters ?? {}) as Record<string, unknown>
    const models = (mergedConfig?.models ?? {}) as Record<string, ModelMetadataConfig>
    const resolvedEffort = resolveEffectiveEffort({
      model,
      adapterConfig: adapter == null ? undefined : adapters[adapter],
      configEffort: mergedConfig?.general?.effort,
      models
    }).effort
    return resolvePreferredChatEffort({
      configuredEffort: resolvedEffort,
      fallbackEffort: modelCapabilities.defaultEffort ?? FALLBACK_CHAT_EFFORT,
      supportedEfforts
    })
  }, [adapter, configRes?.sources?.merged, model, modelCapabilities.defaultEffort, supportedEfforts])
  const [selection, setSelection] = useState<EffortSelection>(() => {
    const storedEffort = readStoredEffort()
    return {
      effort: resolvePreferredChatEffort({ storedEffort }),
      source: storedEffort == null ? 'fallback' : 'stored'
    }
  })

  useEffect(() => {
    if (configRes == null) {
      return
    }

    setSelection((current) => {
      if (!supportedEfforts.includes(current.effort)) {
        return { effort: configuredEffort, source: 'configured' }
      }
      if (current.source !== 'fallback' && current.source !== 'configured') {
        return current
      }
      if (current.source === 'configured' && current.effort === configuredEffort) {
        return current
      }
      return { effort: configuredEffort, source: 'configured' }
    })
  }, [configRes, configuredEffort, supportedEfforts])

  const setEffort = useCallback((value?: string) => {
    if (!isExplicitChatEffort(value)) {
      setSelection(getFallbackSelection(configuredEffort, configRes != null, supportedEfforts))
      return
    }

    if (!supportedEfforts.includes(value)) return

    writeStoredEffort(value)
    setSelection({ effort: value, source: 'user' })
  }, [configRes, configuredEffort, supportedEfforts])

  const applySessionEffort = useCallback((value?: string) => {
    if (isExplicitChatEffort(value) && supportedEfforts.includes(value)) {
      setSelection({ effort: value, source: 'session' })
      return
    }

    setSelection(getFallbackSelection(configuredEffort, configRes != null, supportedEfforts))
  }, [configRes, configuredEffort, supportedEfforts])

  const effortOptions = useMemo<Array<{ value: ChatEffort; label: ReactNode }>>(() => [
    ...CHAT_EFFORT_OPTIONS.filter(option => supportedEfforts.includes(option.value))
  ], [supportedEfforts])

  return {
    applySessionEffort,
    effort: selection.effort,
    setEffort,
    effortOptions
  }
}
