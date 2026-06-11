import { useEffect, useState } from 'react'

import { getPluginAssets } from '#~/plugins/api'
import type { PluginDetailAssetGroup } from '#~/plugins/api'
import type { PluginRuntimeInstance } from '#~/plugins/plugin-manifest'

export interface PluginAssetsState {
  error?: string
  groups: PluginDetailAssetGroup[]
  loading: boolean
}

export const usePluginAssets = (
  plugin: PluginRuntimeInstance | undefined,
  refreshKey: unknown,
  fallbackError: string
) => {
  const [state, setState] = useState<PluginAssetsState>({ groups: [], loading: false })

  useEffect(() => {
    if (plugin == null) {
      setState({ groups: [], loading: false })
      return
    }

    let disposed = false
    setState({ groups: [], loading: true })
    void getPluginAssets(plugin.scope)
      .then((groups) => {
        if (disposed) return
        setState({ groups, loading: false })
      })
      .catch((error) => {
        if (disposed) return
        const messageText = error instanceof Error ? error.message : fallbackError
        setState({ error: messageText, groups: [], loading: false })
      })

    return () => {
      disposed = true
    }
  }, [fallbackError, plugin, refreshKey])

  return state
}
