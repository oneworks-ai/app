/* eslint-disable max-lines -- nav rail coordinates desktop controls and compact drawer placement. */
import './NavRail.scss'

import { Button, Dropdown, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import { useAtom, useSetAtom } from 'jotai'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import useSWR from 'swr'

import { ShortcutTooltip } from '@oneworks/components/route-layout'
import { DEFAULT_THEME_PRIMARY_COLOR, ONEWORKS_THEME_COLOR_PRESETS } from '@oneworks/icon/presets'
import { HostNavRail } from '@oneworks/route-layout'
import type { ConfigResponse } from '@oneworks/types'

import { getConfig, updateConfig } from '#~/api'
import { getCurrentWorkspaceBrowserActivityRouteState } from '#~/components/browser-activity/browser-activity-route-state'
import { renderIconAsset } from '#~/components/icons/IconAsset'
import type { IconAsset } from '#~/components/icons/IconAsset'
import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import {
  NAV_RAIL_MORE_CLOSE_DEFER_MS,
  NAV_RAIL_MORE_DROPDOWN_CLASS,
  NavRailMoreDropdown,
  buildNavRailMoreMenuItems,
  getNavRailMoreMenuSelectedKeys
} from '#~/components/nav-rail-more-menu'
import type { NavRailMoreMenuItem, NavRailMoreMenuSection } from '#~/components/nav-rail-more-menu'
import { OverlayPanel, OverlaySegmentedControl } from '#~/components/overlay'
import { getDesktopViewShortcut } from '#~/desktop/view-shortcuts'
import { getGlobalThemePrimaryColor } from '#~/hooks/use-app-preferences'
import { useExperiments } from '#~/hooks/use-experiments'
import { useInterfaceLanguageConfig } from '#~/hooks/use-interface-language-config'
import { usePanelResize } from '#~/hooks/use-panel-resize'
import { useResolvedThemeMode } from '#~/hooks/use-resolved-theme-mode'
import { appLanguageOptions, getActiveAppLanguageOption } from '#~/i18n'
import { resolvePluginContributionText } from '#~/plugins/plugin-i18n'
import type { PluginContributionMenuItem, PluginContributionNavItem } from '#~/plugins/plugin-manifest'
import { usePluginCommandExecutor, usePluginSlot } from '#~/plugins/plugin-slots'
import type { DevShellKind, DevShellOs } from '#~/utils/device-shell-simulation'
import { useStoredDevShellSimulation, writeStoredDevShellSimulation } from '#~/utils/device-shell-simulation'
import { createOneWorksIconDataUri } from '#~/utils/oneworks-icon'
import { isSidebarResizingAtom, sidebarWidthAtom, themeAtom } from '../store'
import type { ThemeMode } from '../store'
import { NavRailCompact } from './NavRailCompact'
import type { NavRailCompactMoreAction } from './NavRailCompact'
import { useNavRailAccountActions } from './nav-rail-account-actions'
import {
  buildCompactLanguageActions,
  buildCompactMoreActions,
  buildCompactThemeActions
} from './nav-rail-compact-config'
import { buildNavItems } from './nav-rail-items'

const MIN_SIDEBAR_WIDTH = 180
const MAX_SIDEBAR_WIDTH = 520

const clampSidebarWidth = (width: number) => Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width))

const appendMenuItemToLastSection = (
  sections: NavRailMoreMenuSection[],
  item: NavRailMoreMenuItem
): NavRailMoreMenuSection[] => {
  const lastSection = sections.at(-1)
  if (lastSection == null) {
    return [{ items: [item], key: item.key }]
  }

  return [
    ...sections.slice(0, -1),
    {
      ...lastSection,
      items: [...lastSection.items, item]
    }
  ]
}

type ScopedPluginMenuItem = Omit<PluginContributionMenuItem, 'children'> & {
  children?: PluginContributionMenuItem[]
  pluginScope: string
}

interface PluginFooterAccountPopoverAction {
  id: string
  title: string
  command?: string
  danger?: boolean
  disabled?: boolean
  href?: string
  icon?: string
  payload?: unknown
  route?: string
}

interface PluginFooterAccountPopoverAccount {
  actions?: PluginFooterAccountPopoverAction[]
  avatarUrl?: string
  command?: string
  description?: string
  disabled?: boolean
  href?: string
  id: string
  initials?: string
  name: string
  payload?: unknown
  route?: string
  status?: string
}

interface PluginFooterAccountPopoverGroup {
  accounts: PluginFooterAccountPopoverAccount[]
  avatarUrl?: string
  collapsed?: boolean
  id: string
  initials?: string
  title: string
}

interface PluginFooterAccountPopover {
  accounts?: PluginFooterAccountPopoverAccount[]
  actions?: PluginFooterAccountPopoverAction[]
  groups?: PluginFooterAccountPopoverGroup[]
}

type PluginFooterAccountPopoverItem = PluginContributionMenuItem & {
  accountPopover?: PluginFooterAccountPopover
}

type AccountPopoverMenuItems = NonNullable<MenuProps['items']>

const isPluginFooterAccountPopoverItem = <T extends PluginContributionMenuItem>(
  item: T
): item is T & PluginFooterAccountPopoverItem => (
  'accountPopover' in item && item.accountPopover != null && typeof item.accountPopover === 'object'
)

const getAccountPopoverGroups = (
  accountPopover: PluginFooterAccountPopover
): PluginFooterAccountPopoverGroup[] => {
  if (Array.isArray(accountPopover.groups) && accountPopover.groups.length > 0) return accountPopover.groups
  return [{
    accounts: Array.isArray(accountPopover.accounts) ? accountPopover.accounts : [],
    collapsed: false,
    id: 'accounts',
    title: ''
  }]
}

const getAccountPopoverActionIcon = (action: PluginFooterAccountPopoverAction) =>
  action.icon ?? (
    action.route != null ? 'badge' : action.command === 'login' ? 'login' : 'more_horiz'
  )

const notifyPluginRouteChange = (pluginScope: string, route: string) => {
  window.setTimeout(() => {
    window.dispatchEvent(
      new CustomEvent('oneworks:plugin-route-change', {
        detail: {
          pluginScope,
          route
        }
      })
    )
  }, 0)
}

const renderAccountPopoverActionIcon = (action: PluginFooterAccountPopoverAction, className = 'nav-menu-icon') => (
  <MaterialSymbol className={className} name={getAccountPopoverActionIcon(action)} aria-hidden='true' />
)

const renderAccountPopoverGroupIcon = (group: PluginFooterAccountPopoverGroup) => (
  <span className='nav-rail-account-menu-server-avatar' aria-hidden='true'>
    {group.avatarUrl == null || group.avatarUrl.trim() === ''
      ? <MaterialSymbol className='nav-rail-account-menu-server-avatar-symbol' name='hub' aria-hidden='true' />
      : <img src={group.avatarUrl} alt='' />}
  </span>
)

const renderAccountPopoverGroupLabel = (group: PluginFooterAccountPopoverGroup) => (
  <span className='nav-rail-account-menu-group-label'>
    <span className='nav-rail-account-menu-group-title'>{group.title}</span>
  </span>
)

const renderAccountPopoverExpandIcon = () => (
  <MaterialSymbol className='nav-menu-submenu-chevron' name='keyboard_arrow_right' aria-hidden='true' />
)

