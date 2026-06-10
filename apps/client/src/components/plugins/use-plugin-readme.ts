import { useEffect, useState } from 'react'

import { getPluginReadme } from '#~/plugins/api'
import type { PluginReadme } from '#~/plugins/api'
import type { PluginRuntimeInstance } from '#~/plugins/plugin-manifest'

export interface PluginReadmeState {
  error?: string
  loading: boolean
  readme?: PluginReadme
  readmes: PluginReadme[]
}

export const usePluginReadme = (
  plugin: PluginRuntimeInstance | undefined,
  refreshKey: unknown,
  fallbackError: string
) => {
  const [state, setState] = useState<PluginReadmeState>({ loading: false, readmes: [] })

  useEffect(() => {
    if (plugin == null) {
      setState({ loading: false, readmes: [] })
      return
    }

    let disposed = false
    setState({ loading: true, readmes: [] })
    void getPluginReadme(plugin.scope)
      .then(({ readme, readmes }) => {
        if (disposed) return
        setState({ loading: false, readme, readmes })
      })
      .catch((error) => {
        if (disposed) return
        const messageText = error instanceof Error ? error.message : fallbackError
        setState({ error: messageText, loading: false, readmes: [] })
      })

    return () => {
      disposed = true
    }
  }, [fallbackError, plugin, refreshKey])

  return state
}
