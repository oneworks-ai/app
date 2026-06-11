import { App as AntdApp, ConfigProvider, theme } from 'antd'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

const ADMIN_THEME_KEY = 'relay-admin.theme'
const ADMIN_PRIMARY_COLOR = '#E23F12'

export type AdminThemeMode = 'dark' | 'light' | 'system'

interface AdminThemeContextValue {
  isDarkMode: boolean
  setThemeMode: (themeMode: AdminThemeMode) => void
  themeMode: AdminThemeMode
}

const AdminThemeContext = createContext<AdminThemeContextValue | null>(null)

const isAdminThemeMode = (value: string | null): value is AdminThemeMode =>
  value === 'system' || value === 'light' || value === 'dark'

const readAdminThemeMode = (): AdminThemeMode => {
  if (typeof window === 'undefined') return 'system'
  const stored = window.localStorage.getItem(ADMIN_THEME_KEY)
  return isAdminThemeMode(stored) ? stored : 'system'
}

const getSystemPrefersDark = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches

export const AdminThemeProvider = ({ children }: { children: ReactNode }) => {
  const [themeMode, setThemeMode] = useState<AdminThemeMode>(() => readAdminThemeMode())
  const [systemPrefersDark, setSystemPrefersDark] = useState(getSystemPrefersDark)
  const isDarkMode = themeMode === 'dark' || themeMode === 'system' && systemPrefersDark

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => setSystemPrefersDark(media.matches)

    handleChange()
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode)
    document.documentElement.dataset.relayAdminTheme = themeMode
    document.documentElement.style.setProperty('--primary-color', ADMIN_PRIMARY_COLOR)
    document.documentElement.style.setProperty(
      '--primary-soft-bg',
      `color-mix(in srgb, ${ADMIN_PRIMARY_COLOR} 12%, var(--bg-color))`
    )
    document.documentElement.style.setProperty(
      '--primary-text-color',
      `color-mix(in srgb, ${ADMIN_PRIMARY_COLOR} 82%, var(--text-color))`
    )

    try {
      window.localStorage.setItem(ADMIN_THEME_KEY, themeMode)
    } catch {}
  }, [isDarkMode, themeMode])

  const themeConfig = useMemo(() => ({
    algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      borderRadius: 6,
      colorPrimary: ADMIN_PRIMARY_COLOR,
      fontFamily: 'inherit'
    }
  }), [isDarkMode])

  const contextValue = useMemo(() => ({
    isDarkMode,
    setThemeMode,
    themeMode
  }), [isDarkMode, themeMode])

  return (
    <AdminThemeContext.Provider value={contextValue}>
      <ConfigProvider theme={themeConfig}>
        <AntdApp>
          {children}
        </AntdApp>
      </ConfigProvider>
    </AdminThemeContext.Provider>
  )
}

export const useAdminTheme = () => {
  const context = useContext(AdminThemeContext)
  if (context == null) {
    throw new Error('useAdminTheme must be used within AdminThemeProvider')
  }
  return context
}
