import { ConfigProvider } from 'antd'
import type { ComponentType } from 'react'
import { useEffect, useState } from 'react'

import { AppShell } from '#~/components/layout/AppShell'
import { isHomepagePreviewBundleEnabled } from '#~/homepage-preview/runtime-loader'
import { useAppPreferences } from '#~/hooks/use-app-preferences'
import { useSessionSubscription } from '#~/hooks/use-session-subscription.js'
import { useSidebarNavigation } from '#~/hooks/use-sidebar-navigation'
import { NotificationProvider } from '#~/notifications/NotificationProvider'
import { PluginProvider } from '#~/plugins/PluginProvider'
import { AppRoutes } from '#~/routes/AppRoutes'

function HomepagePreviewNavigationBridgeSlot() {
  const [Bridge, setBridge] = useState<ComponentType | null>(null)

  useEffect(() => {
    if (!isHomepagePreviewBundleEnabled()) return
    let didCancel = false
    void import('#~/homepage-preview/navigation-bridge').then((mod) => {
      if (!didCancel) {
        setBridge(() => mod.HomepagePreviewNavigationBridge)
      }
    })
    return () => {
      didCancel = true
    }
  }, [])

  return Bridge == null ? null : <Bridge />
}

export function AuthenticatedApp() {
  useSessionSubscription()
  const { isDarkMode, themeConfig } = useAppPreferences()
  const sidebarNavigation = useSidebarNavigation()

  return (
    <ConfigProvider theme={themeConfig}>
      <NotificationProvider>
        <PluginProvider>
          <HomepagePreviewNavigationBridgeSlot />
          <AppShell
            activeId={sidebarNavigation.activeSidebarId}
            isDarkMode={isDarkMode}
            onDeletedSession={sidebarNavigation.handleDeletedSession}
            onSelectRoom={sidebarNavigation.handleSelectRoom}
            onSelectSession={sidebarNavigation.handleSelectSession}
            showSidebar={sidebarNavigation.showSidebar}
            sidebarWidth={sidebarNavigation.sidebarWidth}
          >
            <AppRoutes />
          </AppShell>
        </PluginProvider>
      </NotificationProvider>
    </ConfigProvider>
  )
}
