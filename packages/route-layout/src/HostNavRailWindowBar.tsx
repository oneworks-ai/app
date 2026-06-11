import type { CSSProperties, ReactNode } from 'react'

const classNames = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ')

export interface HostNavRailWindowBarProps {
  collapseLabel: string
  expandLabel: string
  drawerWidth?: number
  filledIcon?: ReactNode
  icon?: ReactNode
  isCollapsed?: boolean
  isPreviewOpen?: boolean
  showToggleLabel?: boolean
  onPointerEnter?: () => void
  onPointerLeave?: () => void
  onToggleCollapsed: () => void
}

export function HostNavRailWindowBar({
  collapseLabel,
  drawerWidth,
  expandLabel,
  filledIcon,
  icon,
  isCollapsed = false,
  isPreviewOpen = false,
  onPointerEnter,
  onPointerLeave,
  onToggleCollapsed,
  showToggleLabel = false
}: HostNavRailWindowBarProps) {
  const label = isCollapsed ? expandLabel : collapseLabel
  const style = drawerWidth == null
    ? undefined
    : {
      '--nav-rail-drawer-width': `${drawerWidth}px`
    } as CSSProperties
  const iconNode = icon == null
    ? null
    : filledIcon == null
    ? icon
    : (
      <span className='host-nav-rail-hover-fill-icon'>
        <span className='host-nav-rail-hover-fill-icon__outline'>
          {icon}
        </span>
        <span className='host-nav-rail-hover-fill-icon__filled'>
          {filledIcon}
        </span>
      </span>
    )

  return (
    <div
      className={classNames(
        'host-nav-rail-window-bar',
        isCollapsed && 'is-sidebar-collapsed',
        isPreviewOpen && 'is-sidebar-preview-open'
      )}
      style={style}
      onMouseLeave={isCollapsed ? onPointerLeave : undefined}
    >
      <button
        type='button'
        className={classNames(
          'host-nav-rail-window-button',
          showToggleLabel && !isCollapsed && 'host-nav-rail-window-button--labeled'
        )}
        aria-label={label}
        title={label}
        onBlur={isCollapsed ? onPointerLeave : undefined}
        onClick={onToggleCollapsed}
        onFocus={isCollapsed ? onPointerEnter : undefined}
        onMouseEnter={isCollapsed ? onPointerEnter : undefined}
      >
        {iconNode == null ? null : <span className='host-nav-rail-window-button__icon'>{iconNode}</span>}
        {showToggleLabel && !isCollapsed
          ? <span className='host-nav-rail-window-button__label'>{collapseLabel}</span>
          : null}
      </button>
    </div>
  )
}
