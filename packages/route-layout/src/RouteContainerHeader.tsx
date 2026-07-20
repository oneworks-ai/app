import type { KeyboardEvent, ReactNode, Ref } from 'react'

export interface RouteContainerHeaderActionItem {
  icon: ReactNode
  key: string
  label: string
  active?: boolean
  activeIcon?: ReactNode
  activeLabel?: string
  activeTitle?: string
  danger?: boolean
  disabled?: boolean
  loading?: boolean
  title?: string
  onSelect?: () => void
}

export function RouteContainerHeaderActionButton({
  item
}: {
  item: RouteContainerHeaderActionItem
}) {
  const isActive = item.active === true
  const resolvedIcon = isActive && item.activeIcon != null ? item.activeIcon : item.icon
  const resolvedLabel = isActive ? item.activeLabel ?? item.label : item.label
  const resolvedTitle = isActive
    ? item.activeTitle ?? item.activeLabel ?? item.title ?? item.label
    : item.title ?? item.label

  return (
    <span className='route-container-header__action-segment'>
      <button
        type='button'
        className={[
          'route-container-header__action-button',
          isActive ? 'is-active' : '',
          item.danger === true ? 'is-danger' : ''
        ].filter(Boolean).join(' ')}
        disabled={item.disabled}
        aria-busy={item.loading === true}
        aria-label={resolvedLabel}
        aria-pressed={item.active == null ? undefined : isActive}
        title={resolvedTitle}
        onClick={item.onSelect}
      >
        <span className='route-container-header__action-icon'>
          {resolvedIcon}
        </span>
      </button>
    </span>
  )
}

export interface RouteContainerHeaderBreadcrumb {
  currentTitle?: ReactNode
  onBack: () => void
  parentTitle: ReactNode
  ariaLabel?: string
  backLabel?: string
  backIcon?: ReactNode
  separatorIcon?: ReactNode
}

export interface RouteContainerHeaderProps {
  actionItems?: RouteContainerHeaderActionItem[]
  actions?: ReactNode
  breadcrumb?: RouteContainerHeaderBreadcrumb
  collapsed?: boolean
  compact?: boolean
  icon?: ReactNode
  title?: ReactNode
  titleContent?: ReactNode
  className?: string
  rootRef?: Ref<HTMLDivElement>
  onTitleClick?: () => void
}

export function RouteContainerHeader({
  actionItems = [],
  actions,
  breadcrumb,
  collapsed = false,
  compact = false,
  icon,
  className,
  rootRef,
  title,
  titleContent,
  onTitleClick
}: RouteContainerHeaderProps) {
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
            {icon == null ? null : (
              <span className='route-container-header__title-icon' aria-hidden='true'>
                {icon}
              </span>
            )}
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
      <div className='route-container-header__breadcrumb' aria-label={breadcrumb.ariaLabel}>
        <button
          type='button'
          className='route-container-header__breadcrumb-back'
          aria-label={breadcrumb.backLabel ?? 'Back'}
          onClick={(event) => {
            event.stopPropagation()
            breadcrumb.onBack()
          }}
        >
          <span className='route-container-header__breadcrumb-icon' aria-hidden='true'>
            {breadcrumb.backIcon ?? <span className='route-container-header__breadcrumb-fallback-icon'>‹</span>}
          </span>
        </button>
        <span
          className='route-container-header__breadcrumb-parent'
          title={typeof breadcrumb.parentTitle === 'string' ? breadcrumb.parentTitle : undefined}
        >
          {breadcrumb.parentTitle}
        </span>
        <span className='route-container-header__breadcrumb-separator' aria-hidden='true'>
          <span className='route-container-header__breadcrumb-icon'>
            {breadcrumb.separatorIcon ?? <span className='route-container-header__breadcrumb-fallback-icon'>›</span>}
          </span>
        </span>
        <span
          className='route-container-header__breadcrumb-current'
          title={titleText}
        >
          {resolvedTitle}
        </span>
      </div>
    )

  return (
    <div
      ref={rootRef}
      className={[
        'route-container-header',
        collapsed ? 'is-collapsed' : '',
        breadcrumb != null ? 'is-breadcrumb' : '',
        compact ? 'is-compact' : '',
        className
      ].filter(Boolean).join(' ')}
    >
      <div className='route-container-header__main'>
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
          {actionItems.map(item => <RouteContainerHeaderActionButton key={item.key} item={item} />)}
          {actions == null
            ? null
            : (
              <span className='route-container-header__action-segment route-container-header__custom-actions'>
                {actions}
              </span>
            )}
        </div>
      )}
    </div>
  )
}
