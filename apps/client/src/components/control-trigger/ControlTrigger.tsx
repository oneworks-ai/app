import './ControlTrigger.scss'

import type { ButtonHTMLAttributes } from 'react'
import { forwardRef } from 'react'

export type ControlTriggerVariant = 'content' | 'overlay'

export interface ControlTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ControlTriggerVariant
}

const mergeClassNames = (...classNames: Array<false | null | string | undefined>) =>
  classNames.filter(Boolean).join(' ') || undefined

export const ControlTrigger = forwardRef<HTMLButtonElement, ControlTriggerProps>(
  (
    {
      children,
      className,
      onKeyDown,
      type = 'button',
      variant = 'content',
      ...buttonProps
    },
    ref
  ) => {
    return (
      <button
        {...buttonProps}
        ref={ref}
        type={type}
        className={mergeClassNames(
          'oneworks-control-trigger',
          `oneworks-control-trigger--${variant}`,
          className
        )}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          if (onKeyDown != null || (event.key !== 'Enter' && event.key !== ' ')) {
            return
          }
          event.preventDefault()
          event.currentTarget.click()
        }}
      >
        {children}
      </button>
    )
  }
)

ControlTrigger.displayName = 'ControlTrigger'
