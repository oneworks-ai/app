import './AdminActionButton.css'

import { Button } from 'antd'
import type { ButtonProps } from 'antd'
import { forwardRef } from 'react'

import { AdminIcon } from './AdminIcon'
import type { AdminIconName } from './AdminIcon'

export interface AdminActionButtonProps extends Omit<ButtonProps, 'icon'> {
  iconName?: AdminIconName
}

export const AdminActionButton = forwardRef<HTMLAnchorElement | HTMLButtonElement, AdminActionButtonProps>(
  ({ children, className, iconName, ...buttonProps }, ref) => (
    <Button
      {...buttonProps}
      ref={ref}
      className={['relay-admin-action-button', className].filter(Boolean).join(' ')}
      icon={iconName == null ? undefined : <AdminIcon name={iconName} />}
    >
      {children}
    </Button>
  )
)

AdminActionButton.displayName = 'AdminActionButton'