const renderAccountMenuItemLabel = ({
  account,
  onAction
}: {
  account: PluginFooterAccountPopoverAccount
  onAction: (action: PluginFooterAccountPopoverAction) => void
}) => {
  const hasPrimaryAction = account.route != null || account.href != null || account.command != null
  const description = account.description?.trim()
  const avatar = (
    <span className='nav-rail-account-menu-row__avatar' aria-hidden='true'>
      {account.avatarUrl == null || account.avatarUrl.trim() === ''
        ? <span>{account.initials ?? account.name.slice(0, 2).toUpperCase()}</span>
        : <img src={account.avatarUrl} alt='' />}
    </span>
  )
  const name = (
    <span className='nav-rail-account-menu-row__name'>{account.name}</span>
  )
  const identityContent = (
    <>
      {avatar}
      {name}
    </>
  )
  const identityClassName = [
    'nav-rail-account-menu-row__identity',
    hasPrimaryAction ? '' : 'is-static'
  ].filter(Boolean).join(' ')
  const identityNodeBase = hasPrimaryAction
    ? (
      <button
        type='button'
        className={identityClassName}
        disabled={account.disabled}
        aria-label={description == null || description === '' ? account.name : `${account.name} ${description}`}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (account.disabled === true) return
          onAction({
            command: account.command,
            disabled: account.disabled,
            href: account.href,
            id: `${account.id}:primary`,
            payload: account.payload,
            route: account.route,
            title: account.name
          })
        }}
      >
        {identityContent}
      </button>
    )
    : (
      <span
        className={identityClassName}
        aria-label={description == null || description === '' ? undefined : description}
      >
        {identityContent}
      </span>
    )
  const identityNode = description == null || description === ''
    ? identityNodeBase
    : (
      <Tooltip
        title={description}
        placement='right'
        mouseEnterDelay={0.45}
        mouseLeaveDelay={0.08}
        destroyOnHidden
      >
        {identityNodeBase}
      </Tooltip>
    )

  return (
    <span className='nav-rail-account-menu-row'>
      {identityNode}
      <span className='nav-rail-account-menu-row__actions'>
        {(account.actions ?? []).map(action => (
          <Button
            key={action.id}
            type='text'
            size='small'
            className={[
              'nav-rail-account-menu-row__action',
              action.danger === true ? 'is-danger' : ''
            ].filter(Boolean).join(' ')}
            aria-label={action.title}
            title={action.title}
            disabled={action.disabled}
            icon={renderAccountPopoverActionIcon(action, 'nav-rail-account-menu-row__action-icon')}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              if (action.disabled === true) return
              onAction(action)
            }}
          />
        ))}
      </span>
    </span>
  )
}

const buildAccountPopoverMenuItems = ({
  accountPopover,
  onAction
}: {
  accountPopover: PluginFooterAccountPopover
  onAction: (action: PluginFooterAccountPopoverAction) => void
}): AccountPopoverMenuItems => {
  const groups = getAccountPopoverGroups(accountPopover)
  const toAccountItem = (
    account: PluginFooterAccountPopoverAccount,
    index: number,
    total: number
  ): AccountPopoverMenuItems[number] => ({
    className: [
      'nav-rail-account-menu-item',
      index === 0 ? 'is-first-account' : '',
      index === total - 1 ? 'is-last-account' : ''
    ].filter(Boolean).join(' '),
    key: `account:${account.id}`,
    label: renderAccountMenuItemLabel({ account, onAction }),
    onClick: ({ domEvent }) => {
      domEvent.preventDefault()
      domEvent.stopPropagation()
    }
  })
  const accountItems = groups.flatMap((group): AccountPopoverMenuItems => {
    if (group.title.trim() === '') {
      return group.accounts.map((account, index) => toAccountItem(account, index, group.accounts.length))
    }

    return [{
      children: group.accounts.map((account, index) => toAccountItem(account, index, group.accounts.length)),
      className: 'nav-rail-account-menu-group',
      icon: renderAccountPopoverGroupIcon(group),
      key: `group:${group.id}`,
      label: renderAccountPopoverGroupLabel(group),
      popupClassName: 'nav-rail-more-submenu-dropdown nav-rail-account-menu-submenu'
    }]
  })
  const bottomActions = accountPopover.actions ?? []
  const bottomActionItems: AccountPopoverMenuItems = bottomActions.map((action): AccountPopoverMenuItems[number] => ({
    danger: action.danger,
    disabled: action.disabled,
    icon: renderAccountPopoverActionIcon(action),
    key: `action:${action.id}`,
    label: action.title,
    onClick: () => {
      if (action.disabled === true) return
      onAction(action)
    }
  }))
  return [
    ...accountItems,
    ...(bottomActions.length > 0 ? [{ type: 'divider' as const }] : []),
    ...bottomActionItems
  ]
}

export interface NavRailWindowBarAction {
  icon: IconAsset
  key: string
  label: string
  active?: boolean
  activeIcon?: IconAsset
  activeLabel?: string
  activeTitle?: string
  badge?: {
    animated?: boolean
    label?: string
    tone: 'error' | 'muted' | 'primary' | 'warning'
  }
  danger?: boolean
  disabled?: boolean
  previewOnHover?: 'sidebar'
  progress?: number
  shortcut?: string
  showTooltip?: boolean
  title?: string
  onPreviewClose?: () => void
  onPreviewOpen?: () => void
  onSelect?: () => void
}

