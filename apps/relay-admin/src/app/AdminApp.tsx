/* eslint-disable max-lines -- relay admin app owns auth, navigation, permissions, and route header wiring. */
import '@oneworks/route-layout/design-tokens.css'
import '@oneworks/route-layout/styles.css'
import '@oneworks/components/route-layout.css'
import './AdminApp.css'

import { RouteContainerHeader } from '@oneworks/components/route-layout'
import type { RouteContainerHeaderActionItem } from '@oneworks/components/route-layout'
import {
  HostAppShell,
  HostNavRailWindowBar,
  RouteContainerLayout,
  usePanelResize,
  useResponsiveLayout
} from '@oneworks/route-layout'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'

import { AdminDashboard } from '../features/dashboard/AdminDashboard'
import type { AdminDashboardCreateSectionId } from '../features/dashboard/AdminDashboard'
import { useRelayAdminDashboard } from '../features/dashboard/useRelayAdminDashboard'
import { UserPasswordModal } from '../features/users/UserPasswordModal'
import { canAccessRelayAdminSection } from '../shared/model/adminPermissions'
import type { RelayAdminUser } from '../shared/model/adminTypes'
import { AdminIcon } from '../shared/ui/AdminIcon'
import { AdminNavRail } from './AdminNavRail'
import { useAdminRouteHeaderBreadcrumb } from './useAdminRouteHeaderBreadcrumb'
import { useAdminSectionNavigation } from './useAdminSidebarItems'

const ADMIN_SIDEBAR_WIDTH_KEY = 'relay-admin.sidebarWidth'
const DEFAULT_ADMIN_SIDEBAR_WIDTH = 212
const MIN_ADMIN_SIDEBAR_WIDTH = 180
const MAX_ADMIN_SIDEBAR_WIDTH = 520

const clampAdminSidebarWidth = (width: number) =>
  Math.min(MAX_ADMIN_SIDEBAR_WIDTH, Math.max(MIN_ADMIN_SIDEBAR_WIDTH, width))

const createSectionLabels: Record<AdminDashboardCreateSectionId, string> = {
  invites: '邀请码',
  sso: 'SSO',
  teams: '团队',
  users: '用户'
}

const getCreateSectionIdFromPath = (pathname: string): AdminDashboardCreateSectionId | undefined => {
  if (pathname === '/users') return 'users'
  if (pathname === '/invites') return 'invites'
  if (pathname === '/sso') return 'sso'
  if (pathname === '/teams') return 'teams'
  return undefined
}

const getUserDetailIdFromPath = (pathname: string) => {
  const match = /^\/users\/([^/]+)$/.exec(pathname)
  return match == null ? undefined : decodeURIComponent(match[1])
}

const getTeamDetailIdFromPath = (pathname: string) => {
  const match = /^\/teams\/([^/]+)(?:\/(?:members|profiles|secrets))?$/.exec(pathname)
  return match == null ? undefined : decodeURIComponent(match[1])
}

const TeamDetailDefaultRoute = () => {
  const { teamId } = useParams()
  if (teamId == null) return <Navigate to='/teams' replace />
  return <Navigate to={`/teams/${encodeURIComponent(teamId)}/members`} replace />
}

const readAdminSidebarWidth = () => {
  if (typeof window === 'undefined') return DEFAULT_ADMIN_SIDEBAR_WIDTH

  const storedValue = window.localStorage.getItem(ADMIN_SIDEBAR_WIDTH_KEY)
  if (storedValue == null) return DEFAULT_ADMIN_SIDEBAR_WIDTH

  const stored = Number(storedValue)
  return Number.isFinite(stored) ? clampAdminSidebarWidth(stored) : DEFAULT_ADMIN_SIDEBAR_WIDTH
}

