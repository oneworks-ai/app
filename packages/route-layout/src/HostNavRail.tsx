import type { CSSProperties, KeyboardEventHandler, PointerEventHandler, ReactNode } from 'react'

const classNames = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ')

export interface HostNavRailResizeHandleProps {
  label: string
  max: number
  min: number
  value: number
  onKeyDown: KeyboardEventHandler<HTMLDivElement>
  onPointerDown: PointerEventHandler<HTMLDivElement>
}

export interface HostNavRailProps {
  ariaHidden?: boolean
  body?: ReactNode
  children?: ReactNode
  className?: string
  drawerWidth?: number
  footerAfter?: ReactNode
  footerBefore?: ReactNode
  footerMenu?: ReactNode
  isCollapsed?: boolean
  isFullyCollapsed?: boolean
  isPreviewOpen?: boolean
  isResizing?: boolean
  resizeHandle?: HostNavRailResizeHandleProps
  onPointerEnter?: () => void
  onPointerLeave?: () => void
}

export function HostNavRail({
  ariaHidden = false,
  body,
  children,
  className,
  drawerWidth,
  footerAfter,
  footerBefore,
  footerMenu,
  isCollapsed = false,
  isFullyCollapsed = false,
  isPreviewOpen = false,
  isResizing = false,
  onPointerEnter,
  onPointerLeave,
  resizeHandle
}: HostNavRailProps) {
  const style = drawerWidth == null
    ? undefined
    : {
      '--nav-rail-drawer-width': `${drawerWidth}px`
    } as CSSProperties
  const content = children ?? body

  return (
    <div
      className={classNames(
        'host-nav-rail',
        'nav-rail',
        'nav-rail--desktop-drawer',
        isCollapsed && 'is-sidebar-collapsed',
        isPreviewOpen && 'is-sidebar-preview-open',
        isResizing && 'is-resizing',
        className
      )}
      aria-hidden={ariaHidden || undefined}
      onMouseEnter={isCollapsed ? onPointerEnter : undefined}
      onMouseLeave={isCollapsed ? onPointerLeave : undefined}
      style={style}
    >
      {!isFullyCollapsed && (
        <>
          <div className='host-nav-rail__body nav-rail-drawer-body'>
            {content == null ? null : (
              <div
                className='host-nav-rail__body-content nav-rail-drawer-sessions'
                aria-hidden={isCollapsed && !isPreviewOpen || undefined}
              >
                {content}
              </div>
            )}
          </div>

          <div
            className='host-nav-rail__footer nav-rail-drawer-footer'
            aria-hidden={isCollapsed && !isPreviewOpen || undefined}
          >
            {footerBefore == null ? null : (
              <div className='host-nav-rail__footer-slot host-nav-rail__footer-slot--before nav-rail-drawer-footer__slot nav-rail-drawer-footer__slot--before'>
                {footerBefore}
              </div>
            )}
            {footerMenu}
            {footerAfter == null ? null : (
              <div className='host-nav-rail__footer-slot host-nav-rail__footer-slot--after nav-rail-drawer-footer__slot nav-rail-drawer-footer__slot--after'>
                {footerAfter}
              </div>
            )}
          </div>
        </>
      )}

      {resizeHandle == null ? null : (
        <div
          className='host-nav-rail__resize-handle nav-rail-resize-handle'
          role='separator'
          aria-label={resizeHandle.label}
          aria-orientation='vertical'
          aria-valuemin={resizeHandle.min}
          aria-valuemax={resizeHandle.max}
          aria-valuenow={resizeHandle.value}
          tabIndex={0}
          onKeyDown={resizeHandle.onKeyDown}
          onPointerDown={resizeHandle.onPointerDown}
        />
      )}
    </div>
  )
}
