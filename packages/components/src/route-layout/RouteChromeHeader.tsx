import type { ReactNode, Ref } from 'react'

export interface RouteChromeHeaderProps {
  actions?: ReactNode
  className?: string
  collapsed?: boolean
  compact?: boolean
  isBreadcrumb?: boolean
  isResizing?: boolean
  leading?: ReactNode
  placement?: 'overlay' | 'static'
  rootRef?: Ref<HTMLDivElement>
  title?: ReactNode
}

export function RouteChromeHeader({
  actions,
  className,
  collapsed = false,
  compact = false,
  isBreadcrumb = false,
  isResizing = false,
  leading,
  placement = 'overlay',
  rootRef,
  title
}: RouteChromeHeaderProps) {
  return (
    <div
      ref={rootRef}
      className={[
        'route-container-header',
        collapsed ? 'is-collapsed' : '',
        isBreadcrumb ? 'is-breadcrumb' : '',
        isResizing ? 'is-resizing' : '',
        compact ? 'is-compact' : '',
        placement === 'static' ? 'is-static' : '',
        className
      ].filter(Boolean).join(' ')}
    >
      <div className='route-container-header__main'>
        {leading}
        <div className='route-container-header__info'>
          <div className='route-container-header__title'>
            {title}
          </div>
        </div>
      </div>
      {actions != null && (
        <div className='route-container-header__actions'>
          {actions}
        </div>
      )}
    </div>
  )
}
