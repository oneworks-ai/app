import './AdminActionButton.css'

import { Button, Tooltip } from 'antd'
import type { ButtonProps, TooltipProps } from 'antd'
import { forwardRef } from 'react'
import type { ReactNode } from 'react'

import { AdminIcon } from './AdminIcon'
import type { AdminIconName } from './AdminIcon'

export interface AdminActionButtonProps extends Omit<ButtonProps, 'icon'> {
  iconName?: AdminIconName
  tooltip?: ReactNode | false
  tooltipPlacement?: TooltipProps['placement']
}

export const AdminActionButton = forwardRef<HTMLAnchorElement | HTMLButtonElement, AdminActionButtonProps>(
  (
    {
      'aria-label': ariaLabel,
      children,
      className,
      iconName,
      title,
      tooltip,
      tooltipPlacement = 'top',
      ...buttonProps
    },
    ref
  ) => {
    const iconOnly = iconName != null && children == null
    const tooltipTitle = tooltip === false
      ? undefined
      : tooltip ?? (iconOnly ? title ?? ariaLabel : undefined)
    const disabled = buttonProps.disabled === true
    const button = (
      <Button
        {...buttonProps}
        ref={ref}
        aria-label={ariaLabel}
        className={['relay-admin-action-button', className].filter(Boolean).join(' ')}
        icon={iconName == null ? undefined : <AdminIcon name={iconName} />}
        title={tooltipTitle == null ? title : undefined}
      >
        {children}
      </Button>
    )

    if (tooltipTitle == null) return button

    if (!disabled) {
      return (
        <Tooltip placement={tooltipPlacement} title={tooltipTitle} trigger={['hover', 'focus']}>
          {button}
        </Tooltip>
      )
    }

    return (
      <Tooltip placement={tooltipPlacement} title={tooltipTitle} trigger={['hover', 'focus']}>
        <span className='relay-admin-action-button__tooltip-target'>
          {button}
        </span>
      </Tooltip>
    )
  }
)

AdminActionButton.displayName = 'AdminActionButton'
