import { useMemo } from 'react'

import { useOptionalPluginContext } from './plugin-context'
import type { PluginThemeRuntimeRegistration } from './plugin-theme-contract'

const emptyThemes: PluginThemeRuntimeRegistration[] = []

export const usePluginThemes = () => {
  const context = useOptionalPluginContext()
  return context?.snapshot.themes ?? emptyThemes
}

export const usePluginTheme = (themeId: string) => {
  const themes = usePluginThemes()
  return useMemo(() => themes.find(theme => theme.id === themeId), [themeId, themes])
}

export function PluginThemeStyles() {
  const themes = usePluginThemes()

  return (
    <>
      {themes.map(theme =>
        theme.cssText == null || theme.cssText === ''
          ? null
          : (
            <style key={`${theme.pluginScope}/${theme.id}`} data-plugin-theme-style={theme.id}>
              {theme.cssText}
            </style>
          )
      )}
    </>
  )
}
