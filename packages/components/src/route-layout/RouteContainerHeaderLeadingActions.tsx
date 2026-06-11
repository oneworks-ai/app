import { MaterialSymbol } from './MaterialSymbol.js'
import { RouteHeaderActionButton } from './RouteHeaderActionButton.js'

export type RouteContainerHeaderLeadingActionsMode = 'auto' | boolean

export interface RouteContainerHeaderHistoryNavigation {
  canGoBack: boolean
  canGoForward: boolean
  backShortcut?: string
  forwardShortcut?: string
  onBack: () => void
  onForward: () => void
}

export interface RouteContainerHeaderLabels {
  back?: string
  expandSidebar?: string
  historyBack?: string
  historyForward?: string
  newChat?: string
}

export const defaultRouteContainerHeaderLabels: Required<RouteContainerHeaderLabels> = {
  back: 'Back',
  expandSidebar: 'Expand sidebar',
  historyBack: 'Back',
  historyForward: 'Forward',
  newChat: 'New chat'
}

export function RouteContainerHeaderLeadingActions({
  collapsed,
  createSessionShortcut,
  historyNavigation,
  isCompactLayout,
  isMac,
  labels,
  leadingActions,
  sidebarToggleShortcut,
  onCollapsedSidebarOpen,
  onCreateSession,
  onOpenSidebar
}: {
  collapsed: boolean
  createSessionShortcut?: string
  historyNavigation?: RouteContainerHeaderHistoryNavigation
  isCompactLayout: boolean
  isMac: boolean
  labels: Required<RouteContainerHeaderLabels>
  leadingActions: RouteContainerHeaderLeadingActionsMode
  sidebarToggleShortcut?: string
  onCollapsedSidebarOpen?: () => void
  onCreateSession?: () => void
  onOpenSidebar?: () => void
}) {
  const canRender = onOpenSidebar != null || historyNavigation != null || onCreateSession != null
  const shouldRender = canRender && (leadingActions === 'auto' ? isCompactLayout : leadingActions)
  if (!shouldRender) return null

  const handleOpenSidebar = () => {
    if (!isCompactLayout && collapsed && onCollapsedSidebarOpen != null) {
      onCollapsedSidebarOpen()
      return
    }

    onOpenSidebar?.()
  }

  return (
    <div className='route-container-header__leading-actions'>
      {onOpenSidebar != null && (
        <RouteHeaderActionButton
          isMac={isMac}
          shortcut={sidebarToggleShortcut}
          tooltipTitle={labels.expandSidebar}
          label={labels.expandSidebar}
          onClick={handleOpenSidebar}
          icon={<MaterialSymbol className='route-container-header__action-icon' name='left_panel_open' />}
        />
      )}
      {historyNavigation != null && (
        <>
          <RouteHeaderActionButton
            isMac={isMac}
            shortcut={historyNavigation.backShortcut}
            tooltipTitle={labels.historyBack}
            disabled={!historyNavigation.canGoBack}
            label={labels.historyBack}
            onClick={historyNavigation.onBack}
            icon={<MaterialSymbol className='route-container-header__action-icon' name='arrow_back' />}
          />
          <RouteHeaderActionButton
            isMac={isMac}
            shortcut={historyNavigation.forwardShortcut}
            tooltipTitle={labels.historyForward}
            disabled={!historyNavigation.canGoForward}
            label={labels.historyForward}
            onClick={historyNavigation.onForward}
            icon={<MaterialSymbol className='route-container-header__action-icon' name='arrow_forward' />}
          />
        </>
      )}
      {onCreateSession != null && (
        <RouteHeaderActionButton
          isMac={isMac}
          shortcut={createSessionShortcut}
          tooltipTitle={labels.newChat}
          label={labels.newChat}
          onClick={onCreateSession}
          icon={<MaterialSymbol className='route-container-header__action-icon' name='edit_square' />}
        />
      )}
    </div>
  )
}
