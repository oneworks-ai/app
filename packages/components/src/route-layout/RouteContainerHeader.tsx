import type { KeyboardEvent, ReactNode, Ref } from 'react'

import { renderIconAsset } from './IconAsset.js'
import type { IconAsset } from './IconAsset.js'
import {
  RouteContainerHeaderBreadcrumbContent
} from './RouteContainerHeaderBreadcrumb.js'
import type {
  RouteContainerHeaderBreadcrumb
} from './RouteContainerHeaderBreadcrumb.js'
import {
  readRouteHeaderIsMac,
  RouteContainerHeaderActionButton
} from './RouteContainerHeaderActionButton.js'
import type {
  RouteContainerHeaderActionItem
} from './RouteContainerHeaderActionButton.js'
import {
  defaultRouteContainerHeaderLabels,
  RouteContainerHeaderLeadingActions
} from './RouteContainerHeaderLeadingActions.js'
import type {
  RouteContainerHeaderHistoryNavigation,
  RouteContainerHeaderLabels,
  RouteContainerHeaderLeadingActionsMode
} from './RouteContainerHeaderLeadingActions.js'

export interface RouteContainerHeaderProps {
  actionItems?: RouteContainerHeaderActionItem[]
  actions?: ReactNode
  breadcrumb?: RouteContainerHeaderBreadcrumb
  collapsed?: boolean
  compact?: boolean
  createSessionShortcut?: string
  historyNavigation?: RouteContainerHeaderHistoryNavigation
  icon?: IconAsset
  isCompactLayout?: boolean
  isMac?: boolean
  isResizing?: boolean
  labels?: RouteContainerHeaderLabels
  leadingActions?: RouteContainerHeaderLeadingActionsMode
  sidebarToggleShortcut?: string
  title?: ReactNode
  titleContent?: ReactNode
  className?: string
  rootRef?: Ref<HTMLDivElement>
  onCollapsedSidebarOpen?: () => void
  onCreateSession?: () => void
  onOpenSidebar?: () => void
  onTitleClick?: () => void
}

export function RouteContainerHeader({
  actionItems = [],
  actions,
  breadcrumb,
  collapsed = false,
  compact,
  createSessionShortcut,
  historyNavigation,
  icon,
  isCompactLayout = false,
  isMac = readRouteHeaderIsMac(),
  isResizing = false,
  labels,
  leadingActions = 'auto',
  className,
  rootRef,
  sidebarToggleShortcut,
  title,
  titleContent,
  onCollapsedSidebarOpen,
  onCreateSession,
  onOpenSidebar,
  onTitleClick
}: RouteContainerHeaderProps) {
  const resolvedLabels = { ...defaultRouteContainerHeaderLabels, ...labels }
  const isHeaderCompact = compact ?? (isCompactLayout || collapsed)
  const resolvedTitle = breadcrumb?.currentTitle ?? title
  const titleText = typeof resolvedTitle === 'string' ? resolvedTitle : undefined
  const handleTitleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (onTitleClick == null) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onTitleClick()
  }
  const renderedTitleContent = breadcrumb == null
    ? (
      <span className='route-container-header__title-content'>
        {titleContent ?? (
          <>
            {icon != null && renderIconAsset({
              active: true,
              className: 'route-container-header__title-icon',
              icon
            })}
            <span
              className='route-container-header__title-text'
              title={titleText}
            >
              {resolvedTitle}
            </span>
          </>
        )}
      </span>
    )
    : (
      <RouteContainerHeaderBreadcrumbContent
        backLabel={resolvedLabels.back}
        breadcrumb={breadcrumb}
        currentTitle={resolvedTitle}
        titleText={titleText}
      />
    )

  return (
    <div
      ref={rootRef}
      className={[
        'route-container-header',
        collapsed ? 'is-collapsed' : '',
        breadcrumb != null ? 'is-breadcrumb' : '',
        isResizing ? 'is-resizing' : '',
        isHeaderCompact ? 'is-compact' : '',
        className
      ].filter(Boolean).join(' ')}
    >
      <div className='route-container-header__main'>
        <RouteContainerHeaderLeadingActions
          collapsed={collapsed}
          createSessionShortcut={createSessionShortcut}
          historyNavigation={historyNavigation}
          isCompactLayout={isCompactLayout}
          isMac={isMac}
          labels={resolvedLabels}
          leadingActions={leadingActions}
          sidebarToggleShortcut={sidebarToggleShortcut}
          onCollapsedSidebarOpen={onCollapsedSidebarOpen}
          onCreateSession={onCreateSession}
          onOpenSidebar={onOpenSidebar}
        />
        <div className='route-container-header__info'>
          <div className='route-container-header__title'>
            <span
              className={[
                'route-container-header__title-click-target',
                onTitleClick != null ? 'is-clickable' : ''
              ].filter(Boolean).join(' ')}
              role={onTitleClick == null ? undefined : 'button'}
              tabIndex={onTitleClick == null ? undefined : 0}
              onClick={onTitleClick}
              onKeyDown={handleTitleKeyDown}
            >
              {renderedTitleContent}
            </span>
          </div>
        </div>
      </div>
      {(actionItems.length > 0 || actions != null) && (
        <div className='route-container-header__actions'>
          {actionItems.map(item => <RouteContainerHeaderActionButton key={item.key} isMac={isMac} item={item} />)}
          {actions}
        </div>
      )}
    </div>
  )
}
