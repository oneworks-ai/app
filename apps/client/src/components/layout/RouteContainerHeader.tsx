import './RouteContainerHeader.scss'

import { RouteContainerHeader as SharedRouteContainerHeader } from '@oneworks/components/route-layout'
import type {
  RouteContainerHeaderActionItem,
  RouteContainerHeaderBreadcrumb,
  RouteContainerHeaderLeadingActionsMode,
  RouteContainerHeaderProps as SharedRouteContainerHeaderProps
} from '@oneworks/components/route-layout'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'

import { emitDesktopViewShortcut, getDesktopViewShortcut } from '#~/desktop/view-shortcuts'
import { useBrowserHistoryNavigationState } from '#~/hooks/use-browser-history-navigation-state'
import { useResponsiveLayout } from '#~/hooks/use-responsive-layout'
import { isSidebarCollapsedAtom, isSidebarResizingAtom } from '#~/store/index'

export interface RouteContainerHeaderProps extends
  Omit<
    SharedRouteContainerHeaderProps,
    | 'createSessionShortcut'
    | 'historyNavigation'
    | 'isCompactLayout'
    | 'isMac'
    | 'isResizing'
    | 'labels'
    | 'onCollapsedSidebarOpen'
    | 'sidebarToggleShortcut'
  >
{
  actionItems?: RouteContainerHeaderActionItem[]
  breadcrumb?: RouteContainerHeaderBreadcrumb
  leadingActions?: RouteContainerHeaderLeadingActionsMode
}

const readIsMac = () => (
  typeof navigator !== 'undefined' && navigator.platform.includes('Mac')
)

export function RouteContainerHeader({
  collapsed,
  ...props
}: RouteContainerHeaderProps) {
  const { t } = useTranslation()
  const { isCompactLayout } = useResponsiveLayout()
  const isSidebarCollapsed = useAtomValue(isSidebarCollapsedAtom)
  const isResizing = useAtomValue(isSidebarResizingAtom)
  const {
    canGoBack,
    canGoForward,
    goBack,
    goForward
  } = useBrowserHistoryNavigationState()
  const resolvedCollapsed = collapsed ?? isSidebarCollapsed

  return (
    <SharedRouteContainerHeader
      {...props}
      collapsed={resolvedCollapsed}
      createSessionShortcut='mod+k'
      historyNavigation={{
        backShortcut: getDesktopViewShortcut('back'),
        canGoBack,
        canGoForward,
        forwardShortcut: getDesktopViewShortcut('forward'),
        onBack: goBack,
        onForward: goForward
      }}
      isCompactLayout={isCompactLayout}
      isMac={readIsMac()}
      isResizing={isResizing}
      labels={{
        back: t('common.back'),
        expandSidebar: t('navRail.expandSidebar'),
        historyBack: t('navRail.back'),
        historyForward: t('navRail.forward'),
        newChat: t('common.newChat')
      }}
      sidebarToggleShortcut={getDesktopViewShortcut('toggle-sidebar')}
      onCollapsedSidebarOpen={() => emitDesktopViewShortcut('toggle-sidebar')}
    />
  )
}
