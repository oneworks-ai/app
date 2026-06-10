import type { HostSidebarQuickLinkItem } from '@oneworks/route-layout'
import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { canAccessRelayAdminSection } from '../shared/model/adminPermissions'
import type { RelayAdminRole } from '../shared/model/adminTypes'
import { AdminNavIcon } from './AdminNavIcon'

export type AdminSectionId = 'devices' | 'users' | 'invites' | 'sso'

type AdminSectionDefinition = Omit<HostSidebarQuickLinkItem, 'active' | 'disabled' | 'key' | 'onSelect'> & {
  id: AdminSectionId
  path: string
}

export const adminSections = [
  {
    icon: <AdminNavIcon name='devices' />,
    id: 'devices',
    label: '设备',
    path: '/devices'
  },
  {
    icon: <AdminNavIcon name='users' />,
    id: 'users',
    label: '用户',
    path: '/users'
  },
  {
    icon: <AdminNavIcon name='invites' />,
    id: 'invites',
    label: '邀请码',
    path: '/invites'
  },
  {
    icon: <AdminNavIcon name='sso' />,
    id: 'sso',
    label: 'SSO',
    path: '/sso'
  }
] satisfies AdminSectionDefinition[]

const normalizeAdminPath = (pathname: string) =>
  pathname === '' || pathname === '/' ? '/' : pathname.replace(/\/+$/, '')

export const useAdminSectionNavigation = (role?: RelayAdminRole) => {
  const location = useLocation()
  const navigate = useNavigate()
  const activePath = normalizeAdminPath(location.pathname)
  const permittedSections = useMemo(
    () => adminSections.filter(section => canAccessRelayAdminSection(role, section.id)),
    [role]
  )
  const matchedSection = permittedSections.find(section => (
    activePath === section.path || activePath.startsWith(`${section.path}/`)
  ))
  const activeSection = matchedSection ?? permittedSections[0] ?? adminSections[0]
  const activeSectionId = matchedSection?.id
  const sidebarItems = useMemo<HostSidebarQuickLinkItem[]>(
    () =>
      permittedSections.map(item => ({
        active: item.id === activeSectionId,
        icon: item.icon,
        key: item.id,
        label: item.label,
        onSelect: () => {
          void navigate(item.path)
        }
      })),
    [activeSectionId, navigate, permittedSections]
  )

  return {
    activeSection,
    activeSectionId,
    sidebarItems
  }
}

export const useAdminSidebarItems = (role?: RelayAdminRole) => useAdminSectionNavigation(role).sidebarItems