export function NavRailWindowBar({
  canGoBack = false,
  canGoForward = false,
  collapsedActions = [],
  drawerWidth,
  isMacShortcutLayout,
  onCreateSession,
  onNavigateBack,
  onNavigateForward,
  onSidebarPreviewClose,
  onSidebarPreviewPointerEnter,
  onSidebarPreviewPointerLeave,
  onToggleSidebarCollapsed,
  reserveWindowControls = false,
  showCreateSessionActiveIndicator = true,
  showCreateSessionControl = true,
  showHistoryNavigation = true,
  showSimulatedWindowControls = false,
  showToggleSidebarLabel = false,
  sidebarCollapsed = false,
  sidebarPreviewOpen = false,
  updateAction
}: {
  canGoBack?: boolean
  canGoForward?: boolean
  collapsedActions?: NavRailWindowBarAction[]
  drawerWidth?: number
  isMacShortcutLayout?: boolean
  onCreateSession?: () => void
  onNavigateBack?: () => void
  onNavigateForward?: () => void
  onSidebarPreviewClose?: () => void
  onSidebarPreviewPointerEnter?: () => void
  onSidebarPreviewPointerLeave?: () => void
  onToggleSidebarCollapsed?: () => void
  reserveWindowControls?: boolean
  showCreateSessionActiveIndicator?: boolean
  showCreateSessionControl?: boolean
  showHistoryNavigation?: boolean
  showSimulatedWindowControls?: boolean
  showToggleSidebarLabel?: boolean
  sidebarCollapsed?: boolean
  sidebarPreviewOpen?: boolean
  updateAction?: NavRailWindowBarAction
}) {
  const { t } = useTranslation()
  const location = useLocation()
  const isMac = isMacShortcutLayout ?? navigator.platform.includes('Mac')
  const { data: configRes } = useSWR<ConfigResponse>('/api/config', getConfig)
  const newSessionShortcut = configRes?.sources?.merged?.shortcuts?.newSession
  const resolvedNewSessionShortcut = newSessionShortcut != null && newSessionShortcut.trim() !== ''
    ? newSessionShortcut
    : 'mod+k'
  const isCreateSessionActive = location.pathname === '/'
  const shouldRenderCreateSessionControl = showCreateSessionControl &&
    (!isCreateSessionActive || showCreateSessionActiveIndicator)
  const toggleSidebarIcon = sidebarCollapsed ? 'left_panel_open' : 'left_panel_close'
  const toggleSidebarTitle = sidebarCollapsed ? t('navRail.expandSidebar') : t('navRail.collapseSidebar')
  const showResolvedToggleSidebarLabel = showToggleSidebarLabel && !sidebarCollapsed
  const toggleSidebarLabel = t('navRail.collapsePanel')
  const resolvedToggleSidebarLabel = showResolvedToggleSidebarLabel ? toggleSidebarLabel : toggleSidebarTitle
  const windowBarTooltipPlacement = sidebarCollapsed ? 'bottomLeft' : 'bottom'
  const windowBarTooltipArrow = sidebarCollapsed ? { pointAtCenter: true } : undefined
  const toggleSidebarIconNode = (
    <span className='nav-rail-hover-fill-icon'>
      <MaterialSymbol
        className='nav-rail-hover-fill-icon__outline'
        name={toggleSidebarIcon}
        aria-hidden='true'
      />
      <MaterialSymbol
        className='nav-rail-hover-fill-icon__filled'
        name={toggleSidebarIcon}
        filled
        aria-hidden='true'
      />
    </span>
  )
  const renderWindowBarAction = (action: NavRailWindowBarAction, className: string) => {
    const isActive = action.active === true
    const resolvedIcon = isActive && action.activeIcon != null ? action.activeIcon : action.icon
    const baseLabel = isActive ? action.activeLabel ?? action.label : action.label
    const resolvedLabel = action.badge?.label == null ? baseLabel : `${baseLabel} · ${action.badge.label}`
    const resolvedTitle = isActive
      ? action.activeTitle ?? action.activeLabel ?? action.title ?? action.label
      : action.title ?? action.label
    const progress = action.progress == null ? null : Math.max(0, Math.min(100, action.progress))
    const resolvedPreviewOpen = action.onPreviewOpen ??
      (action.previewOnHover === 'sidebar' ? onSidebarPreviewPointerEnter : undefined)
    const handlePreviewClose = action.onPreviewClose ??
      (action.previewOnHover === 'sidebar' ? onSidebarPreviewPointerLeave : undefined)
    const handlePreviewOpen = resolvedPreviewOpen == null
      ? undefined
      : () => {
        if (action.previewOnHover !== 'sidebar') {
          onSidebarPreviewClose?.()
        }

        resolvedPreviewOpen()
      }
    const iconNode = (
      <span
        className={[
          'nav-rail-window-action-visual',
          progress == null ? '' : 'has-progress',
          action.badge == null ? '' : 'has-badge'
        ].filter(Boolean).join(' ')}
        style={progress == null
          ? undefined
          : {
            '--nav-rail-window-action-progress': `${progress * 3.6}deg`
          } as React.CSSProperties}
      >
        {progress != null && <span className='nav-rail-window-action-progress' aria-hidden='true' />}
        {renderIconAsset({
          active: isActive,
          className: 'nav-rail-window-action-icon',
          icon: resolvedIcon,
          materialFilled: false
        })}
        {action.badge != null && (
          <span
            className={[
              'nav-rail-window-action-badge',
              `is-${action.badge.tone}`,
              action.badge.animated === true ? 'is-animated' : ''
            ].filter(Boolean).join(' ')}
            aria-hidden='true'
            title={action.badge.label}
          />
        )}
      </span>
    )

    return (
      <ShortcutTooltip
        key={action.key}
        isMac={isMac}
        shortcut={action.shortcut}
        title={resolvedTitle}
        placement={windowBarTooltipPlacement}
        arrow={windowBarTooltipArrow}
        enabled={action.showTooltip !== false && resolvedTitle != null}
        data-nav-rail-window-action-key={action.key}
        onPointerEnter={handlePreviewOpen}
        onPointerLeave={handlePreviewClose}
      >
        <Button
          type='text'
          className={[
            className,
            isActive ? 'is-active' : '',
            action.danger === true ? 'is-danger' : ''
          ].filter(Boolean).join(' ')}
          disabled={action.disabled}
          aria-label={resolvedLabel}
          aria-pressed={action.active == null ? undefined : isActive}
          icon={iconNode}
          onBlur={handlePreviewClose}
          onClick={action.onSelect}
          onFocus={handlePreviewOpen}
        />
      </ShortcutTooltip>
    )
  }
  const renderCollapsedAction = (action: NavRailWindowBarAction) => (
    renderWindowBarAction(action, 'nav-rail-window-action-button')
  )

  return (
    <>
      {showSimulatedWindowControls && (
        <div className='nav-rail-window-controls' aria-hidden='true'>
          <span className='nav-rail-window-control is-close' />
          <span className='nav-rail-window-control is-minimize' />
          <span className='nav-rail-window-control is-zoom' />
        </div>
      )}
      <div
        className={[
          'nav-rail-window-bar',
          showSimulatedWindowControls ? 'has-window-controls' : '',
          reserveWindowControls ? 'has-reserved-window-controls' : '',
          sidebarCollapsed ? 'is-sidebar-collapsed' : '',
          sidebarPreviewOpen ? 'is-sidebar-preview-open' : ''
        ].filter(Boolean).join(' ')}
        onMouseLeave={sidebarCollapsed ? onSidebarPreviewPointerLeave : undefined}
        style={drawerWidth == null
          ? undefined
          : {
            '--nav-rail-drawer-width': `${drawerWidth}px`
          } as React.CSSProperties}
      >
        {!showSimulatedWindowControls && reserveWindowControls && (
          <div className='nav-rail-window-spacer' />
        )}
        <ShortcutTooltip
          isMac={isMac}
          shortcut={getDesktopViewShortcut('toggle-sidebar')}
          title={resolvedToggleSidebarLabel}
          placement={windowBarTooltipPlacement}
          arrow={windowBarTooltipArrow}
        >
          <Button
            type='text'
            className={[
              'nav-rail-chrome-button',
              showResolvedToggleSidebarLabel ? 'nav-rail-chrome-button--labeled' : '',
              showResolvedToggleSidebarLabel ? 'nav-rail-chrome-button--plain-label' : ''
            ].filter(Boolean).join(' ')}
            aria-label={resolvedToggleSidebarLabel}
            icon={toggleSidebarIconNode}
            onBlur={sidebarCollapsed ? onSidebarPreviewPointerLeave : undefined}
            onClick={onToggleSidebarCollapsed}
            onFocus={sidebarCollapsed ? onSidebarPreviewPointerEnter : undefined}
            onMouseEnter={sidebarCollapsed ? onSidebarPreviewPointerEnter : undefined}
          >
            {showResolvedToggleSidebarLabel &&
              <span className='nav-rail-chrome-button__label'>{toggleSidebarLabel}</span>}
          </Button>
        </ShortcutTooltip>
        {showHistoryNavigation && (
          <>
            <ShortcutTooltip
              isMac={isMac}
              shortcut={getDesktopViewShortcut('back')}
              title={t('navRail.back')}
              placement={windowBarTooltipPlacement}
              arrow={windowBarTooltipArrow}
            >
              <Button
                type='text'
                className='nav-rail-chrome-button'
                disabled={!canGoBack}
                aria-label={t('navRail.back')}
                icon={<MaterialSymbol name='arrow_back' />}
                onClick={onNavigateBack}
              />
            </ShortcutTooltip>
            <ShortcutTooltip
              isMac={isMac}
              shortcut={getDesktopViewShortcut('forward')}
              title={t('navRail.forward')}
              placement={windowBarTooltipPlacement}
              arrow={windowBarTooltipArrow}
            >
              <Button
                type='text'
                className='nav-rail-chrome-button'
                disabled={!canGoForward}
                aria-label={t('navRail.forward')}
                icon={<MaterialSymbol name='arrow_forward' />}
                onClick={onNavigateForward}
              />
            </ShortcutTooltip>
          </>
        )}
        {updateAction != null &&
          renderWindowBarAction(updateAction, 'nav-rail-chrome-button nav-rail-chrome-button--update')}
        {sidebarCollapsed && onCreateSession != null && shouldRenderCreateSessionControl && (
          isCreateSessionActive
            ? (
              <span
                className='nav-rail-create-session-indicator'
                aria-label={t('common.newChat')}
                role='img'
              >
                <MaterialSymbol name='chat_bubble' filled />
              </span>
            )
            : (
              <ShortcutTooltip
                isMac={isMac}
                shortcut={resolvedNewSessionShortcut}
                title={t('common.newChat')}
                placement={windowBarTooltipPlacement}
                arrow={windowBarTooltipArrow}
              >
                <Button
                  type='text'
                  className='nav-rail-create-session-button'
                  aria-label={t('common.newChat')}
                  icon={<MaterialSymbol name='edit_square' />}
                  onClick={onCreateSession}
                />
              </ShortcutTooltip>
            )
        )}
        {sidebarCollapsed && collapsedActions.map(renderCollapsedAction)}
      </div>
    </>
  )
}

