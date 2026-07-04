/* eslint-disable max-lines -- app shell coordinates responsive sidebar, desktop chrome, and shortcuts. */
import '@oneworks/route-layout/styles.css'
import './AppShell.scss'

import { useAtom, useSetAtom } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PropsWithChildren } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import useSWR from 'swr'

import type { Session } from '@oneworks/core'
import { HostAppShell } from '@oneworks/route-layout'
import type { ModuleUpdateGroup, ModuleUpdatesResponse } from '@oneworks/types'

import { getModuleUpdates } from '#~/api'
import { NavRail, NavRailWindowBar } from '#~/components/NavRail'
import type { NavRailWindowBarAction } from '#~/components/NavRail'
import { Sidebar } from '#~/components/Sidebar'
import type { SidebarRoomItem } from '#~/components/sidebar/conversation-items'
import {
  emptyDesktopUpdateStatus,
  hasVisibleDesktopUpdateAction,
  normalizeDesktopUpdateStatus
} from '#~/desktop/update-status'
import {
  addDesktopViewShortcutListener,
  desktopViewShortcutSpecs,
  emitDesktopViewShortcut,
  isDesktopViewShortcutAction
} from '#~/desktop/view-shortcuts'
import type { DesktopViewShortcutAction } from '#~/desktop/view-shortcuts'
import { useBrowserHistoryNavigationState } from '#~/hooks/use-browser-history-navigation-state'
import { useResponsiveLayout } from '#~/hooks/use-responsive-layout'
import { useSidebarQueryState } from '#~/hooks/use-sidebar-query-state'
import { isMobileSidebarOpenAtom, isSidebarCollapsedAtom } from '#~/store/index'
import {
  DESKTOP_SHELL_SIMULATION_QUERY_PARAM,
  parseDesktopShellSimulationValue,
  readDesktopShellSimulationMode,
  useStoredDevShellSimulation
} from '#~/utils/device-shell-simulation'
import { isShortcutMatch } from '#~/utils/shortcutUtils'

import { DesktopWorkspaceStartupProvider } from './DesktopWorkspaceStartupOverlay'
import { useDesktopWorkspaceStartupReady } from './desktop-workspace-startup-ready'
import { MOBILE_SIDEBAR_DIALOG_ID } from './mobile-sidebar-constants'
import {
  RouteSidebarProvider,
  mergeRouteMoreMenuOverrides,
  mergeRouteWindowBarOverrides
} from './route-sidebar-context'
import type { RouteMoreMenuOverride, RouteSidebarOverride, RouteWindowBarOverride } from './route-sidebar-context'

interface AppShellProps extends PropsWithChildren {
  activeId?: string
  isDarkMode: boolean
  onDeletedSession: (deletedId: string, nextId?: string) => void
  onSelectRoom: (room: SidebarRoomItem) => void
  onSelectSession: (session: Session, isNew?: boolean) => void
  showSidebar: boolean
  sidebarWidth: number
}

const FULLSCREEN_SIZE_TOLERANCE = 2
const DESKTOP_SIMULATION_QUERY_VALUE = 'macos'
const DESKTOP_SIMULATION_FULLSCREEN_QUERY_PARAM = '__oneworks_fullscreen'
const DESKTOP_SIMULATION_TOGGLE_KEY_COUNT = 5
const DESKTOP_SIMULATION_TOGGLE_SEQUENCE_MS = 2_000
const GLOBAL_MODULE_UPDATE_GROUPS = new Set<ModuleUpdateGroup>(['adapter', 'core'])
const APP_SHELL_STARTUP_READY_SELECTOR = '.app-shell'

const isSearchParamEnabled = (value: string | null) => {
  if (value == null) return false

  const normalizedValue = value.trim().toLowerCase()
  return normalizedValue === '' ||
    normalizedValue === '1' ||
    normalizedValue === 'true' ||
    normalizedValue === 'yes' ||
    normalizedValue === 'fullscreen'
}

const isDesktopSimulationFullscreenEnabled = (search: string) => {
  const searchParams = new URLSearchParams(search)
  return isSearchParamEnabled(searchParams.get(DESKTOP_SIMULATION_FULLSCREEN_QUERY_PARAM))
}

