import { useCallback, useMemo, useState } from 'react'
import useSWR from 'swr'

import type { AdapterBuiltinModel, ConfigResponse } from '@oneworks/types'

import { getConfig } from '#~/api.js'

import { resolveAdapterModelRuntimeCapabilities } from './model-runtime-capabilities'

const FAST_MODE_STORAGE_KEY = 'oneworks_chat_fast_mode'

const readStoredFastMode = () => {
  try {
    const value = localStorage.getItem(FAST_MODE_STORAGE_KEY)
    return value === 'true' ? true : value === 'false' ? false : undefined
  } catch {
    return undefined
  }
}

const writeStoredFastMode = (enabled: boolean) => {
  try {
    localStorage.setItem(FAST_MODE_STORAGE_KEY, String(enabled))
  } catch {
    // In-memory selection still works when storage is unavailable.
  }
}

export function useChatFastMode({
  adapter,
  model
}: {
  adapter?: string
  model?: string
} = {}) {
  const { data: configRes } = useSWR<ConfigResponse>('/api/config', getConfig)
  const [selectedFastMode, setSelectedFastMode] = useState(() => readStoredFastMode() ?? false)
  const supportsFastMode = useMemo(() => {
    const adapterBuiltinModels = configRes?.sources?.merged?.adapterBuiltinModels as
      | Record<string, AdapterBuiltinModel[]>
      | undefined
    return resolveAdapterModelRuntimeCapabilities({
      adapter,
      adapterBuiltinModels,
      model
    }).supportsFastMode
  }, [adapter, configRes?.sources?.merged?.adapterBuiltinModels, model])

  const setFastMode = useCallback((enabled: boolean) => {
    writeStoredFastMode(enabled)
    setSelectedFastMode(enabled)
  }, [])

  const applySessionFastMode = useCallback((enabled?: boolean) => {
    setSelectedFastMode(typeof enabled === 'boolean' ? enabled : readStoredFastMode() ?? false)
  }, [])

  return {
    applySessionFastMode,
    fastMode: supportsFastMode && selectedFastMode,
    setFastMode,
    supportsFastMode
  }
}
