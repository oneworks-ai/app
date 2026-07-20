import { ConfigProvider } from 'antd'
import type { ComponentType } from 'react'
import { useEffect, useState } from 'react'

import { AppShell } from '#~/components/layout/AppShell'
import { PluginThemeBanner } from '#~/components/layout/PluginThemeBanner'
import { isHomepagePreviewBundleEnabled } from '#~/homepage-preview/runtime-loader'
import { useAppPreferences } from '#~/hooks/use-app-preferences'
import { useClientEventStream } from '#~/hooks/use-client-event-stream'
import { useSidebarNavigation } from '#~/hooks/use-sidebar-navigation'
import { NotificationProvider } from '#~/notifications/NotificationProvider'
import { PluginProvider } from '#~/plugins/PluginProvider'
import { usePluginContext } from '#~/plugins/plugin-context'
import { PluginThemeStyles } from '#~/plugins/plugin-themes'
import { AppRoutes } from '#~/routes/AppRoutes'
import { getRuntimeWorkspaceId } from '#~/runtime-config'
import { shouldShowThemeBanner } from '#~/utils/theme-pack'

function HomepagePreviewNavigationBridgeSlot() {
  const [Bridge, setBridge] = useState<ComponentType | null>(null)

  useEffect(() => {
    if (!isHomepagePreviewBundleEnabled()) return
    let didCancel = false
    void import('#~/homepage-preview/navigation-bridge').then((mod) => {
      if (!didCancel) setBridge(() => mod.HomepagePreviewNavigationBridge)
    })
    return () => {
      didCancel = true
    }
  }, [])

  return Bridge == null ? null : <Bridge />
}

function ThemedAuthenticatedApp() {
  const { ready } = usePluginContext()
  const { activeTheme, isDarkMode, themeConfig, themePack, themeSettings } = useAppPreferences()
  const sidebarNavigation = useSidebarNavigation()
  if (!ready) return null

  const themeBanner = shouldShowThemeBanner(activeTheme, themeSettings) && activeTheme?.banner != null
    ? (reserveWindowControls: boolean) => (
      <PluginThemeBanner
        banner={activeTheme.banner!}
        isDarkMode={isDarkMode}
        reserveWindowControls={reserveWindowControls}
      />
    )
    : undefined

  return (
    <ConfigProvider theme={themeConfig}>
      <PluginThemeStyles />
      <HomepagePreviewNavigationBridgeSlot />
      <AppShell
        activeId={sidebarNavigation.activeSidebarId}
        isDarkMode={isDarkMode}
        onDeletedSession={sidebarNavigation.handleDeletedSession}
        onSelectRoom={sidebarNavigation.handleSelectRoom}
        onSelectSession={sidebarNavigation.handleSelectSession}
        showSidebar={sidebarNavigation.showSidebar}
        sidebarWidth={sidebarNavigation.sidebarWidth}
        themeBanner={themeBanner}
        themePack={activeTheme?.id ?? 'default'}
      >
        <AppRoutes />
      </AppShell>
    </ConfigProvider>
  )
}

export function AuthenticatedApp() {
  useClientEventStream()
  const pluginRuntimeSource = getRuntimeWorkspaceId() == null ? undefined : 'manager'

  return (
    <NotificationProvider>
      <PluginProvider runtimeSource={pluginRuntimeSource}>
        <ThemedAuthenticatedApp />
      </PluginProvider>
    </NotificationProvider>
  )
}