const toggleMacosDesktopSimulationSearch = (search: string) => {
  const searchParams = new URLSearchParams(search)
  if (parseDesktopShellSimulationValue(searchParams.get(DESKTOP_SHELL_SIMULATION_QUERY_PARAM)) === 'macos') {
    searchParams.delete(DESKTOP_SHELL_SIMULATION_QUERY_PARAM)
  } else {
    searchParams.set(DESKTOP_SHELL_SIMULATION_QUERY_PARAM, DESKTOP_SIMULATION_QUERY_VALUE)
  }

  const nextSearch = searchParams.toString()
  return nextSearch === '' ? '' : `?${nextSearch}`
}

const isCommandKeyEvent = (event: KeyboardEvent) => (
  event.key === 'Meta' ||
  event.code === 'MetaLeft' ||
  event.code === 'MetaRight'
)

const isLikelyNativeFullscreen = () => {
  if (typeof window === 'undefined' || window.oneworksDesktop?.platform !== 'darwin') {
    return false
  }

  return Math.abs(window.outerWidth - window.screen.width) <= FULLSCREEN_SIZE_TOLERANCE &&
    Math.abs(window.outerHeight - window.screen.height) <= FULLSCREEN_SIZE_TOLERANCE
}

const readWindowFullscreenState = () => (
  document.fullscreenElement != null ||
  window.matchMedia?.('(display-mode: fullscreen)').matches === true ||
  isLikelyNativeFullscreen()
)

function AppShellStartupReadySignal() {
  useDesktopWorkspaceStartupReady(true, { visibleSelector: APP_SHELL_STARTUP_READY_SELECTOR })
  return null
}

