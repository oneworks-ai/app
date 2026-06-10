import './ActionButton.scss'

import React from 'react'

import { Button } from 'antd'
import type { ButtonProps } from 'antd'

export const ActionButton = React.forwardRef<HTMLButtonElement, ButtonProps>(({
  className,
  children,
  icon,
  ...rest
}, ref) => {
  const iconOnly = icon != null && (children == null || children === false)
  const mergedClassName = [
    'knowledge-base-view__action-button',
    iconOnly ? 'knowledge-base-view__action-button--icon-only' : '',
    className
  ].filter(Boolean).join(' ')

  return (
    <Button {...rest} ref={ref} icon={icon} className={mergedClassName}>
      {children}
    </Button>
  )
})
