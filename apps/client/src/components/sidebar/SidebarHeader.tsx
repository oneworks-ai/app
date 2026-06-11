/* eslint-disable max-lines -- sidebar header coordinates search, batch, collapse, and creation controls. */
import './SidebarHeader.scss'

import { Button, Dropdown, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import { useAtomValue } from 'jotai'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'

import { HostSidebarListHeader, HostSidebarQuickLinks } from '@oneworks/route-layout'
import type { HostSidebarQuickLinkItem } from '@oneworks/route-layout'

import { renderIconAsset } from '#~/components/icons/IconAsset'
import type { IconAsset } from '#~/components/icons/IconAsset'
import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import { SidebarListSearchInput } from '#~/components/sidebar-list/SidebarListHeader'
import { addDesktopViewShortcutListener } from '#~/desktop/view-shortcuts'
import { useExperiments } from '#~/hooks/use-experiments'
import { useResponsiveLayout } from '#~/hooks/use-responsive-layout'
import type { SidebarSessionSortOrder } from '#~/hooks/use-sidebar-query-state'
import { resolvePluginContributionText } from '#~/plugins/plugin-i18n'
import type { PluginContributionNavItem } from '#~/plugins/plugin-manifest'
import { usePluginCommandExecutor, usePluginSlot } from '#~/plugins/plugin-slots'
import { sessionListSearchThresholdAtom } from '#~/store/index'
import { formatShortcutLabel } from '#~/utils/shortcutUtils'

import { buildNavItems } from '../nav-rail-items'
import { SidebarHeaderSearchActions } from './SidebarHeaderSearchActions'
import { shouldShowSidebarSearchRow } from './sidebar-search-visibility'

interface SidebarQuickLinkCompositeIcon {
  badge: string
  base: string
}

type SidebarQuickLinkIcon = IconAsset | SidebarQuickLinkCompositeIcon

const isSidebarQuickLinkCompositeIcon = (icon: SidebarQuickLinkIcon): icon is SidebarQuickLinkCompositeIcon => (
  typeof icon === 'object' && icon !== null && 'badge' in icon && 'base' in icon
)

const renderQuickLinkIcon = (icon: SidebarQuickLinkIcon, filled: boolean) => {
  if (!isSidebarQuickLinkCompositeIcon(icon)) {
    return renderIconAsset({
      active: filled,
      className: 'sidebar-header__quick-link-icon',
      icon
    })
  }

  return (
    <span className='sidebar-header__quick-link-composite-icon' aria-hidden='true'>
      <MaterialSymbol
        className='sidebar-header__quick-link-icon sidebar-header__quick-link-icon--composite-base'
        name={icon.base}
        filled={filled}
      />
      <MaterialSymbol
        className='sidebar-header__quick-link-composite-badge'
        name={icon.badge}
      />
    </span>
  )
}

interface SidebarHeaderProps {
  adapterFilters: string[]
  availableAdapters: string[]
  availableTags: string[]
  canBatchDelete: boolean
  hasActiveSearchControls: boolean
  hideSearchRow?: boolean
  hideSideAction?: boolean
  isBatchMode: boolean
  isCompactLayout: boolean
  navigationContextMenuItems?:
    | MenuProps['items']
    | ((context: {
      item?: SidebarHeaderNavigationItem
    }) => MenuProps['items'])
  navigationItems?: SidebarHeaderNavigationItem[]
  routeSearch?: {
    placeholder: string
    suffix?: React.ReactNode
    value: string
    onChange: (value: string) => void
  }
  automationEntryMode: 'creating' | 'item' | 'list'
  pluginEntryMode: 'creating' | 'item' | 'marketplace' | 'list'
  sessionEntryMode: 'creating' | 'session' | 'list'
  newSessionShortcut?: string
  isSidebarCollapsed: boolean
  searchQuery: string
  selectedCount: number
  sessionCount: number
  sortOrder: SidebarSessionSortOrder
  sortSelection?: SidebarSessionSortOrder
  tagFilters: string[]
  totalCount: number
  onBatchArchive: () => void
  onBatchDelete: () => void
  onBatchStar: () => void
  onAdapterFilterChange: (filters: string[]) => void
  onCloseSidebar?: () => void
  onCreateSession: () => void
  onOpenSessionList?: () => void
  onSearchChange: (query: string) => void
  onSortOrderChange: (sort?: SidebarSessionSortOrder) => void
  onSelectAll: (selected: boolean) => void
  onTagFilterChange: (tags: string[]) => void
  onToggleBatchMode: () => void
  onToggleSidebarCollapsed: () => void
}

export interface SidebarHeaderNavigationAction {
  filled?: boolean
  icon: SidebarQuickLinkIcon
  key: string
  label: React.ReactNode
  onSelect: () => void
}

interface SidebarHeaderNavigationItem {
  actions?: SidebarHeaderNavigationAction[]
  activeLabel?: React.ReactNode
  icon: SidebarQuickLinkIcon
  isActive?: boolean
  key: string
  label: React.ReactNode
  onSelect: () => void
  shortcut?: string
}

export function SidebarHeader({
  adapterFilters,
  availableAdapters,
  availableTags,
  canBatchDelete,
  hasActiveSearchControls,
  hideSearchRow = false,
  hideSideAction = false,
  isBatchMode,
  isCompactLayout,
  isSidebarCollapsed,
  navigationContextMenuItems,
  navigationItems,
  routeSearch,
  automationEntryMode,
  pluginEntryMode,
  sessionEntryMode,
  newSessionShortcut,
  searchQuery,
  selectedCount,
  sessionCount,
  sortOrder,
  sortSelection,
  tagFilters,
  totalCount,
  onBatchArchive,
  onBatchDelete,
  onBatchStar,
  onAdapterFilterChange,
  onCloseSidebar,
  onCreateSession,
  onOpenSessionList,
  onSearchChange,
  onSortOrderChange,
  onSelectAll,
  onTagFilterChange,
  onToggleBatchMode,
  onToggleSidebarCollapsed
}: SidebarHeaderProps) {
  const { i18n, t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const isMac = navigator.platform.includes('Mac')
  const { isTouchInteraction } = useResponsiveLayout()
  const experiments = useExperiments()
  const sessionListSearchThreshold = useAtomValue(sessionListSearchThresholdAtom)
  const [isSearchActionsOpen, setIsSearchActionsOpen] = useState(false)
  const pluginNavItems = usePluginSlot<PluginContributionNavItem>('nav.items')
  const executePluginCommand = usePluginCommandExecutor()
  const pluginLanguage = i18n.resolvedLanguage ?? i18n.language
  const shouldShowSearchActions = !isSidebarCollapsed && (isSearchActionsOpen || isBatchMode)
  const shouldShowSearchRow = !hideSearchRow && !isSidebarCollapsed &&
    (routeSearch != null || shouldShowSidebarSearchRow({
      hasActiveSearchControls,
      isBatchMode,
      isSearchActionsOpen,
      sessionCount,
      threshold: sessionListSearchThreshold
    }))
  const focusSearchInput = React.useCallback(() => {
    setIsSearchActionsOpen(true)
    window.setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.sidebar-header .sidebar-list-header__search-input input')
      input?.focus()
      input?.select()
    }, 0)
  }, [])

  React.useEffect(() =>
    addDesktopViewShortcutListener((action) => {
      if (action === 'find') {
        focusSearchInput()
      }
    }), [focusSearchInput])

  const sideAction = hideSideAction
    ? null
    : (
      <Tooltip
        title={isTouchInteraction ? undefined : (
          isCompactLayout ? t('common.close') : (
            isSidebarCollapsed ? t('common.expand') : t('common.collapse')
          )
        )}
      >
        <Button
          className='sidebar-list-header__icon-action sidebar-collapse-btn'
          type='text'
          aria-label={isCompactLayout ? t('common.close') : (
            isSidebarCollapsed ? t('common.expand') : t('common.collapse')
          )}
          onClick={isCompactLayout
            ? onCloseSidebar
            : onToggleSidebarCollapsed}
        >
          <MaterialSymbol
            name={isCompactLayout ? 'close' : isSidebarCollapsed ? 'dock_to_right' : 'left_panel_close'}
          />
        </Button>
      </Tooltip>
    )

  const resolveTooltipTitle = React.useCallback(
    (title: React.ReactNode) => isTouchInteraction ? undefined : title,
    [isTouchInteraction]
  )
  const resolveNavigationContextMenuItems = React.useCallback((
    item?: SidebarHeaderNavigationItem
  ): MenuProps['items'] => {
    if (navigationContextMenuItems == null) return undefined
    return typeof navigationContextMenuItems === 'function'
      ? navigationContextMenuItems({ item })
      : navigationContextMenuItems
  }, [navigationContextMenuItems])
  const wrapNavigationContextMenu = React.useCallback((
    node: React.ReactElement,
    item?: SidebarHeaderNavigationItem
  ) => {
    const items = resolveNavigationContextMenuItems(item)
    if (items == null || items.length === 0) return node

    return (
      <Dropdown
        key={item?.key}
        overlayClassName='sidebar-header-navigation-context-dropdown'
        trigger={['contextMenu']}
        menu={{ items }}
      >
        {node}
      </Dropdown>
    )
  }, [resolveNavigationContextMenuItems])
  const fallbackNavigationItems = React.useMemo<SidebarHeaderNavigationItem[]>(() => {
    const sessionEntry = {
      creating: {
        icon: 'chat_bubble',
        label: t('common.creatingChat')
      },
      session: {
        icon: 'edit_square',
        label: t('common.newChat')
      },
      list: {
        icon: 'forum',
        label: t('common.sessions')
      }
    }[sessionEntryMode]
    const automationEntry = {
      creating: {
        icon: 'add_task',
        label: t('automation.creatingRule')
      },
      item: {
        icon: 'add_task',
        label: t('automation.newTask')
      },
      list: {
        icon: 'schedule',
        label: t('common.scheduledTasks')
      }
    }[automationEntryMode]
    const pluginEntry = {
      creating: {
        icon: { base: 'extension', badge: 'add_box' },
        label: t('pluginStore.createPlugin')
      },
      item: {
        icon: 'extension',
        label: t('common.pluginStore')
      },
      marketplace: {
        icon: 'extension',
        label: t('common.pluginStore')
      },
      list: {
        icon: 'extension',
        label: t('common.pluginStore')
      }
    }[pluginEntryMode]
    const coreItems = buildNavItems({
      currentPath: location.pathname,
      experiments,
      t
    }).map((item): SidebarHeaderNavigationItem => {
      const isAutomationItem = item.key === 'automation'
      const isPluginStoreItem = item.key === 'plugins'
      const isSessionsItem = item.key === 'sessions'
      const isActive = isSessionsItem
        ? sessionEntryMode === 'creating'
        : isAutomationItem
        ? automationEntryMode === 'creating'
        : isPluginStoreItem
        ? pluginEntryMode === 'creating' || pluginEntryMode === 'marketplace'
        : item.active
      const sessionActions = isSessionsItem
        ? [
          ...(sessionEntryMode === 'list'
            ? [{
              filled: false,
              icon: 'edit_square',
              key: 'new-session',
              label: t('common.newChat'),
              onSelect: onCreateSession
            }]
            : [])
        ]
        : undefined
      const automationActions = isAutomationItem && automationEntryMode === 'list'
        ? [{
          filled: false,
          icon: 'add_task',
          key: 'new-automation-task',
          label: t('automation.newTask'),
          onSelect: () => {
            void navigate('/automation?mode=create')
          }
        }]
        : undefined
      const pluginActions = isPluginStoreItem
        ? pluginEntryMode === 'creating'
          ? [{
            filled: false,
            icon: 'storefront',
            key: 'plugin-marketplace',
            label: t('pluginStore.marketplace'),
            onSelect: () => {
              void navigate('/plugins')
            }
          }]
          : [{
            filled: false,
            icon: { base: 'extension', badge: 'add_box' },
            key: 'create-plugin',
            label: t('pluginStore.createPlugin'),
            onSelect: () => {
              void navigate('/plugins?mode=create')
            }
          }]
        : undefined

      return {
        actions: sessionActions ?? automationActions ?? pluginActions,
        activeLabel: isSessionsItem && isActive
          ? sessionEntry.label
          : isAutomationItem && isActive
          ? automationEntry.label
          : isPluginStoreItem && isActive
          ? pluginEntry.label
          : undefined,
        icon: isSessionsItem
          ? sessionEntry.icon
          : isAutomationItem
          ? automationEntry.icon
          : isPluginStoreItem
          ? pluginEntry.icon
          : item.icon,
        isActive,
        key: item.key,
        label: isSessionsItem
          ? sessionEntry.label
          : isAutomationItem
          ? automationEntry.label
          : isPluginStoreItem
          ? pluginEntry.label
          : item.label,
        shortcut: isSessionsItem && sessionEntryMode === 'session'
          ? formatShortcutLabel(newSessionShortcut, isMac)
          : undefined,
        onSelect: () => {
          if (isSessionsItem) {
            if (sessionEntryMode === 'creating') {
              return
            }
            if (sessionEntryMode === 'session') {
              onCreateSession()
              return
            }
            onOpenSessionList?.()
            return
          }
          if (isAutomationItem) {
            if (automationEntryMode === 'creating') {
              return
            }
            if (automationEntryMode === 'item') {
              void navigate('/automation?mode=create')
              return
            }
            void navigate('/automation')
            return
          }
          if (isPluginStoreItem) {
            if (pluginEntryMode === 'creating') {
              return
            }
            void navigate('/plugins')
            return
          }
          void navigate(isAutomationItem && isActive ? '/automation?mode=create' : item.path)
        }
      }
    })

    const contributedItems = pluginNavItems.map((item): SidebarHeaderNavigationItem => {
      const route = item.route ?? `/plugins/${item.pluginScope}/${item.id}`
      const isActive = location.pathname === route
      return {
        icon: item.icon ?? 'layers',
        isActive,
        key: `plugin:${item.pluginScope}:${item.id}`,
        label: resolvePluginContributionText(item, 'title', pluginLanguage) ?? item.title,
        onSelect: () => {
          if (item.route == null && item.command != null && executePluginCommand != null) {
            void executePluginCommand(item.pluginScope, item.command)
            return
          }
          void navigate(route)
        }
      }
    })

    return [...coreItems, ...contributedItems]
  }, [
    automationEntryMode,
    executePluginCommand,
    experiments,
    location.pathname,
    navigate,
    onCreateSession,
    onOpenSessionList,
    newSessionShortcut,
    isMac,
    pluginEntryMode,
    pluginNavItems,
    pluginLanguage,
    sessionEntryMode,
    t
  ])
  const resolvedNavigationItems = navigationItems ?? fallbackNavigationItems
  const navigationItemByKey = React.useMemo(
    () => new Map(resolvedNavigationItems.map(item => [item.key, item])),
    [resolvedNavigationItems]
  )
  const quickLinkItems = React.useMemo<HostSidebarQuickLinkItem[]>(
    () =>
      resolvedNavigationItems.map((item) => {
        const isActive = item.isActive === true

        return {
          active: isActive,
          activeLabel: item.activeLabel,
          actions: item.actions?.map(action => ({
            disabled: false,
            icon: renderQuickLinkIcon(action.icon, action.filled === true),
            key: action.key,
            label: action.label,
            onSelect: action.onSelect
          })),
          icon: renderQuickLinkIcon(item.icon, isActive),
          key: item.key,
          label: item.label,
          shortcut: item.shortcut,
          onSelect: item.onSelect
        }
      }),
    [resolvedNavigationItems]
  )

  const quickLinks = !isSidebarCollapsed
    ? (
      wrapNavigationContextMenu(
        <HostSidebarQuickLinks
          items={quickLinkItems}
          onItemContextMenu={(event, item) => {
            const sourceItem = navigationItemByKey.get(item.key)
            if ((resolveNavigationContextMenuItems(sourceItem)?.length ?? 0) > 0) {
              event.stopPropagation()
            }
          }}
          renderActionWrapper={(action, node) => (
            <Tooltip key={action.key} title={resolveTooltipTitle(action.label)}>
              {node}
            </Tooltip>
          )}
          renderItemWrapper={(node, item) =>
            wrapNavigationContextMenu(
              node,
              navigationItemByKey.get(item.key)
            )}
        />
      )
    )
    : null

  return (
    <HostSidebarListHeader
      className='sidebar-header'
      compact={isCompactLayout}
      collapsed={isSidebarCollapsed}
      sideAction={sideAction ?? undefined}
    >
      {quickLinks}
      {routeSearch != null && shouldShowSearchRow && (
        <div className='header-search-row'>
          <div className='search-input-wrap'>
            <SidebarListSearchInput
              className='search-input'
              placeholder={routeSearch.placeholder}
              value={routeSearch.value}
              onChange={(event) => routeSearch.onChange(event.target.value)}
              suffix={routeSearch.suffix}
              allowClear
            />
          </div>
        </div>
      )}
      {routeSearch == null && shouldShowSearchRow && (
        <SidebarHeaderSearchActions
          adapterFilters={adapterFilters}
          availableAdapters={availableAdapters}
          availableTags={availableTags}
          hasActiveSearchControls={hasActiveSearchControls}
          isBatchMode={isBatchMode}
          searchQuery={searchQuery}
          selectedCount={selectedCount}
          shouldShowSearchActions={shouldShowSearchActions}
          sortOrder={sortOrder}
          sortSelection={sortSelection}
          tagFilters={tagFilters}
          totalCount={totalCount}
          canBatchDelete={canBatchDelete}
          onBatchArchive={onBatchArchive}
          onBatchDelete={onBatchDelete}
          onBatchStar={onBatchStar}
          onAdapterFilterChange={onAdapterFilterChange}
          onSearchChange={onSearchChange}
          onSortOrderChange={onSortOrderChange}
          onSelectAll={onSelectAll}
          onTagFilterChange={onTagFilterChange}
          onToggleBatchMode={onToggleBatchMode}
          onToggleSearchActions={() => setIsSearchActionsOpen((prev) => !prev)}
        />
      )}
    </HostSidebarListHeader>
  )
}