export const AdminApp = () => {
  const dashboard = useRelayAdminDashboard()
  const location = useLocation()
  const navigate = useNavigate()
  const { activeSection, activeSectionId, sidebarItems } = useAdminSectionNavigation(dashboard.currentUser?.role)
  const { isCompactLayout } = useResponsiveLayout()
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(() => readAdminSidebarWidth())
  const [createSectionId, setCreateSectionId] = useState<AdminDashboardCreateSectionId | undefined>()
  const [passwordUser, setPasswordUser] = useState<RelayAdminUser | undefined>()
  const canResizeSidebar = !isCompactLayout && !sidebarCollapsed
  const commitSidebarWidth = useCallback((nextWidth: number) => {
    const resolvedWidth = clampAdminSidebarWidth(nextWidth)
    setSidebarWidth(resolvedWidth)

    try {
      window.localStorage.setItem(ADMIN_SIDEBAR_WIDTH_KEY, String(resolvedWidth))
    } catch {}
  }, [])
  const sidebarResize = usePanelResize({
    axis: 'x',
    cursor: 'col-resize',
    disabled: !canResizeSidebar,
    max: MAX_ADMIN_SIDEBAR_WIDTH,
    min: MIN_ADMIN_SIDEBAR_WIDTH,
    value: sidebarWidth,
    onCommit: commitSidebarWidth,
    onPreview: setSidebarWidth
  })
  const desktopLayoutStyle = useMemo(() => ({
    '--nav-rail-drawer-width': `${sidebarWidth}px`,
    '--route-workbench-sidebar-width': !isCompactLayout && sidebarCollapsed ? '0px' : `${sidebarWidth}px`
  } as CSSProperties), [isCompactLayout, sidebarCollapsed, sidebarWidth])
  const headerBreadcrumb = useAdminRouteHeaderBreadcrumb(location.pathname, dashboard)
  const normalizedPathname = location.pathname === '/' ? '/' : location.pathname.replace(/\/+$/, '')
  const isProfileRoute = normalizedPathname === '/profile'
  const isTeamListRoute = normalizedPathname === '/teams'
  const activeCreateSectionId = getCreateSectionIdFromPath(normalizedPathname)
  const activeUserDetailId = getUserDetailIdFromPath(normalizedPathname)
  const activeTeamDetailId = getTeamDetailIdFromPath(normalizedPathname)
  const activeUserDetail = activeUserDetailId == null
    ? undefined
    : dashboard.users.find(user => user.id === activeUserDetailId)
  const activeTeamDetail = activeTeamDetailId == null
    ? undefined
    : dashboard.teams.find(team => team.id === activeTeamDetailId)
  const headerTitle = isProfileRoute ? '个人资料' : activeSection.label
  const headerIcon = isProfileRoute ? <AdminIcon name='account_circle' /> : activeSection.icon
  const isCreateActionActive = activeCreateSectionId != null && createSectionId === activeCreateSectionId
  const canRenderSection = useCallback((sectionId: 'devices' | 'invites' | 'sso' | 'teams' | 'users') => (
    dashboard.authStatus === 'checking' ||
    canAccessRelayAdminSection(dashboard.currentUser?.role, sectionId)
  ), [dashboard.authStatus, dashboard.currentUser?.role])
  const headerTitleContent = useMemo(() =>
    headerBreadcrumb == null
      ? (
        <span className='relay-admin-route-header-title'>
          {headerIcon == null ? null : (
            <span className='relay-admin-route-header-title__icon' aria-hidden='true'>
              {headerIcon}
            </span>
          )}
          <span className='relay-admin-route-header-title__text'>
            {headerTitle}
          </span>
        </span>
      )
      : undefined, [headerBreadcrumb, headerIcon, headerTitle])
  const headerActionItems = useMemo(() => {
    const items: RouteContainerHeaderActionItem[] = []

    if (isProfileRoute) {
      items.push({
        danger: true,
        disabled: dashboard.token === '',
        icon: <AdminIcon name='logout' />,
        key: 'profile:logout',
        label: '退出登录',
        title: '退出登录',
        onSelect: dashboard.logout
      })
    }

    if (activeUserDetail != null) {
      items.push({
        disabled: !dashboard.canLoad || dashboard.loading,
        icon: <AdminIcon name='key' />,
        key: 'user:password',
        label: activeUserDetail.passwordEnabled ? '重置密码' : '设置密码',
        title: activeUserDetail.passwordEnabled ? '重置密码' : '设置密码',
        onSelect: () => setPasswordUser(activeUserDetail)
      })
      items.push({
        danger: !activeUserDetail.disabled,
        disabled: !dashboard.canLoad || dashboard.loading,
        icon: <AdminIcon name={activeUserDetail.disabled ? 'check' : 'disabled_by_default'} />,
        key: 'user:disable',
        label: activeUserDetail.disabled ? '启用账号' : '禁用账号',
        title: activeUserDetail.disabled ? '启用账号' : '禁用账号',
        onSelect: () => void dashboard.setUserDisabled(activeUserDetail, !activeUserDetail.disabled)
      })
    }

    if (activeTeamDetail != null) {
      items.push({
        disabled: !dashboard.canLoad || dashboard.loading,
        icon: <AdminIcon name='admin_panel_settings' />,
        key: 'team:settings',
        label: '团队设置',
        title: '团队设置',
        onSelect: () => void navigate(`/teams/${encodeURIComponent(activeTeamDetail.id)}/settings`)
      })
    }

    if (activeCreateSectionId != null) {
      const createSectionLabel = createSectionLabels[activeCreateSectionId]

      items.push({
        active: isCreateActionActive,
        activeIcon: <AdminIcon name='close' />,
        activeLabel: `关闭${createSectionLabel}新建`,
        activeTitle: `关闭${createSectionLabel}新建`,
        disabled: !dashboard.canLoad || (dashboard.loading && !isCreateActionActive),
        icon: <AdminIcon name='add' />,
        key: `${activeCreateSectionId}:create`,
        label: `新建${createSectionLabel}`,
        title: `新建${createSectionLabel}`,
        onSelect: () => {
          setCreateSectionId(current => current === activeCreateSectionId ? undefined : activeCreateSectionId)
        }
      })
    }

    if (isTeamListRoute) {
      items.push({
        disabled: !dashboard.canLoad || dashboard.loading,
        icon: <AdminIcon name='admin_panel_settings' />,
        key: 'teams:settings',
        label: '团队设置',
        title: '团队设置',
        onSelect: () => void navigate('/teams/settings')
      })
    }

    if (!isProfileRoute) {
      items.push({
        disabled: !dashboard.canLoad || dashboard.loading,
        icon: <AdminIcon name='refresh' />,
        key: 'refresh',
        label: 'Refresh',
        loading: dashboard.loading,
        onSelect: () => void dashboard.refresh()
      })
    }

    return items
  }, [
    activeCreateSectionId,
    activeTeamDetail,
    activeUserDetail,
    dashboard.canLoad,
    dashboard.loading,
    dashboard.logout,
    dashboard.refresh,
    dashboard.setUserDisabled,
    dashboard.token,
    isCreateActionActive,
    isProfileRoute,
    isTeamListRoute,
    navigate
  ])

  useEffect(() => {
    if (createSectionId == null || createSectionId === activeCreateSectionId) return
    setCreateSectionId(undefined)
  }, [activeCreateSectionId, createSectionId])

  return (
    <>
      <HostAppShell
        className='relay-admin-workbench'
        closeLabel='关闭'
        desktopLayoutStyle={desktopLayoutStyle}
        desktopChrome={context => (
          <HostNavRailWindowBar
            collapseLabel='收起侧边栏'
            drawerWidth={sidebarWidth}
            expandLabel='展开侧边栏'
            filledIcon={<AdminIcon name={context.sidebarCollapsed ? 'left_panel_open' : 'left_panel_close'} filled />}
            icon={<AdminIcon name={context.sidebarCollapsed ? 'left_panel_open' : 'left_panel_close'} />}
            isCollapsed={context.sidebarCollapsed}
            isPreviewOpen={context.sidebarPreviewOpen}
            showToggleLabel
            onPointerEnter={context.openSidebarPreview}
            onPointerLeave={context.scheduleSidebarPreviewClose}
            onToggleCollapsed={() => setSidebarCollapsed(current => !current)}
          />
        )}
        desktopSidebar={context => (
          <AdminNavRail
            drawerWidth={sidebarWidth}
            isCollapsed={context.sidebarCollapsed}
            isPreviewOpen={context.sidebarPreviewOpen}
            isResizing={sidebarResize.isResizing}
            accounts={dashboard.accounts}
            activeToken={dashboard.token}
            currentUser={dashboard.currentUser}
            items={sidebarItems}
            loginUrl={dashboard.loginUrl}
            resizeHandle={canResizeSidebar
              ? {
                label: '拖拽调整侧边栏宽度',
                max: MAX_ADMIN_SIDEBAR_WIDTH,
                min: MIN_ADMIN_SIDEBAR_WIDTH,
                value: sidebarWidth,
                onKeyDown: sidebarResize.handleKeyDown,
                onPointerDown: sidebarResize.handlePointerDown
              }
              : undefined}
            onLogout={dashboard.logout}
            onPointerEnter={context.openSidebarPreview}
            onPointerLeave={context.scheduleSidebarPreviewClose}
            onSelectAccount={dashboard.selectAccount}
          />
        )}
        contentClassName='relay-admin-workbench__content'
        contentRegionClassName='relay-admin-workbench__content-region'
        isCompactLayout={isCompactLayout}
        isMobileSidebarOpen={isMobileSidebarOpen}
        mobileSidebar={() => (
          <AdminNavRail
            accounts={dashboard.accounts}
            activeToken={dashboard.token}
            currentUser={dashboard.currentUser}
            items={sidebarItems}
            loginUrl={dashboard.loginUrl}
            onLogout={dashboard.logout}
            onSelectAccount={dashboard.selectAccount}
          />
        )}
        mobileSidebarBackdropClassName='relay-admin-workbench__mobile-backdrop'
        mobileSidebarBackdropOpenClassName='is-open'
        mobileSidebarSheetClassName='relay-admin-workbench__mobile-sheet'
        mobileSidebarSheetOpenClassName='is-open'
        onMobileSidebarOpenChange={setIsMobileSidebarOpen}
        routeSidebarAriaLabel='Relay 管理'
        sidebarCollapsed={sidebarCollapsed}
        sidebarRegionClassName='relay-admin-workbench__sidebar-region'
        showSidebar
      >
        <RouteContainerLayout
          className='relay-admin-route'
          bodyClassName='relay-admin-route__body'
          contentInset
          header={
            <RouteContainerHeader
              actionItems={headerActionItems}
              breadcrumb={headerBreadcrumb}
              collapsed={!isCompactLayout && sidebarCollapsed}
              icon={headerIcon}
              title={headerTitle}
              titleContent={headerTitleContent}
            />
          }
          location={location}
          surfaceClassName='relay-admin-route__surface'
        >
          <main className='relay-admin'>
            <Routes>
              <Route index element={<Navigate to='/devices' replace />} />
              <Route path='devices' element={<AdminDashboard dashboard={dashboard} sectionId='devices' />} />
              <Route
                path='devices/:deviceId'
                element={<AdminDashboard dashboard={dashboard} sectionId='device-detail' />}
              />
              <Route
                path='users'
                element={canRenderSection('users')
                  ? (
                    <AdminDashboard
                      createSectionId={createSectionId}
                      dashboard={dashboard}
                      sectionId='users'
                      onCreateSectionChange={setCreateSectionId}
                    />
                  )
                  : <Navigate to='/devices' replace />}
              />
              <Route
                path='users/:userId'
                element={canRenderSection('users')
                  ? <AdminDashboard dashboard={dashboard} sectionId='user-detail' />
                  : <Navigate to='/devices' replace />}
              />
              <Route path='profile' element={<AdminDashboard dashboard={dashboard} sectionId='profile' />} />
              <Route
                path='invites'
                element={canRenderSection('invites')
                  ? (
                    <AdminDashboard
                      createSectionId={createSectionId}
                      dashboard={dashboard}
                      sectionId='invites'
                      onCreateSectionChange={setCreateSectionId}
                    />
                  )
                  : <Navigate to='/devices' replace />}
              />
              <Route
                path='sso'
                element={canRenderSection('sso')
                  ? (
                    <AdminDashboard
                      createSectionId={createSectionId}
                      dashboard={dashboard}
                      sectionId='sso'
                      onCreateSectionChange={setCreateSectionId}
                    />
                  )
                  : <Navigate to='/devices' replace />}
              />
              <Route
                path='teams'
                element={canRenderSection('teams')
                  ? (
                    <AdminDashboard
                      createSectionId={createSectionId}
                      dashboard={dashboard}
                      sectionId='teams'
                      onCreateSectionChange={setCreateSectionId}
                    />
                  )
                  : <Navigate to='/devices' replace />}
              />
              <Route
                path='teams/settings'
                element={canRenderSection('teams')
                  ? <AdminDashboard dashboard={dashboard} sectionId='team-settings' />
                  : <Navigate to='/devices' replace />}
              />
              <Route
                path='teams/:teamId/settings'
                element={canRenderSection('teams')
                  ? <AdminDashboard dashboard={dashboard} sectionId='team-detail-settings' />
                  : <Navigate to='/devices' replace />}
              />
              <Route
                path='teams/:teamId/:tabKey'
                element={canRenderSection('teams')
                  ? <AdminDashboard dashboard={dashboard} sectionId='team-detail' />
                  : <Navigate to='/devices' replace />}
              />
              <Route
                path='teams/:teamId'
                element={canRenderSection('teams')
                  ? <TeamDetailDefaultRoute />
                  : <Navigate to='/devices' replace />}
              />
              <Route path='*' element={<Navigate to='/devices' replace />} />
            </Routes>
          </main>
        </RouteContainerLayout>
      </HostAppShell>
      <UserPasswordModal
        user={passwordUser}
        onClose={() => setPasswordUser(undefined)}
        onSetPassword={dashboard.setUserPassword}
      />
    </>
  )
}
