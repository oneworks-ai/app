import './AdminTabs.css'

import type { ReactNode } from 'react'

import { AdminIcon } from './AdminIcon'
import type { AdminIconName } from './AdminIcon'

export interface AdminTabLabelProps {
  children: ReactNode
  iconName: AdminIconName
}

export const AdminTabLabel = ({ children, iconName }: AdminTabLabelProps) => (
  <span className='relay-admin-tab-label'>
    <AdminIcon name={iconName} />
    <span>{children}</span>
  </span>
)
