import { useSetAtom } from 'jotai'
import { useCallback } from 'react'

import { useResponsiveLayout } from '#~/hooks/use-responsive-layout'
import { useSidebarQueryState } from '#~/hooks/use-sidebar-query-state'
import { isMobileSidebarOpenAtom } from '#~/store/index'

/**
 * Shared route-container sidebar opener.
 *
 * Route pages should use this hook instead of hand-writing mobile drawer /
 * desktop collapsed-sidebar behavior. The route still decides whether to render
 * route-specific content, while the layout layer owns how the sidebar opens in
 * compact, touch, and desktop-collapsed shells.
 */
export function useRouteContainerSidebarOpener() {
  const { isCompactLayout, isTouchInteraction } = useResponsiveLayout()
  const setIsMobileSidebarOpen = useSetAtom(isMobileSidebarOpenAtom)
  const { isSidebarCollapsed, setSidebarCollapsed } = useSidebarQueryState()
  const isCompactView = isCompactLayout || isTouchInteraction

  const openRouteSidebar = useCallback(() => {
    if (isCompactView) {
      setIsMobileSidebarOpen(true)
      return
    }

    setSidebarCollapsed(false)
  }, [isCompactView, setIsMobileSidebarOpen, setSidebarCollapsed])

  const closeRouteSidebar = useCallback(() => {
    if (isCompactView) {
      setIsMobileSidebarOpen(false)
    }
  }, [isCompactView, setIsMobileSidebarOpen])

  return {
    closeRouteSidebar,
    isCompactLayout,
    isSidebarCollapsed,
    isCompactView,
    isTouchInteraction,
    openRouteSidebar
  }
}