export function NavRail({
  ariaHidden = false,
  children,
  compactPlacement = 'bottom',
  drawerFooterAfter,
  drawerFooterBefore,
  drawerWorkspaceStatus,
  drawerWidth,
  isCompactLayout = false,
  moreMenuSections = [],
  moreMenuContextMenuSections = [],
  moreMenuSelectedKeys: routeMoreMenuSelectedKeys = [],
  onCompactAction,
  onOpenSidebar,
  onSidebarPreviewPointerEnter,
  onSidebarPreviewPointerLeave,
  sidebarCollapsed = false,
  sidebarPreviewOpen = false,
  showSidebar = false
}: {
  ariaHidden?: boolean
  children?: React.ReactNode
  compactPlacement?: 'bottom' | 'drawer'
  drawerFooterAfter?: React.ReactNode
  drawerFooterBefore?: React.ReactNode
  drawerWorkspaceStatus?: React.ReactNode
  drawerWidth?: number
  isCompactLayout?: boolean
  moreMenuSections?: NavRailMoreMenuSection[]
  moreMenuContextMenuSections?: NavRailMoreMenuSection[]
  moreMenuSelectedKeys?: string[]
  onCompactAction?: () => void
  onOpenSidebar?: () => void
  onSidebarPreviewPointerEnter?: () => void
  onSidebarPreviewPointerLeave?: () => void
  sidebarCollapsed?: boolean
  sidebarPreviewOpen?: boolean
  showSidebar?: boolean
}) {
  const { t, i18n } = useTranslation()
  const [themeMode, setThemeMode] = useAtom(themeAtom)
  const setIsSidebarResizing = useSetAtom(isSidebarResizingAtom)
  const setSidebarWidth = useSetAtom(sidebarWidthAtom)
  const navigate = useNavigate()
  const location = useLocation()
  const experiments = useExperiments()
  const { resolvedThemeMode } = useResolvedThemeMode()
  const { data: configRes, mutate: mutateConfig } = useSWR<ConfigResponse>('/api/config', getConfig)
  const { compactAccountActions } = useNavRailAccountActions()
  const { updateGlobalInterfaceLanguage } = useInterfaceLanguageConfig()
  const storedDevShellSimulation = useStoredDevShellSimulation()
  const isMac = navigator.platform.includes('Mac')
  const moreButtonRef = React.useRef<HTMLButtonElement | null>(null)
  const moreMenuCloseTimerRef = React.useRef<number | null>(null)
  const [isMoreMenuOpen, setIsMoreMenuOpen] = React.useState(false)
  const [isMoreMenuClosing, setIsMoreMenuClosing] = React.useState(false)
  const [openPluginFooterPopoverKey, setOpenPluginFooterPopoverKey] = React.useState<string | null>(null)

  const currentPath = location.pathname
  const canResizeDrawer = !isCompactLayout && showSidebar && !sidebarCollapsed && drawerWidth != null
  const drawerResizeWidth = drawerWidth ?? MIN_SIDEBAR_WIDTH
  const isFullyCollapsedDrawer = !isCompactLayout && sidebarCollapsed && drawerWidth === 0

  React.useEffect(() => {
    return () => {
      if (moreMenuCloseTimerRef.current != null) {
        window.clearTimeout(moreMenuCloseTimerRef.current)
      }
    }
  }, [])

  const clearMoreMenuCloseTimer = React.useCallback(() => {
    if (moreMenuCloseTimerRef.current == null) return

    window.clearTimeout(moreMenuCloseTimerRef.current)
    moreMenuCloseTimerRef.current = null
  }, [])

  const openMoreMenu = React.useCallback(() => {
    clearMoreMenuCloseTimer()
    setIsMoreMenuClosing(false)
    setIsMoreMenuOpen(true)
  }, [clearMoreMenuCloseTimer])

  const closeMoreMenu = React.useCallback((animated = true) => {
    clearMoreMenuCloseTimer()

    if (!animated || !isMoreMenuOpen) {
      setIsMoreMenuClosing(false)
      setIsMoreMenuOpen(false)
      return
    }

    setIsMoreMenuClosing(true)
    moreMenuCloseTimerRef.current = window.setTimeout(() => {
      moreMenuCloseTimerRef.current = null
      setIsMoreMenuClosing(false)
      setIsMoreMenuOpen(false)
    }, NAV_RAIL_MORE_CLOSE_DEFER_MS)
  }, [clearMoreMenuCloseTimer, isMoreMenuOpen])

  const handleMoreMenuOpenChange = React.useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      openMoreMenu()
      return
    }

    closeMoreMenu()
  }, [closeMoreMenu, openMoreMenu])

  const languageMoreMenuItems = React.useMemo<NavRailMoreMenuItem[]>(() => {
    const activeLanguage = getActiveAppLanguageOption(i18n.resolvedLanguage ?? i18n.language)

    return appLanguageOptions.map(option => ({
      active: activeLanguage?.value === option.value,
      activeIcon: 'check',
      icon: activeLanguage?.value === option.value
        ? 'check'
        : 'language',
      key: `language:${option.value}`,
      label: option.label,
      selected: activeLanguage?.value === option.value,
      onSelect: () => {
        void updateGlobalInterfaceLanguage(option.value)
      }
    }))
  }, [i18n.language, i18n.resolvedLanguage, updateGlobalInterfaceLanguage])

  const navItems = React.useMemo(() => buildNavItems({ currentPath, experiments, t }), [currentPath, experiments, t])

  const compactMoreActions = React.useMemo(() => [
    ...buildCompactMoreActions({
      currentPath,
      onOpenSidebar,
      showSidebar: showSidebar && compactPlacement === 'bottom',
      t
    }),
    ...compactAccountActions
  ], [
    compactPlacement,
    compactAccountActions,
    currentPath,
    onOpenSidebar,
    showSidebar,
    t
  ])

  const selectThemeMode = React.useCallback((nextThemeMode: ThemeMode) => {
    const previousThemeMode = themeMode
    setThemeMode(nextThemeMode)

    void updateConfig('global', 'appearance', {
      ...(configRes?.sources?.global?.appearance ?? {}),
      themeMode: nextThemeMode
    })
      .then(() => mutateConfig())
      .catch((error) => {
        console.error('[nav-rail] failed to update global theme mode', error)
        setThemeMode(previousThemeMode)
        void mutateConfig()
      })
  }, [configRes?.sources?.global?.appearance, mutateConfig, setThemeMode, themeMode])

  const compactThemeActions = React.useMemo(() =>
    buildCompactThemeActions({
      setThemeMode: selectThemeMode,
      t,
      themeMode
    }), [selectThemeMode, t, themeMode])

  const compactLanguageActions = React.useMemo(() =>
    buildCompactLanguageActions({
      currentLanguage: i18n.language,
      onChangeLanguage: (language) => {
        void updateGlobalInterfaceLanguage(language)
      }
    }), [i18n.language, updateGlobalInterfaceLanguage])
  const currentLanguageLabel = getActiveAppLanguageOption(i18n.resolvedLanguage ?? i18n.language)?.label ??
    i18n.language

  const navigateToWorkspaceConfig = React.useCallback(() => {
    void getCurrentWorkspaceBrowserActivityRouteState()
      .then((state) => {
        void navigate('/config', state == null ? undefined : { state })
      })
      .catch((error) => {
        console.warn('[nav-rail] failed to resolve workspace config context', error)
        void navigate('/config')
      })
  }, [navigate])

  const themeModeOptions = React.useMemo(() => [
    {
      icon: 'desktop_windows',
      key: 'system' as const,
      label: t('common.themeSystem')
    },
    {
      icon: 'light_mode',
      key: 'light' as const,
      label: t('common.themeLight')
    },
    {
      icon: 'dark_mode',
      key: 'dark' as const,
      label: t('common.themeDark')
    }
  ], [t])
  const appPageMoreMenuSections = React.useMemo<NavRailMoreMenuSection[]>(() => [
    {
      key: 'app-pages',
      items: [
        {
          active: currentPath === '/config' || currentPath.startsWith('/config/'),
          icon: 'settings',
          key: 'app-page:config',
          label: t('common.settings'),
          selected: currentPath === '/config' || currentPath.startsWith('/config/'),
          shortcut: 'cmd+,',
          onSelect: navigateToWorkspaceConfig
        },
        {
          active: currentPath === '/archive',
          icon: 'inventory_2',
          key: 'app-page:archive',
          label: t('common.archivedSessions'),
          selected: currentPath === '/archive',
          onSelect: () => {
            void navigate('/archive')
          }
        }
      ]
    }
  ], [currentPath, navigate, navigateToWorkspaceConfig, t])
  const pluginNavItems = usePluginSlot<PluginContributionNavItem>('nav.items')
  const pluginMoreItems = usePluginSlot<PluginContributionMenuItem>('nav.moreMenu')
  const pluginFooterBeforeItems = usePluginSlot<PluginContributionMenuItem>('nav.footer.before')
  const executePluginCommand = usePluginCommandExecutor()
  const pluginLanguage = i18n.resolvedLanguage ?? i18n.language
  const runPluginMenuItem = React.useCallback((item: ScopedPluginMenuItem) => {
    if (item.command != null && executePluginCommand != null) {
      void executePluginCommand(item.pluginScope, item.command, item.payload)
      return
    }
    if (item.route != null) {
      void navigate(item.route)
      return
    }
    if (item.href != null) {
      window.open(item.href, '_blank', 'noopener,noreferrer')
    }
  }, [executePluginCommand, navigate])
  const runPluginAccountPopoverAction = React.useCallback((
    pluginScope: string,
    action: PluginFooterAccountPopoverAction
  ) => {
    setOpenPluginFooterPopoverKey(null)
    if (action.command != null && executePluginCommand != null) {
      void executePluginCommand(pluginScope, action.command, action.payload)
      return
    }
    if (action.route != null) {
      void navigate(action.route)
      notifyPluginRouteChange(pluginScope, action.route)
      return
    }
    if (action.href != null) {
      window.open(action.href, '_blank', 'noopener,noreferrer')
    }
  }, [executePluginCommand, navigate])
  const toNavRailPluginMenuItem = React.useCallback((
    item: ScopedPluginMenuItem | PluginContributionMenuItem,
    pluginScope: string
  ): NavRailMoreMenuItem => {
    const scopedItem = { ...item, pluginScope }
    return {
      icon: scopedItem.icon ?? 'layers',
      key: `plugin:${pluginScope}:${scopedItem.id}`,
      label: resolvePluginContributionText(scopedItem, 'title', pluginLanguage) ?? scopedItem.title,
      title: resolvePluginContributionText(scopedItem, 'description', pluginLanguage),
      active: scopedItem.route === currentPath,
      selected: scopedItem.selected === true || scopedItem.route === currentPath,
      danger: scopedItem.danger,
      disabled: scopedItem.disabled,
      shortcut: scopedItem.shortcut,
      children: scopedItem.children?.map(child => toNavRailPluginMenuItem(child, pluginScope)),
      onSelect: () => {
        runPluginMenuItem(scopedItem)
      }
    }
  }, [currentPath, pluginLanguage, runPluginMenuItem])
  const pluginMoreMenuSections = React.useMemo<NavRailMoreMenuSection[]>(() => {
    const items = pluginMoreItems.map(item => toNavRailPluginMenuItem(item, item.pluginScope))

    return items.length === 0
      ? []
      : [{ items, key: 'plugin-more-menu' }]
  }, [pluginMoreItems, toNavRailPluginMenuItem])

  const pluginFooterBeforeNode = React.useMemo(() => {
    if (pluginFooterBeforeItems.length === 0) return null

    return (
      <div className='nav-rail-footer-extension-list' role='list'>
        {pluginFooterBeforeItems.map((item) => {
          const isActive = item.route != null && currentPath === item.route
          const footerKey = `plugin-footer:${item.pluginScope}:${item.id}`
          const accountPopover = isPluginFooterAccountPopoverItem(item) ? item.accountPopover : undefined
          const menuItem = toNavRailPluginMenuItem(item, item.pluginScope)
          const childItems = 'children' in menuItem && menuItem.children != null ? menuItem.children : []
          const hasDropdown = accountPopover != null || childItems.length > 0
          const dropdownItems = hasDropdown
            ? buildNavRailMoreMenuItems({
              closeMenu: () => {},
              isMac,
              sections: [{ items: childItems, key: `plugin-footer:${item.pluginScope}:${item.id}` }]
            })
            : []
          const selectedKeys = hasDropdown
            ? getNavRailMoreMenuSelectedKeys([{
              items: childItems,
              key: `plugin-footer:${item.pluginScope}:${item.id}`
            }])
            : []
          const button = (
            <button
              key={`plugin-footer-button:${item.pluginScope}:${item.id}`}
              type='button'
              className={[
                'nav-rail-footer-extension-item',
                hasDropdown ? 'nav-rail-footer-extension-item--dropdown' : '',
                isActive ? 'is-active' : ''
              ].filter(Boolean).join(' ')}
              aria-current={isActive ? 'page' : undefined}
              aria-haspopup={hasDropdown ? 'menu' : undefined}
              onClick={hasDropdown ? undefined : () => runPluginMenuItem(item)}
            >
              <MaterialSymbol
                className='nav-rail-footer-extension-item__icon'
                name={item.icon ?? 'extension'}
                aria-hidden='true'
              />
              <span className='nav-rail-footer-extension-item__label'>
                {resolvePluginContributionText(item, 'title', pluginLanguage) ?? item.title}
              </span>
              {hasDropdown && (
                <MaterialSymbol
                  className='nav-rail-footer-extension-item__chevron'
                  name='expand_more'
                  aria-hidden='true'
                />
              )}
            </button>
          )

          if (!hasDropdown) {
            return React.cloneElement(button, { key: footerKey })
          }

          if (accountPopover != null) {
            const accountDropdownItems = buildAccountPopoverMenuItems({
              accountPopover,
              onAction: (action) => runPluginAccountPopoverAction(item.pluginScope, action)
            })
            return (
              <Dropdown
                key={footerKey}
                destroyOnHidden
                open={openPluginFooterPopoverKey === footerKey}
                overlayClassName={`${NAV_RAIL_MORE_DROPDOWN_CLASS} nav-rail-footer-extension-dropdown nav-rail-account-menu-dropdown`}
                menu={{
                  expandIcon: renderAccountPopoverExpandIcon(),
                  items: accountDropdownItems,
                  triggerSubMenuAction: 'click'
                }}
                placement='topLeft'
                trigger={['click']}
                transitionName='ant-slide-down'
                onOpenChange={(open) => {
                  setOpenPluginFooterPopoverKey(open ? footerKey : null)
                }}
              >
                {button}
              </Dropdown>
            )
          }

          return (
            <Dropdown
              key={footerKey}
              destroyOnHidden
              overlayClassName={`${NAV_RAIL_MORE_DROPDOWN_CLASS} nav-rail-footer-extension-dropdown`}
              menu={{
                items: dropdownItems,
                selectedKeys,
                triggerSubMenuAction: 'click'
              }}
              placement='topLeft'
              trigger={['click']}
              transitionName='ant-slide-down'
            >
              {button}
            </Dropdown>
          )
        })}
      </div>
    )
  }, [
    currentPath,
    isMac,
    openPluginFooterPopoverKey,
    pluginFooterBeforeItems,
    pluginLanguage,
    runPluginAccountPopoverAction,
    runPluginMenuItem,
    toNavRailPluginMenuItem
  ])

  const preferenceMoreMenuSections = React.useMemo<NavRailMoreMenuSection[]>(() => [
    {
      items: [
        {
          icon: 'language',
          key: 'language',
          label: (
            <span className='nav-menu-language-label'>
              <span className='nav-menu-language-title'>{t('navRail.language')}</span>
              <span className='nav-menu-language-current'>{currentLanguageLabel}</span>
            </span>
          ),
          children: languageMoreMenuItems
        },
        {
          className: 'nav-menu-theme-item',
          content: (
            <div className='nav-menu-theme-block'>
              <span className='nav-menu-theme-main'>
                <span className='material-symbols-rounded nav-menu-theme-leading-icon' aria-hidden='true'>
                  dark_mode
                </span>
                <span className='nav-menu-theme-title'>{t('navRail.theme')}</span>
              </span>
              <div className='nav-menu-theme-switch' role='radiogroup' aria-label={t('navRail.theme')}>
                {themeModeOptions.map((option) => (
                  <button
                    type='button'
                    key={option.key}
                    className={`nav-menu-theme-button ${themeMode === option.key ? 'is-active' : ''}`}
                    role='radio'
                    aria-checked={themeMode === option.key}
                    onClick={(event) => {
                      event.stopPropagation()
                      selectThemeMode(option.key)
                    }}
                    aria-label={option.label}
                    title={option.label}
                  >
                    <span className='material-symbols-rounded nav-menu-theme-button__icon'>{option.icon}</span>
                    <span className='nav-menu-theme-button__label'>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ),
          key: 'theme-mode',
          type: 'custom',
          onClick: (event) => {
            event.stopPropagation()
          }
        }
      ],
      key: 'preferences'
    }
  ], [
    currentLanguageLabel,
    languageMoreMenuItems,
    selectThemeMode,
    t,
    themeMode,
    themeModeOptions
  ])

  const shellSimulationSummary = React.useMemo(() => {
    if (storedDevShellSimulation.shellKind === 'electron') {
      return {
        icon: storedDevShellSimulation.os === 'windows' ? 'desktop_windows' : 'desktop_mac',
        label: storedDevShellSimulation.os === 'windows'
          ? t('navRail.devShellElectronWindows', 'Electron App · Windows')
          : t('navRail.devShellElectronMacos', 'Electron App · macOS')
      }
    }

    if (storedDevShellSimulation.shellKind === 'mobile') {
      return {
        icon: storedDevShellSimulation.os === 'ios' ? 'phone_iphone' : 'smartphone',
        label: storedDevShellSimulation.os === 'ios'
          ? t('navRail.devShellMobileIos', 'Mobile App · iOS')
          : t('navRail.devShellMobileAndroid', 'Mobile App · Android')
      }
    }

    return {
      icon: 'language',
      label: t('navRail.devShellWeb', 'Web 默认')
    }
  }, [storedDevShellSimulation.os, storedDevShellSimulation.shellKind, t])
  const selectShellSimulationKind = React.useCallback((shellKind: DevShellKind) => {
    if (shellKind === 'web') {
      writeStoredDevShellSimulation({ shellKind: 'web' })
      return
    }

    if (shellKind === 'electron') {
      writeStoredDevShellSimulation({
        shellKind,
        os: storedDevShellSimulation.shellKind === 'electron' &&
            storedDevShellSimulation.os === 'windows'
          ? 'windows'
          : 'macos'
      })
      return
    }

    writeStoredDevShellSimulation({
      shellKind,
      os: storedDevShellSimulation.shellKind === 'mobile' &&
          storedDevShellSimulation.os === 'ios'
        ? 'ios'
        : 'android'
    })
  }, [storedDevShellSimulation.os, storedDevShellSimulation.shellKind])
  const selectShellSimulationOs = React.useCallback((os: DevShellOs) => {
    if (os === 'macos' || os === 'windows') {
      writeStoredDevShellSimulation({ shellKind: 'electron', os })
      return
    }

    if (os === 'android' || os === 'ios') {
      writeStoredDevShellSimulation({ shellKind: 'mobile', os })
    }
  }, [])
  const shellSimulationKindOptions = React.useMemo<
    Array<{
      icon: string
      value: DevShellKind
      label: string
    }>
  >(() => [
    {
      icon: 'language',
      value: 'web',
      label: t('navRail.devShellKindWeb', 'Web')
    },
    {
      icon: 'desktop_mac',
      value: 'electron',
      label: t('navRail.devShellKindElectron', 'Electron')
    },
    {
      icon: 'smartphone',
      value: 'mobile',
      label: t('navRail.devShellKindMobile', 'Mobile')
    }
  ], [t])
  const shellSimulationOsOptions = React.useMemo<
    Array<{
      icon: string
      value: DevShellOs
      label: string
    }>
  >(() => {
    if (storedDevShellSimulation.shellKind === 'electron') {
      return [
        {
          icon: 'desktop_mac',
          value: 'macos',
          label: t('navRail.devShellOsMacos', 'macOS')
        },
        {
          icon: 'desktop_windows',
          value: 'windows',
          label: t('navRail.devShellOsWindows', 'Windows')
        }
      ]
    }

    if (storedDevShellSimulation.shellKind === 'mobile') {
      return [
        {
          icon: 'smartphone',
          value: 'android',
          label: t('navRail.devShellOsAndroid', 'Android')
        },
        {
          icon: 'phone_iphone',
          value: 'ios',
          label: t('navRail.devShellOsIos', 'iOS')
        }
      ]
    }

    return []
  }, [storedDevShellSimulation.shellKind, t])
  const shellSimulationPanelNode = React.useMemo(() => {
    if (!import.meta.env.DEV) return null
    const selectedKindLabel = shellSimulationKindOptions.find(option =>
      option.value === storedDevShellSimulation.shellKind
    )?.label
    const selectedOsLabel = shellSimulationOsOptions.find(option => option.value === storedDevShellSimulation.os)?.label

    return (
      <OverlayPanel
        className='nav-rail-more-overlay-panel nav-rail-dev-shell-panel'
        role='dialog'
        onClick={(event) => event.stopPropagation()}
      >
        <div className='nav-rail-dev-shell-panel__row'>
          <span className='nav-rail-dev-shell-panel__text'>
            <span className='nav-rail-dev-shell-panel__label'>
              {t('navRail.devShellKind', '类型')}
            </span>
            <span className='nav-rail-dev-shell-panel__value'>
              {selectedKindLabel}
            </span>
          </span>
          <OverlaySegmentedControl
            className='nav-rail-dev-shell-panel__segmented nav-rail-dev-shell-panel__segmented--kind'
            ariaLabel={t('navRail.devShellKind', '类型')}
            options={shellSimulationKindOptions}
            value={storedDevShellSimulation.shellKind}
            onChange={selectShellSimulationKind}
          />
        </div>
        {shellSimulationOsOptions.length > 0 && (
          <div className='nav-rail-dev-shell-panel__row'>
            <span className='nav-rail-dev-shell-panel__text'>
              <span className='nav-rail-dev-shell-panel__label'>
                {t('navRail.devShellOs', '系统')}
              </span>
              <span className='nav-rail-dev-shell-panel__value'>
                {selectedOsLabel}
              </span>
            </span>
            <OverlaySegmentedControl
              className='nav-rail-dev-shell-panel__segmented'
              ariaLabel={t('navRail.devShellOs', '系统')}
              options={shellSimulationOsOptions}
              value={storedDevShellSimulation.os ?? shellSimulationOsOptions[0]!.value}
              onChange={selectShellSimulationOs}
            />
          </div>
        )}
      </OverlayPanel>
    )
  }, [
    selectShellSimulationKind,
    selectShellSimulationOs,
    shellSimulationKindOptions,
    shellSimulationOsOptions,
    storedDevShellSimulation.os,
    storedDevShellSimulation.shellKind,
    t
  ])
  const shellSimulationFooterNode = React.useMemo(() => {
    if (!import.meta.env.DEV || shellSimulationPanelNode == null) return null

    return (
      <div className='nav-rail-dev-shell-simulation'>
        <Dropdown
          destroyOnHidden
          overlayClassName={`${NAV_RAIL_MORE_DROPDOWN_CLASS} nav-rail-dev-shell-simulation-dropdown`}
          menu={{ items: [] }}
          placement='topLeft'
          popupRender={() => shellSimulationPanelNode}
          trigger={['click']}
          transitionName='ant-slide-down'
        >
          <Button
            type='default'
            className='nav-rail-dev-shell-simulation__button'
            aria-haspopup='dialog'
            block
          >
            <span className='nav-rail-dev-shell-simulation__content'>
              <MaterialSymbol
                className='nav-rail-dev-shell-simulation__icon'
                name={shellSimulationSummary.icon}
                aria-hidden='true'
              />
              <span className='nav-rail-dev-shell-simulation__label'>
                {shellSimulationSummary.label}
              </span>
              <MaterialSymbol
                className='nav-rail-dev-shell-simulation__chevron'
                name='expand_more'
                aria-hidden='true'
              />
            </span>
          </Button>
        </Dropdown>
      </div>
    )
  }, [
    shellSimulationPanelNode,
    shellSimulationSummary.icon,
    shellSimulationSummary.label
  ])

  const moduleManagementMenuItem = React.useMemo<NavRailMoreMenuItem>(() => ({
    active: currentPath === '/modules',
    icon: 'sync',
    key: 'app-action:module-updates',
    label: t('moduleUpdates.menuLabel'),
    onSelect: () => {
      void navigate('/modules')
    }
  }), [currentPath, navigate, t])

  const resolvedDrawerFooterBefore = React.useMemo(() => {
    if (
      drawerWorkspaceStatus == null &&
      pluginFooterBeforeNode == null &&
      drawerFooterBefore == null &&
      shellSimulationFooterNode == null
    ) {
      return undefined
    }

    return (
      <>
        {drawerWorkspaceStatus}
        {pluginFooterBeforeNode}
        {drawerFooterBefore}
        {shellSimulationFooterNode}
      </>
    )
  }, [drawerFooterBefore, drawerWorkspaceStatus, pluginFooterBeforeNode, shellSimulationFooterNode])

  const moreMenuRouteSections = React.useMemo<NavRailMoreMenuSection[]>(() => [
    ...moreMenuSections,
    ...appendMenuItemToLastSection(
      [
        ...appPageMoreMenuSections,
        ...pluginMoreMenuSections
      ],
      moduleManagementMenuItem
    )
  ], [appPageMoreMenuSections, moduleManagementMenuItem, moreMenuSections, pluginMoreMenuSections])

  const moreMenuResolvedSections = React.useMemo<NavRailMoreMenuSection[]>(() => {
    const sections: NavRailMoreMenuSection[] = [
      ...moreMenuRouteSections,
      ...preferenceMoreMenuSections
    ]

    return sections
  }, [
    moreMenuRouteSections,
    preferenceMoreMenuSections
  ])

  const moreMenuItems = React.useMemo(() =>
    buildNavRailMoreMenuItems({
      closeMenu: closeMoreMenu,
      isMac,
      sections: moreMenuResolvedSections
    }), [closeMoreMenu, isMac, moreMenuResolvedSections])

  const moreMenuContextMenuItems = React.useMemo(() =>
    buildNavRailMoreMenuItems({
      closeMenu: closeMoreMenu,
      isMac,
      sections: moreMenuContextMenuSections
    }), [closeMoreMenu, isMac, moreMenuContextMenuSections])

  const moreMenuSelectedKeys = React.useMemo(() => [
    ...getNavRailMoreMenuSelectedKeys(moreMenuResolvedSections),
    ...routeMoreMenuSelectedKeys
  ], [moreMenuResolvedSections, routeMoreMenuSelectedKeys])
  const moreButtonSelectedKeys = React.useMemo(() => [
    ...getNavRailMoreMenuSelectedKeys(moreMenuRouteSections),
    ...routeMoreMenuSelectedKeys
  ], [moreMenuRouteSections, routeMoreMenuSelectedKeys])

  const moreButtonLabel = t('navRail.more')
  const isMoreMenuVisuallyOpen = isMoreMenuOpen && !isMoreMenuClosing
  const isMoreButtonActive = isMoreMenuVisuallyOpen || moreButtonSelectedKeys.length > 0
  const activeThemePrimaryColor = getGlobalThemePrimaryColor(configRes) ?? DEFAULT_THEME_PRIMARY_COLOR
  const activeIconTheme = React.useMemo(
    () =>
      ONEWORKS_THEME_COLOR_PRESETS.find(preset => preset.primaryColor === activeThemePrimaryColor)?.theme ??
        ONEWORKS_THEME_COLOR_PRESETS[0].theme,
    [activeThemePrimaryColor]
  )
  const moreButtonIconSrc = React.useMemo(() =>
    createOneWorksIconDataUri({
      mode: resolvedThemeMode,
      noBackground: true,
      size: 64,
      theme: activeIconTheme,
      title: t('navRail.more')
    }), [activeIconTheme, resolvedThemeMode, t])

  React.useEffect(() => {
    const root = document.documentElement
    const propertyName = '--nav-rail-more-vibe-icon-url'
    const nextValue = `url("${moreButtonIconSrc}")`
    root.style.setProperty(propertyName, nextValue)

    return () => {
      if (root.style.getPropertyValue(propertyName) === nextValue) {
        root.style.removeProperty(propertyName)
      }
    }
  }, [moreButtonIconSrc])

  const triggerMoreButtonFeedback = React.useCallback(() => {
    if (moreButtonRef.current == null) return

    moreButtonRef.current.classList.add('active-scale')
    window.setTimeout(() => {
      moreButtonRef.current?.classList.remove('active-scale')
    }, 200)
  }, [])

  const commitSidebarWidth = React.useCallback((nextWidth: number) => {
    const resolvedWidth = clampSidebarWidth(nextWidth)
    setSidebarWidth(resolvedWidth)

    try {
      localStorage.setItem('sidebarWidth', String(resolvedWidth))
    } catch {}
  }, [setSidebarWidth])

  const drawerResize = usePanelResize({
    axis: 'x',
    cursor: 'col-resize',
    disabled: !canResizeDrawer,
    max: MAX_SIDEBAR_WIDTH,
    min: MIN_SIDEBAR_WIDTH,
    value: drawerResizeWidth,
    onCommit: commitSidebarWidth,
    onPreview: setSidebarWidth,
    onResizeEnd: () => setIsSidebarResizing(false),
    onResizeStart: () => setIsSidebarResizing(true)
  })

  const handleNavClick = (_key: string, path: string) => {
    void navigate(path)
  }
  const resolvedNavItems = React.useMemo(() => [
    ...navItems,
    ...pluginNavItems.map(item => ({
      active: item.route != null && currentPath === item.route,
      icon: item.icon ?? 'layers',
      key: `plugin:${item.pluginScope}:${item.id}`,
      label: resolvePluginContributionText(item, 'title', pluginLanguage) ?? item.title,
      path: item.route ?? `/plugins/${item.pluginScope}/${item.id}`
    }))
  ], [currentPath, navItems, pluginLanguage, pluginNavItems])
  const resolvedCompactMoreActions = React.useMemo<NavRailCompactMoreAction[]>(() => [
    ...compactMoreActions
  ], [compactMoreActions])
  const compactMoreMenuSections = React.useMemo<NavRailMoreMenuSection[]>(() => [
    ...moreMenuSections,
    ...appendMenuItemToLastSection(
      [
        ...appPageMoreMenuSections,
        ...pluginMoreMenuSections
      ],
      moduleManagementMenuItem
    )
  ], [
    appPageMoreMenuSections,
    moduleManagementMenuItem,
    moreMenuSections,
    pluginMoreMenuSections
  ])

  if (isCompactLayout) {
    return (
      <>
        <NavRailCompact
          ariaHidden={ariaHidden}
          currentPath={currentPath}
          languageActions={compactLanguageActions}
          languageLabel={t('common.language')}
          moreFooterAfter={drawerFooterAfter}
          moreFooterBefore={resolvedDrawerFooterBefore}
          moreLabel={t('navRail.more')}
          moreMenuSections={compactMoreMenuSections}
          moreSheetActions={resolvedCompactMoreActions.map((action) => ({
            ...action,
            onSelect: () => {
              action.onSelect()
            }
          }))}
          navItems={resolvedNavItems}
          placement={compactPlacement}
          themeActions={compactThemeActions}
          themeLabel={t('common.theme')}
          onAction={onCompactAction}
          onNavClick={handleNavClick}
        />
      </>
    )
  }

  return (
    <HostNavRail
      ariaHidden={ariaHidden}
      drawerWidth={drawerWidth}
      footerAfter={drawerFooterAfter}
      footerBefore={resolvedDrawerFooterBefore}
      footerMenu={
        <NavRailMoreDropdown
          active={isMoreButtonActive}
          buttonIconSrc={moreButtonIconSrc}
          buttonLabel={moreButtonLabel}
          buttonRef={moreButtonRef as React.Ref<HTMLAnchorElement | HTMLButtonElement>}
          contextMenuItems={moreMenuContextMenuItems}
          items={moreMenuItems}
          open={isMoreMenuOpen}
          selectedKeys={moreMenuSelectedKeys}
          visuallyOpen={isMoreMenuVisuallyOpen}
          onOpenChange={handleMoreMenuOpenChange}
          onSelectItem={() => closeMoreMenu(false)}
          onTriggerFeedback={triggerMoreButtonFeedback}
        />
      }
      isCollapsed={sidebarCollapsed}
      isFullyCollapsed={isFullyCollapsedDrawer}
      isPreviewOpen={sidebarPreviewOpen}
      isResizing={drawerResize.isResizing}
      resizeHandle={canResizeDrawer
        ? {
          label: t('common.dragResize'),
          max: MAX_SIDEBAR_WIDTH,
          min: MIN_SIDEBAR_WIDTH,
          value: drawerResizeWidth,
          onKeyDown: drawerResize.handleKeyDown,
          onPointerDown: drawerResize.handlePointerDown
        }
        : undefined}
      onPointerEnter={onSidebarPreviewPointerEnter}
      onPointerLeave={onSidebarPreviewPointerLeave}
    >
      {children}
    </HostNavRail>
  )
}
