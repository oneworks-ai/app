import { AdminIcon } from '../shared/ui/AdminIcon'
import type { AdminIconName } from '../shared/ui/AdminIcon'

export type AdminNavIconName = 'devices' | 'users' | 'invites' | 'sso'

const iconByName: Record<AdminNavIconName, AdminIconName> = {
  devices: 'hub',
  invites: 'key',
  sso: 'link',
  users: 'group'
}

export interface AdminNavIconProps {
  name: AdminNavIconName
}

export const AdminNavIcon = ({ name }: AdminNavIconProps) => (
  <AdminIcon className='sidebar-header__quick-link-icon' name={iconByName[name]} />
)
