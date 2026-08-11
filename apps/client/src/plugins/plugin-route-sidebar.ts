import type { RouteSidebarOverride } from '#~/components/layout/route-sidebar-context'

import type { PluginViewRouteSidebar } from './plugin-manifest'

export const createPluginRouteSidebarOverride = (
  key: string,
  sidebar: PluginViewRouteSidebar
): RouteSidebarOverride => ({
  ...sidebar,
  key,
  onSelectItem: item => sidebar.onSelectItem(item)
})
