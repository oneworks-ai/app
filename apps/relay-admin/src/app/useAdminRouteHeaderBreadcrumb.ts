import type { RouteContainerHeaderBreadcrumb } from '@oneworks/route-layout'
import { createElement, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'

import type { RelayAdminDashboardState } from '../features/dashboard/useRelayAdminDashboard'
import { AdminIcon } from '../shared/ui/AdminIcon'

const breadcrumbIconClassName = 'route-container-header__breadcrumb-material-icon'

const decodeRouteSegment = (value: string | undefined) => {
  if (value == null) return undefined
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const adminUserDisplayName = (user: { email: string; name: string }) => user.name.trim() || user.email

export const useAdminRouteHeaderBreadcrumb = (
  pathname: string,
  dashboard: Pick<RelayAdminDashboardState, 'currentUser' | 'devices' | 'users'>
): RouteContainerHeaderBreadcrumb | undefined => {
  const navigate = useNavigate()
  const normalizedPathname = pathname.replace(/\/+$/, '')
  const deviceDetailId = useMemo(() => {
    const match = /^\/devices\/([^/]+)$/.exec(normalizedPathname)
    return decodeRouteSegment(match?.[1])
  }, [normalizedPathname])
  const userDetailId = useMemo(() => {
    const match = /^\/users\/([^/]+)$/.exec(normalizedPathname)
    return decodeRouteSegment(match?.[1])
  }, [normalizedPathname])
  const deviceDetailTitle = useMemo(() => {
    if (deviceDetailId == null) return undefined
    return dashboard.devices.find(item => item.id === deviceDetailId)?.name ?? '设备详情'
  }, [dashboard.devices, deviceDetailId])
  const userDetailTitle = useMemo(() => {
    if (userDetailId == null) return undefined
    const user = dashboard.users.find(item => item.id === userDetailId)
    if (user != null) return adminUserDisplayName(user)
    return dashboard.currentUser?.id === userDetailId ? adminUserDisplayName(dashboard.currentUser) : '账号详情'
  }, [dashboard.currentUser, dashboard.users, userDetailId])

  return useMemo(() => {
    if (deviceDetailId != null) {
      return {
        ariaLabel: '设备导航',
        backIcon: createElement(AdminIcon, { className: breadcrumbIconClassName, name: 'chevron_left' }),
        backLabel: '返回设备列表',
        currentTitle: deviceDetailTitle,
        parentTitle: '设备',
        separatorIcon: createElement(AdminIcon, { className: breadcrumbIconClassName, name: 'chevron_right' }),
        onBack: () => void navigate('/devices')
      }
    }

    return userDetailId == null
      ? undefined
      : {
        ariaLabel: '账号导航',
        backIcon: createElement(AdminIcon, { className: breadcrumbIconClassName, name: 'chevron_left' }),
        backLabel: '返回用户列表',
        currentTitle: userDetailTitle,
        parentTitle: '用户',
        separatorIcon: createElement(AdminIcon, { className: breadcrumbIconClassName, name: 'chevron_right' }),
        onBack: () => void navigate('/users')
      }
  }, [deviceDetailId, deviceDetailTitle, navigate, userDetailId, userDetailTitle])
}
