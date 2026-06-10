import './Overlay.scss'

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { forwardRef } from 'react'

import { mergeClassNames } from './overlay-utils'

export function OverlayIcon({
  children,
  className,
  icon
}: {
  children?: ReactNode
  className?: string
  icon?: ReactNode
}) {
  const content = icon ?? children

  if (typeof content === 'string') {
    return (
      <span className={mergeClassNames('material-symbols-rounded', 'oneworks-overlay-icon', className)}>
        {content}
      </span>
    )
  }

  return <span className={mergeClassNames('oneworks-overlay-icon', className)}>{content}</span>
}

export const OverlayPanel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>((
  { children, className, ...props },
  ref
) => {
  return (
    <div ref={ref} className={mergeClassNames('oneworks-overlay-panel', className)} {...props}>
      {children}
    </div>
  )
})
OverlayPanel.displayName = 'OverlayPanel'

export function OverlayDivider({
  className,
  decorative = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  decorative?: boolean
}) {
  return (
    <div
      className={mergeClassNames('oneworks-overlay-divider', className)}
      role={decorative ? undefined : 'separator'}
      aria-hidden={decorative ? true : props['aria-hidden']}
      {...props}
    />
  )
}

export const OverlayAction = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    confirming?: boolean
    danger?: boolean
    description?: ReactNode
    icon?: ReactNode
    selected?: boolean
    shortcut?: ReactNode
    submenu?: boolean
    submenuPlacement?: 'left' | 'right'
    trailing?: ReactNode
  }
>((
  {
    children,
    className,
    confirming = false,
    danger = false,
    description,
    icon,
    selected = false,
    shortcut,
    submenu = false,
    submenuPlacement = 'right',
    trailing,
    ...props
  },
  ref
) => {
  const submenuOpensLeft = submenu && submenuPlacement === 'left'

  return (
    <button
      ref={ref}
      type='button'
      className={mergeClassNames(
        'oneworks-overlay-action',
        selected && 'is-selected',
        confirming && 'is-confirming',
        danger && 'is-danger',
        submenu && 'has-submenu',
        className
      )}
      {...props}
    >
      {children ?? (
        <>
          {submenuOpensLeft && (
            <OverlayIcon className='oneworks-overlay-submenu-icon' icon='chevron_left' />
          )}
          {icon != null && !submenuOpensLeft && <OverlayIcon icon={icon} />}
          <span className={mergeClassNames('oneworks-overlay-action-label', description != null && 'has-description')}>
            <span className='oneworks-overlay-action-label__title'>{props['aria-label']}</span>
            {description != null && (
              <span className='oneworks-overlay-action-label__description'>{description}</span>
            )}
          </span>
          {shortcut != null && <span className='oneworks-overlay-shortcut'>{shortcut}</span>}
          {trailing}
          {submenuOpensLeft && icon != null && <OverlayIcon className='oneworks-overlay-icon--trailing' icon={icon} />}
          {submenu && !submenuOpensLeft && (
            <OverlayIcon
              className='oneworks-overlay-submenu-icon oneworks-overlay-submenu-icon--right'
              icon='chevron_right'
            />
          )}
        </>
      )}
    </button>
  )
})
OverlayAction.displayName = 'OverlayAction'

export const OverlayActionRow = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & {
    confirming?: boolean
    danger?: boolean
    disabled?: boolean
    selected?: boolean
  }
>((
  {
    children,
    className,
    confirming = false,
    danger = false,
    disabled = false,
    selected = false,
    ...props
  },
  ref
) => {
  return (
    <div
      ref={ref}
      className={mergeClassNames(
        'oneworks-overlay-action',
        selected && 'is-selected',
        confirming && 'is-confirming',
        danger && 'is-danger',
        disabled && 'is-disabled',
        className
      )}
      aria-disabled={disabled ? true : props['aria-disabled']}
      {...props}
    >
      {children}
    </div>
  )
})
OverlayActionRow.displayName = 'OverlayActionRow'
