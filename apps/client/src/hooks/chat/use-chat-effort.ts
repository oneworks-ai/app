import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import useSWR from 'swr'

import type { ConfigResponse, EffortLevel, ModelMetadataConfig } from '@oneworks/types'
import { resolveEffectiveEffort } from '@oneworks/utils/model-selection'

import { getConfig } from '#~/api.js'

export type ChatEffort = 'default' | EffortLevel
export type ExplicitChatEffort = EffortLevel

const EFFORT_STORAGE_KEY = 'oneworks_chat_effort'
const FALLBACK_CHAT_EFFORT: ExplicitChatEffort = 'medium'

export const CHAT_EFFORT_OPTIONS = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'max', label: '最高' }
] as const satisfies ReadonlyArray<{ value: ExplicitChatEffort; label: string }>

type EffortSelectionSource = 'configured' | 'fallback' | 'session' | 'stored' | 'user'

interface EffortSelection {
  effort: ExplicitChatEffort
  source: EffortSelectionSource
}

export const isExplicitChatEffort = (value: unknown): value is ExplicitChatEffort => {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'max'
}

export const isChatEffort = (value: string): value is ChatEffort => {
  return value === 'default' || isExplicitChatEffort(value)
}

export const resolvePreferredChatEffort = ({
  configuredEffort,
  storedEffort
}: {
  configuredEffort?: unknown
  storedEffort?: unknown
}): ExplicitChatEffort => {
  if (isExplicitChatEffort(storedEffort)) {
    return storedEffort
  }
  if (isExplicitChatEffort(configuredEffort)) {
    return configuredEffort
  }
  return FALLBACK_CHAT_EFFORT
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
  configReady: boolean
): EffortSelection => {
  const storedEffort = readStoredEffort()
  return {
    effort: resolvePreferredChatEffort({ configuredEffort, storedEffort }),
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
  const configuredEffort = useMemo<ExplicitChatEffort>(() => {
    const mergedConfig = configRes?.sources?.merged
    const adapters = (mergedConfig?.adapters ?? {}) as Record<string, unknown>
    const models = (mergedConfig?.models ?? {}) as Record<string, ModelMetadataConfig>
    return resolveEffectiveEffort({
      model,
      adapterConfig: adapter == null ? undefined : adapters[adapter],
      configEffort: mergedConfig?.general?.effort,
      models
    }).effort ?? FALLBACK_CHAT_EFFORT
  }, [adapter, configRes?.sources?.merged, model])
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
      if (current.source !== 'fallback' && current.source !== 'configured') {
        return current
      }
      if (current.source === 'configured' && current.effort === configuredEffort) {
        return current
      }
      return { effort: configuredEffort, source: 'configured' }
    })
  }, [configRes, configuredEffort])

  const setEffort = useCallback((value?: string) => {
    if (!isExplicitChatEffort(value)) {
      setSelection(getFallbackSelection(configuredEffort, configRes != null))
      return
    }

    writeStoredEffort(value)
    setSelection({ effort: value, source: 'user' })
  }, [configRes, configuredEffort])

  const applySessionEffort = useCallback((value?: string) => {
    if (isExplicitChatEffort(value)) {
      setSelection({ effort: value, source: 'session' })
      return
    }

    setSelection(getFallbackSelection(configuredEffort, configRes != null))
  }, [configRes, configuredEffort])

  const effortOptions = useMemo<Array<{ value: ChatEffort; label: ReactNode }>>(() => [
    ...CHAT_EFFORT_OPTIONS
  ], [])

  return {
    applySessionEffort,
    effort: selection.effort,
    setEffort,
    effortOptions
  }
}
