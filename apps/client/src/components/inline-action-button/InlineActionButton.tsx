import './InlineActionButton.scss'

import { Button } from 'antd'
import type { ButtonProps } from 'antd'
import type { ReactNode } from 'react'
import { forwardRef } from 'react'

export interface InlineActionButtonProps extends Omit<ButtonProps, 'danger' | 'icon' | 'type'> {
  icon: ReactNode | string
  tone?: 'default' | 'danger'
}

const renderInlineActionIcon = (icon: ReactNode | string) => {
  if (typeof icon !== 'string') return icon
  return <span className='material-symbols-rounded' aria-hidden='true'>{icon}</span>
}

export const InlineActionButton = forwardRef<HTMLButtonElement, InlineActionButtonProps>(({
  children,
  className,
  htmlType = 'button',
  icon,
  size = 'small',
  tone = 'default',
  ...rest
}, ref) => {
  const mergedClassName = [
    'oneworks-inline-action-button',
    tone === 'danger' ? 'is-danger' : '',
    className
  ].filter(Boolean).join(' ')

  return (
    <Button
      {...rest}
      ref={ref}
      className={mergedClassName}
      htmlType={htmlType}
      icon={renderInlineActionIcon(icon)}
      size={size}
      type='text'
    >
      {children}
    </Button>
  )
})

InlineActionButton.displayName = 'InlineActionButton'
