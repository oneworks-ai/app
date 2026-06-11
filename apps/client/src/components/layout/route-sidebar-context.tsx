import { Fragment, createContext, useContext } from 'react'
import type { ReactNode } from 'react'

import type { MenuProps } from 'antd'

import type { NavRailWindowBarAction } from '#~/components/NavRail'
import type { IconAsset } from '#~/components/icons/IconAsset'
import type { NavRailMoreMenuSection } from '#~/components/nav-rail-more-menu'

export type RouteSidebarListContextMenuItem = NonNullable<MenuProps['items']>[number]
export interface RouteSidebarListContextMenuConfig {
  items: RouteSidebarListContextMenuItem[]
  selectedKeys?: string[]
}

export interface RouteSidebarListContextMenuTarget {
  groupKey?: string
  itemKey?: string
  kind: 'group' | 'item' | 'root'
}

export type RouteSidebarListContextMenuStatic =
  | RouteSidebarListContextMenuConfig
  | RouteSidebarListContextMenuItem[]

export type RouteSidebarListContextMenuFactory = (
  target: RouteSidebarListContextMenuTarget
) => RouteSidebarListContextMenuStatic | undefined

export type RouteSidebarListContextMenuItems =
  | RouteSidebarListContextMenuStatic
  | RouteSidebarListContextMenuFactory

export interface RouteSidebarListItem {
  activeIcon?: IconAsset
  contextMenuItems?: RouteSidebarListContextMenuItems
  icon?: IconAsset
  key: string
  label: ReactNode
  searchText?: string
}

export interface RouteSidebarListGroup {
  activeIcon?: IconAsset
  contextMenuItems?: RouteSidebarListContextMenuItems
  icon?: IconAsset
  items: RouteSidebarListItem[]
  key: string
  label?: ReactNode
  searchableText?: string
  selectable?: boolean
}

export interface RouteSidebarOverride {
  ariaLabel?: string
  activeKey?: string
  contextMenuItems?: RouteSidebarListContextMenuItems
  emptyText?: ReactNode
  groups: RouteSidebarListGroup[]
  key: string
  search: {
    placeholder?: string
    suffix?: ReactNode
    value: string
    onChange: (value: string) => void
  }
  onSelectItem: (item: RouteSidebarListItem) => void
}

export interface RouteWindowBarOverride {
  actions: NavRailWindowBarAction[]
  /**
   * Provider key. Route-owned chrome and plugin-provided chrome should use
   * distinct keys so AppShell can merge them instead of replacing one source
   * with another.
   */
  key: string
}

export interface RouteMoreMenuOverride {
  contextMenuSections?: NavRailMoreMenuSection[]
  footerAfter?: ReactNode
  footerBefore?: ReactNode
  /**
   * Provider key. Keep one stable key per route/plugin source; the context
   * merges all active providers into the shared NavRail menu and footer slots.
   */
  key: string
  sections: NavRailMoreMenuSection[]
  selectedKeys?: string[]
}

export type RouteWindowBarOverrideMap = Record<string, RouteWindowBarOverride>
export type RouteMoreMenuOverrideMap = Record<string, RouteMoreMenuOverride>

export const mergeRouteWindowBarOverrides = (
  overridesByKey: RouteWindowBarOverrideMap
): RouteWindowBarOverride | null => {
  const overrides = Object.values(overridesByKey)
  if (overrides.length === 0) return null

  return {
    actions: overrides.flatMap(override => override.actions),
    key: overrides.map(override => override.key).join('|')
  }
}

const renderRouteFooterSlot = (
  nodes: Array<{ key: string; node: ReactNode | undefined }>
): ReactNode => {
  const visibleNodes = nodes.filter((entry): entry is { key: string; node: ReactNode } => entry.node != null)
  if (visibleNodes.length === 0) return undefined
  if (visibleNodes.length === 1) return visibleNodes[0].node

  return visibleNodes.map(({ key, node }) => (
    <Fragment key={key}>
      {node}
    </Fragment>
  ))
}

export const mergeRouteMoreMenuOverrides = (
  overridesByKey: RouteMoreMenuOverrideMap
): RouteMoreMenuOverride | null => {
  const overrides = Object.values(overridesByKey)
  if (overrides.length === 0) return null

  return {
    contextMenuSections: overrides.flatMap(override => override.contextMenuSections ?? []),
    footerAfter: renderRouteFooterSlot(overrides.map(override => ({
      key: `${override.key}:after`,
      node: override.footerAfter
    }))),
    footerBefore: renderRouteFooterSlot(overrides.map(override => ({
      key: `${override.key}:before`,
      node: override.footerBefore
    }))),
    key: overrides.map(override => override.key).join('|'),
    sections: overrides.flatMap(override => override.sections),
    selectedKeys: Array.from(new Set(overrides.flatMap(override => override.selectedKeys ?? [])))
  }
}

interface RouteSidebarContextValue {
  clearRouteMoreMenu: (key: string) => void
  clearRouteSidebar: (key: string) => void
  clearRouteWindowBar: (key: string) => void
  hasRouteSidebarProvider: boolean
  routeMoreMenu: RouteMoreMenuOverride | null
  routeSidebar: RouteSidebarOverride | null
  routeWindowBar: RouteWindowBarOverride | null
  setRouteMoreMenu: (override: RouteMoreMenuOverride) => void
  setRouteSidebar: (override: RouteSidebarOverride) => void
  setRouteWindowBar: (override: RouteWindowBarOverride) => void
}

const noop = () => {}

const RouteSidebarContext = createContext<RouteSidebarContextValue>({
  clearRouteMoreMenu: noop,
  clearRouteWindowBar: noop,
  clearRouteSidebar: noop,
  hasRouteSidebarProvider: false,
  routeMoreMenu: null,
  routeSidebar: null,
  routeWindowBar: null,
  setRouteMoreMenu: noop,
  setRouteSidebar: noop,
  setRouteWindowBar: noop
})

export const RouteSidebarProvider = RouteSidebarContext.Provider

export function useRouteSidebar() {
  return useContext(RouteSidebarContext)
}