export function AppShell({
  activeId,
  children,
  isDarkMode,
  onDeletedSession,
  onSelectRoom,
  onSelectSession,
  showSidebar,
  sidebarWidth
}: AppShellProps) {
  const { t } = useTranslation()
  const { isSidebarCollapsed, setSidebarCollapsed } = useSidebarQueryState()
  const location = useLocation()
  const navigate = useNavigate()
  const { isCompactLayout } = useResponsiveLayout()
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useAtom(isMobileSidebarOpenAtom)
  const setIsSidebarCollapsed = useSetAtom(isSidebarCollapsedAtom)
  const [routeSidebar, setRouteSidebarState] = useState<RouteSidebarOverride | null>(null)
  const [routeWindowBarOverrides, setRouteWindowBarOverrides] = useState<Record<string, RouteWindowBarOverride>>({})
  const [routeMoreMenuOverrides, setRouteMoreMenuOverrides] = useState<Record<string, RouteMoreMenuOverride>>({})
  const isDesktopSidebarCollapsed = !isCompactLayout && isSidebarCollapsed
  const isMac = navigator.platform.includes('Mac')
  const desktopApi = window.oneworksDesktop
  const storedDevShellSimulation = useStoredDevShellSimulation()
  const desktopSimulationMode = useMemo(
    () => readDesktopShellSimulationMode(location.search, storedDevShellSimulation),
    [location.search, storedDevShellSimulation]
  )
  const isDesktopSimulationFullscreen = useMemo(
    () => isDesktopSimulationFullscreenEnabled(location.search),
    [location.search]
  )
  const isDesktopShell = desktopApi != null || desktopSimulationMode != null
  const isMacDesktopSimulation = desktopSimulationMode === 'macos'
  const isMacDesktop = isMacDesktopSimulation ||
    (desktopApi != null && (desktopApi.platform === 'darwin' || isMac))
  const isMacShortcutLayout = isMacDesktop || isMac
  const isDesktopSimulation = desktopSimulationMode != null
  const hasDesktopViewShortcut = desktopApi?.onViewShortcut != null
  const [isWindowFullscreen, setIsWindowFullscreen] = useState(false)
  const [desktopUpdateStatus, setDesktopUpdateStatus] = useState<DesktopUpdateStatus>(emptyDesktopUpdateStatus)
  const isWindowFullscreenVisual = isWindowFullscreen || isDesktopSimulationFullscreen
  const shouldReserveWindowControls = isMacDesktop && !isWindowFullscreenVisual
  const showSimulatedWindowControls = isMacDesktopSimulation && shouldReserveWindowControls
  const nativeWindowFullscreenRef = useRef(false)
  const desktopSimulationKeySequenceRef = useRef({
    count: 0,
    lastReleasedAt: 0,
    sawNonCommandKeyDuringPress: false
  })
  const {
    canGoBack,
    canGoForward,
    goBack,
    goForward
  } = useBrowserHistoryNavigationState()
  const { data: moduleUpdateData } = useSWR<ModuleUpdatesResponse>(
    '/api/module-updates',
    getModuleUpdates,
    {
      dedupingInterval: 60_000,
      refreshInterval: 300_000,
      shouldRetryOnError: false
    }
  )
  const setRouteSidebar = useCallback((override: RouteSidebarOverride) => {
    setRouteSidebarState(override)
  }, [])
  const clearRouteSidebar = useCallback((key: string) => {
    setRouteSidebarState(current => current?.key === key ? null : current)
  }, [])
  const setRouteWindowBar = useCallback((override: RouteWindowBarOverride) => {
    setRouteWindowBarOverrides(current => ({ ...current, [override.key]: override }))
  }, [])
  const clearRouteWindowBar = useCallback((key: string) => {
    setRouteWindowBarOverrides(current => {
      if (current[key] == null) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }, [])
  const setRouteMoreMenu = useCallback((override: RouteMoreMenuOverride) => {
    setRouteMoreMenuOverrides(current => ({ ...current, [override.key]: override }))
  }, [])
  const clearRouteMoreMenu = useCallback((key: string) => {
    setRouteMoreMenuOverrides(current => {
      if (current[key] == null) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }, [])
  const routeWindowBar = useMemo(
    () => mergeRouteWindowBarOverrides(routeWindowBarOverrides),
    [routeWindowBarOverrides]
  )
  const routeMoreMenu = useMemo(
    () => mergeRouteMoreMenuOverrides(routeMoreMenuOverrides),
    [routeMoreMenuOverrides]
  )
  const routeSidebarContextValue = useMemo(() => ({
    clearRouteMoreMenu,
    clearRouteWindowBar,
    clearRouteSidebar,
    hasRouteSidebarProvider: true,
    routeMoreMenu,
    routeSidebar,
    routeWindowBar,
    setRouteMoreMenu,
    setRouteSidebar,
    setRouteWindowBar
  }), [
    clearRouteMoreMenu,
    clearRouteSidebar,
    clearRouteWindowBar,
    routeMoreMenu,
    routeSidebar,
    routeWindowBar,
    setRouteMoreMenu,
    setRouteSidebar,
    setRouteWindowBar
  ])

  useEffect(() => {
    setIsSidebarCollapsed(isCompactLayout ? false : isSidebarCollapsed)
  }, [isCompactLayout, isSidebarCollapsed, setIsSidebarCollapsed])

  useEffect(() => {
    let disposed = false
    const statusPromise = desktopApi?.getUpdateStatus?.()
    if (statusPromise == null) {
      setDesktopUpdateStatus(emptyDesktopUpdateStatus)
      return
    }

    void statusPromise.then((value) => {
      if (!disposed) {
        setDesktopUpdateStatus(normalizeDesktopUpdateStatus(value))
      }
    }).catch((error) => {
      console.error('[app-shell] failed to load desktop update status', error)
    })

    const dispose = desktopApi?.onUpdateStatusChange?.((value) => {
      setDesktopUpdateStatus(normalizeDesktopUpdateStatus(value))
    })

    return () => {
      disposed = true
      dispose?.()
    }
  }, [desktopApi])

  useEffect(() => {
    let disposed = false
    void window.oneworksDesktop?.getWindowFullscreenState?.().then((isFullscreen) => {
      nativeWindowFullscreenRef.current = isFullscreen
      if (!disposed) {
        setIsWindowFullscreen(isFullscreen || readWindowFullscreenState())
      }
    })
    const unsubscribe = window.oneworksDesktop?.onWindowFullscreenChange?.((isFullscreen) => {
      nativeWindowFullscreenRef.current = isFullscreen
      setIsWindowFullscreen(isFullscreen || readWindowFullscreenState())
    })
    const refreshFullscreenState = () => {
      setIsWindowFullscreen(nativeWindowFullscreenRef.current || readWindowFullscreenState())
    }
    window.addEventListener('resize', refreshFullscreenState)
    document.addEventListener('fullscreenchange', refreshFullscreenState)
    refreshFullscreenState()
    return () => {
      disposed = true
      window.removeEventListener('resize', refreshFullscreenState)
      document.removeEventListener('fullscreenchange', refreshFullscreenState)
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    setIsMobileSidebarOpen(false)
  }, [isCompactLayout, location.pathname, setIsMobileSidebarOpen])

  useEffect(() => {
    if (!isCompactLayout) {
      return
    }

    setIsMobileSidebarOpen(false)
  }, [isCompactLayout, setIsMobileSidebarOpen])

  const toggleSidebar = useCallback(() => {
    if (isCompactLayout) {
      setIsMobileSidebarOpen(current => !current)
      return
    }

    setSidebarCollapsed(!isSidebarCollapsed)
  }, [isCompactLayout, isSidebarCollapsed, setIsMobileSidebarOpen, setSidebarCollapsed])

  const emitFindShortcut = useCallback(() => {
    if (isCompactLayout) {
      setIsMobileSidebarOpen(true)
    } else if (isSidebarCollapsed) {
      setSidebarCollapsed(false)
    }

    window.setTimeout(() => emitDesktopViewShortcut('find', { source: 'app-shell' }), 50)
  }, [isCompactLayout, isSidebarCollapsed, setIsMobileSidebarOpen, setSidebarCollapsed])

  const handleRootViewShortcut = useCallback((action: DesktopViewShortcutAction) => {
    if (action === 'toggle-sidebar') {
      toggleSidebar()
      return true
    }

    if (action === 'back') {
      goBack()
      return true
    }

    if (action === 'forward') {
      goForward()
      return true
    }

    if (action === 'find') {
      emitFindShortcut()
      return true
    }

    return false
  }, [emitFindShortcut, goBack, goForward, toggleSidebar])

  const handleViewShortcut = useCallback((action: DesktopViewShortcutAction) => {
    if (handleRootViewShortcut(action)) {
      return
    }

    emitDesktopViewShortcut(action, { source: 'app-shell' })
  }, [handleRootViewShortcut])

  useEffect(() =>
    addDesktopViewShortcutListener((action, detail) => {
      if (detail.source === 'app-shell') return
      handleRootViewShortcut(action)
    }), [handleRootViewShortcut])

  useEffect(() => {
    const unsubscribeViewShortcut = window.oneworksDesktop?.onViewShortcut?.((action) => {
      if (!isDesktopViewShortcutAction(action)) return
      handleViewShortcut(action)
    })
    const unsubscribeLegacyToggle = unsubscribeViewShortcut == null
      ? window.oneworksDesktop?.onToggleSidebarShortcut?.(() => handleViewShortcut('toggle-sidebar'))
      : undefined
    return () => {
      unsubscribeViewShortcut?.()
      unsubscribeLegacyToggle?.()
    }
  }, [handleViewShortcut])

  useEffect(() => {
    if (hasDesktopViewShortcut) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const matchedShortcut = desktopViewShortcutSpecs.find(item => isShortcutMatch(event, item.shortcut, isMac))
      if (matchedShortcut == null) return
      if (!showSidebar && matchedShortcut.action === 'toggle-sidebar') return

      event.preventDefault()
      event.stopPropagation()
      handleViewShortcut(matchedShortcut.action)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [handleViewShortcut, hasDesktopViewShortcut, isMac, showSidebar])

  useEffect(() => {
    if (desktopApi != null) {
      return
    }

    const resetSequence = () => {
      desktopSimulationKeySequenceRef.current = {
        count: 0,
        lastReleasedAt: 0,
        sawNonCommandKeyDuringPress: false
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isCommandKeyEvent(event)) {
        return
      }

      if (event.metaKey) {
        desktopSimulationKeySequenceRef.current.sawNonCommandKeyDuringPress = true
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (!isCommandKeyEvent(event)) {
        return
      }

      const sequence = desktopSimulationKeySequenceRef.current
      if (sequence.sawNonCommandKeyDuringPress) {
        resetSequence()
        return
      }

      const now = performance.now()
      sequence.count = now - sequence.lastReleasedAt <= DESKTOP_SIMULATION_TOGGLE_SEQUENCE_MS
        ? sequence.count + 1
        : 1
      sequence.lastReleasedAt = now

      if (sequence.count < DESKTOP_SIMULATION_TOGGLE_KEY_COUNT) {
        return
      }

      resetSequence()
      void navigate({
        hash: location.hash,
        pathname: location.pathname,
        search: toggleMacosDesktopSimulationSearch(location.search)
      }, { replace: true })
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('blur', resetSequence)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('blur', resetSequence)
    }
  }, [desktopApi, location.hash, location.pathname, location.search, navigate])

  const handleDesktopUpdateAction = useCallback(() => {
    if (desktopApi?.checkForUpdates == null) return

    void desktopApi.checkForUpdates({ interactive: true })
      .then(value => setDesktopUpdateStatus(normalizeDesktopUpdateStatus(value)))
      .catch((error) => {
        console.error('[app-shell] failed to start desktop update', error)
      })
  }, [desktopApi])

  const globalModuleUpdateModules = useMemo(() => (
    (moduleUpdateData?.modules ?? [])
      .filter(item => GLOBAL_MODULE_UPDATE_GROUPS.has(item.group) && item.updateAvailable)
  ), [moduleUpdateData?.modules])

  const handleModuleUpdateAction = useCallback(() => {
    if (globalModuleUpdateModules.length === 0) return
    void navigate('/modules?review=global')
  }, [globalModuleUpdateModules.length, navigate])

  const desktopUpdateAction = useMemo<NavRailWindowBarAction | undefined>(() => {
    if (desktopApi?.checkForUpdates == null || !hasVisibleDesktopUpdateAction(desktopUpdateStatus)) {
      return undefined
    }

    const updateVersion = desktopUpdateStatus.updateVersion ?? desktopUpdateStatus.currentVersion
    const progressLabel = `${Math.round(desktopUpdateStatus.progress ?? 0)}%`
    const label = desktopUpdateStatus.status === 'downloaded'
      ? t('navRail.updateReady', { version: updateVersion })
      : desktopUpdateStatus.status === 'downloading'
      ? t('navRail.updateDownloading', { progress: progressLabel, version: updateVersion })
      : t('navRail.updateAvailable', { version: updateVersion })

    return {
      active: true,
      disabled: desktopUpdateStatus.status === 'downloading',
      icon: 'system_update_alt',
      key: 'desktop-update',
      label,
      onSelect: handleDesktopUpdateAction,
      ...(desktopUpdateStatus.status === 'downloading'
        ? { progress: Math.round(desktopUpdateStatus.progress ?? 0) }
        : {}),
      title: label
    }
  }, [desktopApi, desktopUpdateStatus, handleDesktopUpdateAction, t])

  const moduleUpdateAction = useMemo<NavRailWindowBarAction | undefined>(() => {
    const available = globalModuleUpdateModules.length
    if (available === 0) {
      return undefined
    }

    const label = t('navRail.moduleUpdateAvailable', { count: available })

    return {
      active: true,
      icon: 'system_update_alt',
      key: 'module-update',
      label,
      onSelect: handleModuleUpdateAction,
      title: label
    }
  }, [globalModuleUpdateModules.length, handleModuleUpdateAction, t])

  const visibleUpdateAction = desktopUpdateAction ?? moduleUpdateAction

  const resolvedSidebarWidth = isCompactLayout ? Math.min(sidebarWidth, 320) : sidebarWidth
  const desktopDrawerWidth = showSidebar ? sidebarWidth : 212
  const desktopSidebarRegionWidth = isDesktopSidebarCollapsed ? 0 : desktopDrawerWidth
  const routeWindowBarActions = routeWindowBar?.actions ?? []
  const routeWindowBarActionCount = routeWindowBarActions.length
  const updateActionCount = visibleUpdateAction == null ? 0 : 1
  const isCreateSessionActive = location.pathname === '/'
  const hideCreateSessionAction = routeWindowBar?.hideCreateSessionAction === true
  const shouldReserveCreateSessionAction = !hideCreateSessionAction && !isCreateSessionActive
  const desktopLayoutStyle = useMemo<CSSProperties>(() => {
    const baseStyle = {
      '--nav-rail-drawer-width': `${desktopDrawerWidth}px`,
      '--route-workbench-sidebar-width': `${desktopSidebarRegionWidth}px`
    } as CSSProperties

    if (!isDesktopSidebarCollapsed) {
      return baseStyle
    }

    const navigationActionCount = isDesktopShell ? 2 : 0
    const collapsedContentActionCount = (shouldReserveCreateSessionAction ? 1 : 0) +
      updateActionCount +
      routeWindowBarActionCount
    const actionCount = 1 + navigationActionCount + collapsedContentActionCount
    return {
      ...baseStyle,
      '--nav-rail-collapsed-window-bar-action-count': actionCount,
      '--nav-rail-collapsed-window-bar-padding-left': shouldReserveWindowControls
        ? 'var(--nav-rail-traffic-light-action-offset)'
        : 'var(--route-container-header-padding-inline)',
      '--nav-rail-collapsed-window-bar-padding-right': shouldReserveWindowControls
        ? 'var(--route-container-header-padding-inline)'
        : 'var(--nav-rail-window-action-gap)',
      '--nav-rail-collapsed-window-spacer-width': '0px',
      '--nav-rail-collapsed-window-bar-width': 'var(--nav-rail-collapsed-window-bar-computed-width)'
    } as CSSProperties
  }, [
    desktopDrawerWidth,
    desktopSidebarRegionWidth,
    isDesktopShell,
    isDesktopSidebarCollapsed,
    routeWindowBarActionCount,
    shouldReserveCreateSessionAction,
    shouldReserveWindowControls,
    updateActionCount
  ])
  const routeSidebarAriaLabel = routeSidebar?.ariaLabel ?? t('common.navigation')
  const contentClassName = [
    'app-shell__content',
    showSidebar ? 'app-shell__content--session' : '',
    routeSidebar != null ? 'app-shell__content--route-sidebar' : '',
    isDesktopSidebarCollapsed ? 'is-sidebar-collapsed' : '',
    showSidebar ? '' : 'is-flat'
  ].filter(Boolean).join(' ')
  const mobileSidebar = (
    <div className='app-shell__mobile-sidebar-surface'>
      <NavRail
        isCompactLayout
        compactPlacement='drawer'
        drawerFooterAfter={routeMoreMenu?.footerAfter}
        drawerFooterBefore={routeMoreMenu?.footerBefore}
        moreMenuContextMenuSections={routeMoreMenu?.contextMenuSections}
        moreMenuSections={routeMoreMenu?.sections}
        moreMenuSelectedKeys={routeMoreMenu?.selectedKeys}
        showSidebar={showSidebar}
        onCompactAction={() => setIsMobileSidebarOpen(false)}
      />
      {showSidebar && (
        <div className='app-shell__mobile-sidebar-panel'>
          <Sidebar
            width={resolvedSidebarWidth}
            activeId={activeId}
            onSelectRoom={(room) => {
              setIsMobileSidebarOpen(false)
              onSelectRoom(room)
            }}
            onSelectSession={(session, isNew) => {
              setIsMobileSidebarOpen(false)
              onSelectSession(session, isNew)
            }}
            onDeletedSession={(deletedId, nextId) => {
              setIsMobileSidebarOpen(false)
              onDeletedSession(deletedId, nextId)
            }}
            isCompactLayout
            isMobileOpen={isMobileSidebarOpen}
            onRequestClose={() => setIsMobileSidebarOpen(false)}
          />
        </div>
      )}
    </div>
  )
  const shellClassName = [
    'app-shell',
    isCompactLayout ? 'app-shell--compact' : '',
    isDarkMode ? 'app-shell--dark' : '',
    isWindowFullscreenVisual ? 'is-window-fullscreen' : '',
    !isCompactLayout && shouldReserveWindowControls ? 'app-shell--window-controls-reserved' : '',
    isDesktopSimulation ? 'app-shell--desktop-simulation' : '',
    isMacDesktop ? 'app-shell--macos-vibrancy' : ''
  ].filter(Boolean).join(' ')

  return (
    <DesktopWorkspaceStartupProvider>
      <AppShellStartupReadySignal />
      <RouteSidebarProvider value={routeSidebarContextValue}>
        <HostAppShell
          className={shellClassName}
          closeLabel={t('common.close')}
          contentClassName={contentClassName}
          contentRegionClassName='app-shell__content-region'
          contentRegionCollapsedClassName='is-sidebar-collapsed'
          desktopLayoutStyle={desktopLayoutStyle}
          isCompactLayout={isCompactLayout}
          isMobileSidebarOpen={isMobileSidebarOpen}
          mobileSidebar={() => mobileSidebar}
          mobileSidebarBackdropClassName='app-shell__mobile-sidebar-backdrop'
          mobileSidebarBackdropOpenClassName='is-open'
          mobileSidebarSheetClassName={[
            'app-shell__mobile-sidebar-sheet',
            showSidebar
              ? 'app-shell__mobile-sidebar-sheet--with-sidebar'
              : 'app-shell__mobile-sidebar-sheet--nav-only'
          ].filter(Boolean).join(' ')}
          mobileSidebarSheetId={MOBILE_SIDEBAR_DIALOG_ID}
          mobileSidebarSheetOpenClassName='is-open'
          onMobileSidebarOpenChange={setIsMobileSidebarOpen}
          routeSidebarAriaLabel={routeSidebarAriaLabel}
          sidebarCollapsed={isSidebarCollapsed}
          sidebarEdgeSwipeZoneClassName='app-shell__sidebar-edge-swipe-zone'
          sidebarPreviewDismissLayerClassName='app-shell__sidebar-preview-dismiss-layer'
          sidebarRegionClassName='app-shell__sidebar-region'
          showSidebar={showSidebar}
          desktopChrome={(
            { closeSidebarPreview, openSidebarPreview, scheduleSidebarPreviewClose, sidebarPreviewOpen }
          ) => (
            <NavRailWindowBar
              canGoBack={canGoBack}
              canGoForward={canGoForward}
              collapsedActions={routeWindowBarActions}
              drawerWidth={showSidebar ? sidebarWidth : undefined}
              isMacShortcutLayout={isMacShortcutLayout}
              onNavigateBack={goBack}
              onNavigateForward={goForward}
              onCreateSession={() => onSelectSession({ id: '' } as Session, true)}
              onSidebarPreviewClose={closeSidebarPreview}
              onSidebarPreviewPointerEnter={openSidebarPreview}
              onSidebarPreviewPointerLeave={scheduleSidebarPreviewClose}
              onToggleSidebarCollapsed={() => setSidebarCollapsed(!isSidebarCollapsed)}
              reserveWindowControls={shouldReserveWindowControls}
              showCreateSessionActiveIndicator={!hideCreateSessionAction}
              showCreateSessionControl={!hideCreateSessionAction}
              showHistoryNavigation={isDesktopShell}
              showSimulatedWindowControls={showSimulatedWindowControls}
              showToggleSidebarLabel={!isDesktopShell}
              sidebarCollapsed={isSidebarCollapsed}
              sidebarPreviewOpen={sidebarPreviewOpen}
              updateAction={visibleUpdateAction}
            />
          )}
          desktopSidebar={({ openSidebarPreview, scheduleSidebarPreviewClose, sidebarPreviewOpen }) => (
            <NavRail
              drawerFooterAfter={routeMoreMenu?.footerAfter}
              drawerFooterBefore={routeMoreMenu?.footerBefore}
              drawerWidth={showSidebar ? sidebarWidth : undefined}
              moreMenuContextMenuSections={routeMoreMenu?.contextMenuSections}
              moreMenuSections={routeMoreMenu?.sections}
              moreMenuSelectedKeys={routeMoreMenu?.selectedKeys}
              onOpenSidebar={() => setSidebarCollapsed(false)}
              onSidebarPreviewPointerEnter={openSidebarPreview}
              onSidebarPreviewPointerLeave={scheduleSidebarPreviewClose}
              sidebarCollapsed={isSidebarCollapsed}
              sidebarPreviewOpen={sidebarPreviewOpen}
              showSidebar={showSidebar}
            >
              {showSidebar && (
                <Sidebar
                  width={sidebarWidth}
                  activeId={activeId}
                  embeddedInNavRail
                  onSelectRoom={onSelectRoom}
                  onSelectSession={onSelectSession}
                  onDeletedSession={onDeletedSession}
                />
              )}
            </NavRail>
          )}
        >
          {children}
        </HostAppShell>
      </RouteSidebarProvider>
    </DesktopWorkspaceStartupProvider>
  )
}
