import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { forwardRef } from 'react'

const classNames = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ')

export interface HostNavRailItem {
  id: string
  label: ReactNode
  active?: boolean
  disabled?: boolean
  href?: string
  icon?: ReactNode
  onSelect?: () => void
}

export interface HostNavRailPrimaryNavProps {
  ariaLabel: string
  items: HostNavRailItem[]
  className?: string
}

export interface HostNavRailFooterButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  active?: boolean
  icon?: ReactNode
  label: ReactNode
  trailingIcon?: ReactNode
}

const hostNavRailItemClassName = (item: HostNavRailItem) =>
  classNames('host-nav-rail__primary-item', item.active === true && 'is-active')

export function HostNavRailPrimaryNav({ ariaLabel, className, items }: HostNavRailPrimaryNavProps) {
  if (items.length === 0) return null

  return (
    <nav className={classNames('host-nav-rail__primary-nav', className)} aria-label={ariaLabel}>
      {items.map(item => {
        const content = (
          <>
            {item.icon == null ? null : (
              <span className='host-nav-rail__primary-item-icon' aria-hidden='true'>
                {item.icon}
              </span>
            )}
            <span className='host-nav-rail__primary-item-label'>{item.label}</span>
          </>
        )

        return item.href == null
          ? (
            <button
              key={item.id}
              type='button'
              className={hostNavRailItemClassName(item)}
              disabled={item.disabled}
              aria-current={item.active === true ? 'page' : undefined}
              onClick={item.onSelect}
            >
              {content}
            </button>
          )
          : (
            <a
              key={item.id}
              className={hostNavRailItemClassName(item)}
              href={item.href}
              aria-current={item.active === true ? 'page' : undefined}
              onClick={event => {
                if (item.disabled === true) {
                  event.preventDefault()
                  return
                }
                item.onSelect?.()
              }}
            >
              {content}
            </a>
          )
      })}
    </nav>
  )
}

export const HostNavRailFooterButton = forwardRef<HTMLButtonElement, HostNavRailFooterButtonProps>(
  (
    {
      active = false,
      className,
      icon,
      label,
      trailingIcon,
      title,
      type = 'button',
      ...buttonProps
    },
    ref
  ) => (
    <button
      {...buttonProps}
      ref={ref}
      type={type}
      className={classNames('host-nav-rail__footer-button', active && 'is-active', className)}
      title={title}
    >
      {icon == null ? null : (
        <span className='host-nav-rail__footer-button-icon' aria-hidden='true'>
          {icon}
        </span>
      )}
      <span className='host-nav-rail__footer-button-label'>{label}</span>
      {trailingIcon == null ? null : (
        <span className='host-nav-rail__footer-button-trailing' aria-hidden='true'>
          {trailingIcon}
        </span>
      )}
    </button>
  )
)

HostNavRailFooterButton.displayName = 'HostNavRailFooterButton'
