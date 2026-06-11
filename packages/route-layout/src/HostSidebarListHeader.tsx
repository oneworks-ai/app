import type { ReactNode } from 'react'

const classNames = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ')

export interface HostSidebarListHeaderProps {
  children?: ReactNode
  className?: string
  compact?: boolean
  collapsed?: boolean
  primaryAction?: ReactNode
  sideAction?: ReactNode
}

export function HostSidebarListHeader({
  children,
  className,
  compact = false,
  collapsed = false,
  primaryAction,
  sideAction
}: HostSidebarListHeaderProps) {
  const shouldRenderTop = primaryAction != null || sideAction != null

  return (
    <div
      className={classNames(
        'sidebar-list-header',
        compact && 'sidebar-list-header--compact',
        collapsed && 'sidebar-list-header--collapsed',
        className
      )}
    >
      {shouldRenderTop && (
        <div className='sidebar-list-header__top'>
          {primaryAction != null && (
            <div className='sidebar-list-header__primary'>
              {primaryAction}
            </div>
          )}
          {sideAction != null && (
            <div className='sidebar-list-header__side'>
              {sideAction}
            </div>
          )}
        </div>
      )}
      {!collapsed && children != null && (
        <div className='sidebar-list-header__content'>
          {children}
        </div>
      )}
    </div>
  )
}
