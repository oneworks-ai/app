import { useAtomValue } from 'jotai'
import { useEffect, useMemo, useState } from 'react'

import { themeAtom } from '#~/store'
import type { ThemeMode } from '#~/store'

export type ResolvedThemeMode = 'light' | 'dark'

const getSystemPrefersDark = () => (
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches
)

export function useResolvedThemeMode() {
  const themeMode = useAtomValue(themeAtom)
  const [systemPrefersDark, setSystemPrefersDark] = useState(getSystemPrefersDark)

  useEffect(() => {
    if (themeMode !== 'system') return
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => setSystemPrefersDark(media.matches)
    handleChange()
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [themeMode])

  const resolvedThemeMode: ResolvedThemeMode = themeMode === 'dark' ||
      (themeMode === 'system' && systemPrefersDark)
    ? 'dark'
    : 'light'

  return useMemo(() => ({
    isDarkMode: resolvedThemeMode === 'dark',
    resolvedThemeMode,
    themeMode
  }), [resolvedThemeMode, themeMode])
}

export function useDesktopThemeSourceBridge(themeMode: ThemeMode) {
  useEffect(() => {
    const desktopApi = window.oneworksDesktop
    const setThemeSource = desktopApi?.setThemeSource
    if (setThemeSource == null) return

    void setThemeSource(themeMode).catch(() => undefined)

    const updateDesktopSettings = desktopApi?.updateDesktopSettings
    if (updateDesktopSettings == null) return

    let disposed = false
    const syncIconAppearance = async () => {
      try {
        const settings = await desktopApi?.getDesktopSettings?.()
        if (disposed || settings?.iconAppearance === themeMode) return
        await updateDesktopSettings({ iconAppearance: themeMode })
      } catch {}
    }

    void syncIconAppearance()

    return () => {
      disposed = true
    }
  }, [themeMode])
}
