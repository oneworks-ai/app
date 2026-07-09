import { ConfigProvider } from 'antd'
import type { ComponentType } from 'react'
import { useEffect, useState } from 'react'

import { AppShell } from '#~/components/layout/AppShell'
import { isHomepagePreviewBundleEnabled } from '#~/homepage-preview/runtime-loader'
import { useAppPreferences } from '#~/hooks/use-app-preferences'
import { useClientEventStream } from '#~/hooks/use-client-event-stream'
import { useSidebarNavigation } from '#~/hooks/use-sidebar-navigation'
import { NotificationProvider } from '#~/notifications/NotificationProvider'
import { PluginProvider } from '#~/plugins/PluginProvider'
import { AppRoutes } from '#~/routes/AppRoutes'
import { getRuntimeWorkspaceId } from '#~/runtime-config'

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
  useClientEventStream()
  const { isDarkMode, themeConfig } = useAppPreferences()
  const sidebarNavigation = useSidebarNavigation()
  const pluginRuntimeSource = getRuntimeWorkspaceId() == null ? undefined : 'manager'

  return (
    <ConfigProvider theme={themeConfig}>
      <NotificationProvider>
        {/* Workspace services host sessions and APIs; host-level plugin chrome stays global. */}
        <PluginProvider runtimeSource={pluginRuntimeSource}>
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
