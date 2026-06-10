import type { MouseEvent, ReactElement, ReactNode } from 'react'

const classNames = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ')

export interface HostSidebarQuickLinkAction {
  key: string
  label: ReactNode
  disabled?: boolean
  icon?: ReactNode
  onSelect: () => void
}

export interface HostSidebarQuickLinkItem {
  key: string
  label: ReactNode
  active?: boolean
  activeLabel?: ReactNode
  actions?: HostSidebarQuickLinkAction[]
  disabled?: boolean
  icon?: ReactNode
  shortcut?: string
  onSelect: () => void
}

export interface HostSidebarQuickLinksProps {
  items: HostSidebarQuickLinkItem[]
  ariaLabel?: string
  className?: string
  renderActionWrapper?: (
    action: HostSidebarQuickLinkAction,
    node: ReactElement,
    item: HostSidebarQuickLinkItem
  ) => ReactNode
  renderItemWrapper?: (node: ReactElement, item: HostSidebarQuickLinkItem) => ReactNode
  onItemContextMenu?: (event: MouseEvent<HTMLDivElement>, item: HostSidebarQuickLinkItem) => void
}

const triggerQuickLinkFeedback = (button: HTMLElement) => {
  button.classList.add('active-scale')
  window.setTimeout(() => {
    button.classList.remove('active-scale')
  }, 200)
}

export function HostSidebarQuickLinks({
  ariaLabel,
  className,
  items,
  onItemContextMenu,
  renderActionWrapper,
  renderItemWrapper
}: HostSidebarQuickLinksProps) {
  if (items.length === 0) return null

  return (
    <div
      className={classNames('sidebar-header__quick-links', className)}
      role={ariaLabel == null ? undefined : 'navigation'}
      aria-label={ariaLabel}
    >
      {items.map((item) => {
        const isActive = item.active === true
        const itemActions = item.actions ?? []
        const row = (
          <div
            key={item.key}
            className={classNames(
              'sidebar-header__quick-link-row',
              isActive ? 'is-active' : 'is-idle',
              itemActions.length > 0 && 'has-actions'
            )}
            onContextMenu={event => onItemContextMenu?.(event, item)}
          >
            <button
              type='button'
              className={classNames('sidebar-header__quick-link', isActive ? 'is-active' : 'is-idle')}
              disabled={item.disabled}
              aria-current={isActive ? 'page' : undefined}
              onClick={(event) => {
                triggerQuickLinkFeedback(event.currentTarget)
                item.onSelect()
              }}
            >
              {item.icon}
              <span className='sidebar-header__quick-link-label'>
                {isActive && item.activeLabel != null ? item.activeLabel : item.label}
              </span>
              {item.shortcut != null && item.shortcut !== '' && (
                <span className='sidebar-header__quick-link-shortcut' aria-hidden='true'>
                  {item.shortcut}
                </span>
              )}
            </button>
            {itemActions.length > 0 && (
              <div className='sidebar-header__quick-link-actions'>
                {itemActions.map((action) => {
                  const actionNode = (
                    <button
                      key={action.key}
                      type='button'
                      className='sidebar-header__quick-link-action'
                      disabled={action.disabled}
                      aria-label={typeof action.label === 'string' ? action.label : action.key}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        action.onSelect()
                      }}
                    >
                      {action.icon}
                    </button>
                  )

                  return renderActionWrapper?.(action, actionNode, item) ?? actionNode
                })}
              </div>
            )}
          </div>
        )

        return renderItemWrapper?.(row, item) ?? row
      })}
    </div>
  )
}
