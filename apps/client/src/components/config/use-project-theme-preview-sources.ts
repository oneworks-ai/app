import { useEffect, useMemo, useState } from 'react'

import { ONEWORKS_THEME_COLOR_PRESETS } from '@oneworks/icon/presets'

import type { ConfigOneWorksIconMode } from '#~/utils/oneworks-icon'

import type { DesktopIconAppearance, DesktopIconBackground, DesktopIconPreviewSources } from './app-icon-settings-model'
import type { TranslationFn } from './configUtils'
import { getProjectThemePreviewSources } from './project-theme-color-settings-model'

export function useProjectThemePreviewSources({
  desktopApi,
  iconAppearance,
  iconBackground,
  iconMode,
  t
}: {
  desktopApi: Window['oneworksDesktop']
  iconAppearance: DesktopIconAppearance
  iconBackground: DesktopIconBackground
  iconMode: ConfigOneWorksIconMode
  t: TranslationFn
}) {
  const [desktopPreviewSources, setDesktopPreviewSources] = useState<DesktopIconPreviewSources>({})
  const fallbackPreviewSources = useMemo(
    () =>
      getProjectThemePreviewSources({
        iconBackground,
        iconMode,
        t
      }),
    [iconBackground, iconMode, t]
  )

  useEffect(() => {
    const getDesktopIconPreview = desktopApi?.getDesktopIconPreview
    if (getDesktopIconPreview == null) {
      setDesktopPreviewSources({})
      return
    }

    let disposed = false
    setDesktopPreviewSources({})

    void Promise.all(
      ONEWORKS_THEME_COLOR_PRESETS.map(async (preset) => {
        const src = await getDesktopIconPreview({
          iconAppearance,
          iconBackground,
          iconTheme: preset.theme
        }).catch(() => undefined)
        return [preset.theme, src] as const
      })
    )
      .then((entries) => {
        if (disposed) return

        setDesktopPreviewSources(
          entries.reduce<DesktopIconPreviewSources>((next, [theme, src]) => {
            if (src != null && src !== '') {
              next[theme] = src
            }
            return next
          }, {})
        )
      })

    return () => {
      disposed = true
    }
  }, [desktopApi, iconAppearance, iconBackground])

  return useMemo(
    () => ({
      ...fallbackPreviewSources,
      ...desktopPreviewSources
    }),
    [desktopPreviewSources, fallbackPreviewSources]
  )
}
