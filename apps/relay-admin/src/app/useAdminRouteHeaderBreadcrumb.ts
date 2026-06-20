/* eslint-disable max-lines -- Admin route breadcrumb mapping is kept in one hook to avoid split route tables. */

import type { RouteContainerHeaderBreadcrumb } from '@oneworks/components/route-layout'
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
  dashboard: Pick<RelayAdminDashboardState, 'accessGroups' | 'currentUser' | 'devices' | 'teams' | 'users'>
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
  const isAccessGroupCreateRoute = normalizedPathname === '/access-groups/new'
  const accessGroupDetailId = useMemo(() => {
    if (isAccessGroupCreateRoute) return undefined
    const match = /^\/access-groups\/([^/]+)$/.exec(normalizedPathname)
    return decodeRouteSegment(match?.[1])
  }, [isAccessGroupCreateRoute, normalizedPathname])
  const profileTokenRoute = useMemo(() => {
    const match = /^\/profile\/tokens\/([^/]+)$/.exec(normalizedPathname)
    return decodeRouteSegment(match?.[1])
  }, [normalizedPathname])
  const messageDetailId = useMemo(() => {
    if (normalizedPathname === '/messages/create') return undefined
    const match = /^\/messages\/(.+)$/.exec(normalizedPathname)
    return decodeRouteSegment(match?.[1])
  }, [normalizedPathname])
  const isMessagePushCreateRoute = normalizedPathname === '/message-pushes/create'
  const messagePushDetailId = useMemo(() => {
    if (isMessagePushCreateRoute) return undefined
    const match = /^\/message-pushes\/(.+)$/.exec(normalizedPathname)
    return decodeRouteSegment(match?.[1])
  }, [isMessagePushCreateRoute, normalizedPathname])
  const isTeamSettingsRoute = normalizedPathname === '/teams/settings'
  const teamDetailSettingsId = useMemo(() => {
    const match = /^\/teams\/([^/]+)\/settings$/.exec(normalizedPathname)
    return decodeRouteSegment(match?.[1])
  }, [normalizedPathname])
  const teamAccessGroupRoute = useMemo(() => {
    const match = /^\/teams\/([^/]+)\/groups\/([^/]+)$/.exec(normalizedPathname)
    const teamId = decodeRouteSegment(match?.[1])
    const groupId = decodeRouteSegment(match?.[2])
    if (teamId == null || groupId == null) return undefined
    return { groupId, teamId }
  }, [normalizedPathname])
  const teamDetailId = useMemo(() => {
    if (isTeamSettingsRoute) return undefined
    const match = /^\/teams\/([^/]+)(?:\/(?:audit|groups|members|profiles|secrets)(?:\/[^/]+)?)?$/.exec(
      normalizedPathname
    )
    return decodeRouteSegment(match?.[1])
  }, [isTeamSettingsRoute, normalizedPathname])
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
  const teamDetailTitle = useMemo(() => {
    if (teamDetailId == null) return undefined
    return dashboard.teams.find(item => item.id === teamDetailId)?.name ?? '团队详情'
  }, [dashboard.teams, teamDetailId])
  const teamDetailSettingsTitle = useMemo(() => {
    if (teamDetailSettingsId == null) return undefined
    return dashboard.teams.find(item => item.id === teamDetailSettingsId)?.name ?? '团队详情'
  }, [dashboard.teams, teamDetailSettingsId])
  const accessGroupDetailTitle = useMemo(() => {
    if (accessGroupDetailId == null) return undefined
    return dashboard.accessGroups.find(item => item.id === accessGroupDetailId)?.name ?? '用户组详情'
  }, [accessGroupDetailId, dashboard.accessGroups])
  const teamAccessGroupTeamTitle = useMemo(() => {
    if (teamAccessGroupRoute == null) return undefined
    return dashboard.teams.find(item => item.id === teamAccessGroupRoute.teamId)?.name ?? '团队详情'
  }, [dashboard.teams, teamAccessGroupRoute])
  const teamAccessGroupTitle = useMemo(() => {
    if (teamAccessGroupRoute == null) return undefined
    if (teamAccessGroupRoute.groupId === 'new') return '新建成员组'
    const team = dashboard.teams.find(item => item.id === teamAccessGroupRoute.teamId)
    return team?.accessGroups.find(group => group.id === teamAccessGroupRoute.groupId)?.name ?? '成员组详情'
  }, [dashboard.teams, teamAccessGroupRoute])

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

    if (userDetailId != null) {
      return {
        ariaLabel: '账号导航',
        backIcon: createElement(AdminIcon, { className: breadcrumbIconClassName, name: 'chevron_left' }),
        backLabel: '返回用户列表',
        currentTitle: userDetailTitle,
        parentTitle: '用户',
        separatorIcon: createElement(AdminIcon, { className: breadcrumbIconClassName, name: 'chevron_right' }),
        onBack: () => void navigate('/users')
      }
    }

    if (isAccessGroupCreateRoute) {
      return {
        ariaLabel: '用户组导航',
        backIcon: createElement(AdminIcon, { className: breadcrumbIconClassName, name: 'chevron_left' }),
        backLabel: '返回用户组列表',
        currentTitle: '新建用户组',
        parentTitle: '用户组',
        separatorIcon: createElement(AdminIcon, { className: breadcrumbIconClassName, name: 'chevron_right' }),
        onBack: () => void navigate('/access-groups')
      }
    }

    if (accessGroupDetailId != null) {
      return {
        ariaLabel: '用户组导航',
        backIcon: createElement(AdminIcon, { className: breadcrumbIconClassName, name: 'chevron_left' }),
        backLabel: '返回用户组列表',
        currentTitle: accessGroupDetailTitle,
        parentTitle: '用户组',
        separatorIcon: createElement(AdminIcon, { className: breadcrumbIconClassName, name: 'chevron_right' }),
        onBack: () => void navigate('/access-groups')
      }
    }

    if (profileTokenRoute != null) {
      return {
        ancestors: [{
          title: '令牌管理',
          onSelect: () => void navigate('/profile/tokens')
        }],
        ariaLabel: '个人资料导航',
        backIcon: createElement(AdminIcon, { className: breadcrumbIconClassName, name: 'chevron_left' }),
        backLabel: '返回令牌管理',
        currentTitle: profileTokenRoute === 'new' ? '生成令牌' : '令牌配置',
        parentTitle: '个人资料',
        separatorIcon: createElement(AdminIcon, { className: breadcrumbIconClassName, name: 'chevron_right' }),
        onBack: () => void navigate('/profile/tokens')
      }
    }

    if (messageDetailId != null) {
      return {
        ariaLabel: '消息导航',
        backIcon: createElement(AdminIcon, { className: breadcrumbIconClassName, name: 'chevron_left' }),
        backLabel: '返回消息中心',
        currentTitle: '消息详情',
        parentTitle: '消息中心',
        separatorIcon: createElement(AdminIcon, { className: breadcrumbIconClassName, name: 'chevron_right' }),
        onBack: () => void navigate('/messages')
      }
    }

    if (isMessagePushCreateRoute) {
      return {
        ariaLabel: '消息推送导航',
        backIcon: createElement(AdminIcon, { className: breadcrumbIconClassName, name: 'chevron_left' }),
        backLabel: '返回发送历史',
        currentTitle: '创建推送',
        parentTitle: '消息推送',
        separatorIcon: createElement(AdminIcon, { className: breadcrumbIconClassName, name: 'chevron_right' }),
        onBack: () => void navigate('/message-pushes')
      }
    }

    if (messagePushDetailId != null) {
      return {
        ariaLabel: '消息推送导航',
        backIcon: createElement(AdminIcon, { className: breadcrumbIconClassName, name: 'chevron_left' }),
        backLabel: '返回发送历史',
        currentTitle: '推送详情',
        parentTitle: '消息推送',
        separatorIcon: createElement(AdminIcon, { className: breadcrumbIconClassName, name: 'chevron_right' }),
        onBack: () => void navigate('/message-pushes')
      }
    }

    if (teamAccessGroupRoute != null) {
      return {
        ancestors: [
          {
            title: teamAccessGroupTeamTitle,
            onSelect: () => void navigate(`/teams/${encodeURIComponent(teamAccessGroupRoute.teamId)}/members`)
          },
          {
            title: '成员组',
            onSelect: () => void navigate(`/teams/${encodeURIComponent(teamAccessGroupRoute.teamId)}/groups`)
          }
        ],
        ariaLabel: '团队成员组导航',
        backIcon: createElement(AdminIcon, { className: breadcrumbIconClassName, name: 'chevron_left' }),
        backLabel: '返回成员组列表',
        currentTitle: teamAccessGroupTitle,
        parentTitle: '团队',
        separatorIcon: createElement(AdminIcon, { className: breadcrumbIconClassName, name: 'chevron_right' }),
        onBack: () => void navigate(`/teams/${encodeURIComponent(teamAccessGroupRoute.teamId)}/groups`)
      }
    }

    if (teamDetailId != null) {
      return {
        ariaLabel: '团队导航',
        backIcon: createElement(AdminIcon, { className: breadcrumbIconClassName, name: 'chevron_left' }),
        backLabel: '返回团队列表',
        currentTitle: teamDetailTitle,
        parentTitle: '团队',
        separatorIcon: createElement(AdminIcon, { className: breadcrumbIconClassName, name: 'chevron_right' }),
        onBack: () => void navigate('/teams')
      }
    }

    if (teamDetailSettingsId != null) {
      return {
        ancestors: [{
          title: teamDetailSettingsTitle,
          onSelect: () => void navigate(`/teams/${encodeURIComponent(teamDetailSettingsId)}/members`)
        }],
        ariaLabel: '团队导航',
        backIcon: createElement(AdminIcon, { className: breadcrumbIconClassName, name: 'chevron_left' }),
        backLabel: '返回团队详情',
        currentTitle: '团队设置',
        parentTitle: '团队',
        separatorIcon: createElement(AdminIcon, { className: breadcrumbIconClassName, name: 'chevron_right' }),
        onBack: () => void navigate(`/teams/${encodeURIComponent(teamDetailSettingsId)}/members`)
      }
    }

    if (isTeamSettingsRoute) {
      return {
        ariaLabel: '团队导航',
        backIcon: createElement(AdminIcon, { className: breadcrumbIconClassName, name: 'chevron_left' }),
        backLabel: '返回团队列表',
        currentTitle: '团队设置',
        parentTitle: '团队',
        separatorIcon: createElement(AdminIcon, { className: breadcrumbIconClassName, name: 'chevron_right' }),
        onBack: () => void navigate('/teams')
      }
    }

    return undefined
  }, [
    deviceDetailId,
    deviceDetailTitle,
    accessGroupDetailId,
    accessGroupDetailTitle,
    isAccessGroupCreateRoute,
    isMessagePushCreateRoute,
    isTeamSettingsRoute,
    messageDetailId,
    messagePushDetailId,
    navigate,
    profileTokenRoute,
    teamAccessGroupRoute,
    teamAccessGroupTeamTitle,
    teamAccessGroupTitle,
    teamDetailId,
    teamDetailSettingsId,
    teamDetailSettingsTitle,
    teamDetailTitle,
    userDetailId,
    userDetailTitle
  ])
}
