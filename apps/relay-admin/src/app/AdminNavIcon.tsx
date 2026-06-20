import { AdminIcon } from '../shared/ui/AdminIcon'
import type { AdminIconName } from '../shared/ui/AdminIcon'

export type AdminNavIconName =
  | 'access-groups'
  | 'devices'
  | 'users'
  | 'invites'
  | 'message-pushes'
  | 'openapi'
  | 'sso'
  | 'teams'

const iconByName: Record<AdminNavIconName, AdminIconName> = {
  'access-groups': 'badge',
  devices: 'hub',
  invites: 'key',
  'message-pushes': 'notifications',
  openapi: 'fact_check',
  sso: 'link',
  teams: 'admin_panel_settings',
  users: 'group'
}

export interface AdminNavIconProps {
  name: AdminNavIconName
}

export const AdminNavIcon = ({ name }: AdminNavIconProps) => (
  <AdminIcon className='sidebar-header__quick-link-icon' name={iconByName[name]} />
)
