import { forwardRef } from 'react'
import type { ComponentPropsWithoutRef } from 'react'

export interface RouteHeaderActionGroupProps extends Omit<ComponentPropsWithoutRef<'span'>, 'className'> {
  className?: string
  joined?: boolean
}

export const RouteHeaderActionGroup = forwardRef<HTMLSpanElement, RouteHeaderActionGroupProps>(({
  className,
  joined = false,
  ...props
}, ref) => {
  return (
    <span
      {...props}
      ref={ref}
      className={[
        'route-container-header__action-group',
        joined ? 'is-joined' : '',
        className
      ].filter(Boolean).join(' ')}
    />
  )
})

RouteHeaderActionGroup.displayName = 'RouteHeaderActionGroup'
