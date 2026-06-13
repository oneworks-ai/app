/* eslint-disable max-lines -- shared route panel tabs coordinate Dockview tabs, panel chrome actions, drag/drop, and context menus together. */
import 'dockview/dist/styles/dockview.css'
import './RouteContainerPanelTabs.scss'

import { Dropdown, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import * as Dockview from 'dockview'
import type {
  BuiltInContextMenuItem,
  GetTabContextMenuItemsParams,
  IDockviewHeaderActionsProps,
  IDockviewPanelHeaderProps,
  IDockviewPanelProps,
  ReactContextMenuItemConfig,
  SerializedDockview
} from 'dockview'
import type { DragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import {
  NAV_RAIL_MORE_DROPDOWN_CLASS,
  buildNavRailMoreMenuItems,
  getNavRailMoreMenuSelectedKeys
} from '#~/components/nav-rail-more-menu'
import type { NavRailMoreMenuSection } from '#~/components/nav-rail-more-menu'

const ROUTE_CONTAINER_PANEL_DOCK_PANEL_COMPONENT = 'route-container-panel-dock-content'
const ROUTE_CONTAINER_PANEL_DOCK_TAB_COMPONENT = 'route-container-panel-dock-tab'
const ROUTE_CONTAINER_PANEL_DOCK_EXTERNAL_TAB_MIME = 'application/vnd.oneworks.route-container-panel-tab+json'
const ROUTE_CONTAINER_PANEL_DOCK_EXTERNAL_TAB_POINTER_DROP_EVENT = 'route-container-panel-dock:external-tab-drop'
const ROUTE_CONTAINER_PANEL_DOCK_CONTEXT_MENU_OPEN_EVENT = 'route-container-panel-dock:context-menu-open'
const ROUTE_CONTAINER_PANEL_DOCK_EXTERNAL_TAB_POINTER_DRAG_THRESHOLD = 12
const ROUTE_CONTAINER_PANEL_DOCK_SELECTOR = '.route-container-panel-dock'

/**
 * Generic route-panel tab descriptor.
 *
 * The panel components own tab chrome, icon sizing, hover/active states,
 * tooltips, close affordances, context-menu wiring, and Dockview behavior.
 * Routes/plugins own which tabs exist, their business labels, and the content
 * mapped to each tab.
 */
export interface RouteContainerPanelTabItem<TabKey extends string> {
  activeIcon?: string
  badge?: ReactNode
  disabled?: boolean
  icon: string
  iconNode?: ReactNode
  key: TabKey
  label: string
  /**
   * A non-empty title opts the tab into hover-close affordances when the tab row is closable.
   */
  title?: string
}

/**
 * Context passed to route-owned tab menu builders.
 *
 * Use this to return structured menu items. Do not inspect tab DOM or re-create
 * panel tab interactions outside the component.
 */
export interface RouteContainerPanelTabMenuContext<TabKey extends string> {
  activeTab: TabKey | null
  closeTab: (tabKey: TabKey) => void
  isActive: boolean
  isClosable: boolean
  isOpened: boolean
  selectTab: (tabKey: TabKey) => void
  tab: RouteContainerPanelTabItem<TabKey>
}

export type RouteContainerPanelContextMenuTarget = 'blank' | 'tab'

export interface RouteContainerPanelContextMenuContext<TabKey extends string> {
  activeTab: TabKey | null
  closeTab: (tabKey: TabKey) => void
  isActive: boolean
  isClosable: boolean
  isOpened: boolean
  openedTabs: readonly TabKey[]
  panelKey?: string
  selectTab: (tabKey: TabKey) => void
  tab?: RouteContainerPanelTabItem<TabKey>
  tabs: Array<RouteContainerPanelTabItem<TabKey>>
  target: RouteContainerPanelContextMenuTarget
  visibleTabs: Array<RouteContainerPanelTabItem<TabKey>>
}

/**
 * Lightweight controlled tab row for simple route panels.
 *
 * Route code controls `activeTab` and `openedTabs`, including query/store
 * persistence. This component only owns shared tab presentation and close/menu
 * interactions. Use `RouteContainerPanelDockWorkspace` when the route needs the
 * full chat-style dock behavior: drag, split, group actions, or dock-level
 * context menus.
 */
export interface RouteContainerPanelTabsProps<TabKey extends string> {
  activeTab: TabKey
  ariaLabel: string
  className?: string
  closable?: boolean
  closeLabel?: (title: string) => string
  getTabMenuItems?: (context: RouteContainerPanelTabMenuContext<TabKey>) => NonNullable<MenuProps['items']>
  labelMode?: 'icon-only' | 'responsive'
  minOpenTabs?: number
  openedTabs: readonly TabKey[]
  tabs: Array<RouteContainerPanelTabItem<TabKey>>
  tooltipPlacement?: 'bottom' | 'left' | 'right' | 'top'
  onTabChange: (tabKey: TabKey, openedTabs: TabKey[]) => void
  onTabClose?: (tabKey: TabKey) => void
}

/**
 * Dock tab descriptor with route-owned content.
 *
 * `content` may be a render function when it needs the resolved tab metadata.
 * Keep plugin/route extension resolution outside the dock, then pass the final
 * content renderer here.
 */
export interface RouteContainerPanelDockTabItem<TabKey extends string> extends RouteContainerPanelTabItem<TabKey> {
  content: ReactNode | ((context: RouteContainerPanelDockTabRenderContext<TabKey>) => ReactNode)
}

export interface RouteContainerPanelDockTabRenderContext<TabKey extends string> {
  isVisible: boolean
  tab: RouteContainerPanelDockTabItem<TabKey>
  tabKey: TabKey
}

export interface RouteContainerPanelDockDefaultContentRenderContext<TabKey extends string> {
  activeTab: TabKey | null
  openedTabs: readonly TabKey[]
  panelKey?: string
  tabs: Array<RouteContainerPanelDockTabItem<TabKey>>
  visibleTabs: Array<RouteContainerPanelDockTabItem<TabKey>>
}

export interface RouteContainerPanelDockExternalTabDropContext<TabKey extends string> {
  sourceWorkspaceKey: string
  tab: RouteContainerPanelDockTabItem<TabKey>
  tabKey: TabKey
  targetWorkspaceKey: string
}

export interface RouteContainerPanelDockExternalTabDropTarget {
  selector: string
  targetWorkspaceKey: string
}

export interface RouteContainerPanelDockExternalTabDragOptions<TabKey extends string> {
  canDrop?: (context: RouteContainerPanelDockExternalTabDropContext<TabKey>) => boolean
  draggable?: boolean
  droppable?: boolean
  dropTargets?: RouteContainerPanelDockExternalTabDropTarget[]
  onDrop?: (context: RouteContainerPanelDockExternalTabDropContext<TabKey>) => void
  scope: string
  workspaceKey: string
}

export interface RouteContainerPanelDockHeaderActionContext<TabKey extends string> {
  activeTab: TabKey | null
  groupActiveTab: RouteContainerPanelDockTabItem<TabKey> | null
  groupActiveTabKey: TabKey | null
  isTopRightGroup: boolean
  panelKey?: string
}

export interface RouteContainerPanelDockChromeActionConfig {
  active?: boolean
  activeIcon?: string
  disabled?: boolean
  enabled?: boolean
  icon?: string
  key?: string
  label: string
  onSelect: () => void
}

/**
 * Panel-level chrome actions owned by the dock, not by a tab.
 *
 * Use this for common panel mechanics such as fullscreen, minimize, and close so
 * placement, icon size, tooltip behavior, and the top-right-group rule stay
 * consistent across chat, workspace, Agent Room, and route panels. Keep
 * business tab commands in `getHeaderActions`; keep panel chrome commands here.
 */
export interface RouteContainerPanelDockChromeActionsConfig {
  close?: RouteContainerPanelDockChromeActionConfig
  fullscreen?: RouteContainerPanelDockChromeActionConfig
  minimize?: RouteContainerPanelDockChromeActionConfig
}

/**
 * Structured action shown in a Dockview group header.
 *
 * Use this for generic panel-level commands so icon sizing, active state, and
 * disabled styling remain aligned with the route chrome. Business command
 * selection still belongs to the route/plugin layer.
 */
export interface RouteContainerPanelDockActionItem {
  active?: boolean
  activeIcon?: string
  disabled?: boolean
  icon: string
  key: string
  label: string
  menuItems?: MenuProps['items']
  menuSections?: NavRailMoreMenuSection[]
  menuSelectedKeys?: string[]
  onMenuOpenChange?: (open: boolean) => void
  onSelect?: () => void
}

type RouteContainerPanelDockContextMenuItem = BuiltInContextMenuItem | ReactContextMenuItemConfig

/**
 * Full route-panel Dockview workspace.
 *
 * This component owns Dockview integration and interaction mechanics: visible
 * tabs, close fallback, drag/drop, split/floating groups, header actions,
 * context-menu plumbing, tooltip labels, and optional layout persistence.
 * Routes own business state and policy: available tabs, active/opened tab
 * persistence, menu sections, plugin-provided entries, and tab content.
 *
 * Do not build a route-local dock header or context-menu system around this.
 * If another route needs a generic dock capability, add it here as a structured
 * prop/callback and keep business-specific extension registration outside.
 */
export interface RouteContainerPanelDockProps<TabKey extends string> {
  activeTab: TabKey | null
  ariaLabel: string
  className?: string
  closable?: boolean
  closeLabel?: (title: string) => string
  createMenuIcon?: string
  createMenuItems?: MenuProps['items']
  createMenuLabel?: string
  createMenuSections?: NavRailMoreMenuSection[]
  createMenuSelectedKeys?: string[]
  defaultContent?: ReactNode | ((context: RouteContainerPanelDockDefaultContentRenderContext<TabKey>) => ReactNode)
  disableFloatingGroups?: boolean
  externalTabDrag?: RouteContainerPanelDockExternalTabDragOptions<TabKey>
  getContextMenuSections?: (
    context: RouteContainerPanelContextMenuContext<TabKey>
  ) => NavRailMoreMenuSection[]
  getHeaderActions?: (
    context: RouteContainerPanelDockHeaderActionContext<TabKey>
  ) => RouteContainerPanelDockActionItem[]
  getTabContextMenuItems?: (
    context: RouteContainerPanelTabMenuContext<TabKey>
  ) => RouteContainerPanelDockContextMenuItem[]
  headerActions?: RouteContainerPanelDockActionItem[]
  labelMode?: 'icon-only' | 'responsive'
  minOpenTabs?: number
  openedTabs: readonly TabKey[]
  /**
   * Shared panel chrome actions appended to the top-right Dockview group and
   * empty dock header.
   *
   * This is the first-class API for common panel mechanics such as minimize and
   * fullscreen. Routes provide labels and callbacks; the dock owns placement and
   * presentation. Do not inject these through `getHeaderActions` from a
   * route-specific wrapper unless the action is truly tab-specific.
   */
  panelChromeActions?: RouteContainerPanelDockChromeActionsConfig
  panelKey?: string
  storageKey?: string
  tabs: Array<RouteContainerPanelDockTabItem<TabKey>>
  onCreateMenuClick?: MenuProps['onClick']
  onCreateMenuOpenChange?: (open: boolean) => void
  onTabChange: (tabKey: TabKey | null, openedTabs: TabKey[]) => void
  onTabClose?: (tabKey: TabKey) => void
}

interface RouteContainerPanelDockContextValue {
  activeTab: string | null
  closeLabel?: (title: string) => string
  closeTab: (tabKey: string) => void
  closable: boolean
  createMenuIcon: string
  createMenuItems?: MenuProps['items']
  createMenuLabel?: string
  createMenuSections: NavRailMoreMenuSection[]
  createMenuSelectedKeys?: string[]
  externalTabDrag?: RouteContainerPanelDockExternalTabDragOptions<string>
  getHeaderActions?: (
    context: RouteContainerPanelDockHeaderActionContext<string>
  ) => RouteContainerPanelDockActionItem[]
  hasContextMenu: boolean
  headerActions: RouteContainerPanelDockActionItem[]
  isTabClosable: (tabKey: string, localTabCount?: number) => boolean
  minOpenTabs: number
  openContextMenu: (
    event: RouteContainerPanelContextMenuEvent,
    context: RouteContainerPanelContextMenuContext<string>
  ) => void
  openedTabs: string[]
  panelChromeActions: RouteContainerPanelDockActionItem[]
  panelKey?: string
  selectTab: (tabKey: string) => void
  tabs: Array<RouteContainerPanelDockTabItem<string>>
  tabByKey: Record<string, RouteContainerPanelDockTabItem<string>>
  visibleTabs: Array<RouteContainerPanelDockTabItem<string>>
  onCreateMenuClick?: MenuProps['onClick']
  onCreateMenuOpenChange?: (open: boolean) => void
}

interface RouteContainerPanelDockExternalTabDragPayload {
  scope: string
  sourceWorkspaceKey: string
  tabKey: string
}

const resolveRouteContainerPanelDockChromeAction = (
  defaultKey: string,
  defaultIcon: string,
  action: RouteContainerPanelDockChromeActionConfig | undefined,
  defaultActiveIcon?: string
): RouteContainerPanelDockActionItem | null => {
  if (action == null || action.enabled === false) return null

  return {
    icon: action.icon ?? defaultIcon,
    key: action.key ?? defaultKey,
    label: action.label,
    ...(action.active != null ? { active: action.active } : {}),
    ...(action.activeIcon != null || defaultActiveIcon != null
      ? { activeIcon: action.activeIcon ?? defaultActiveIcon }
      : {}),
    ...(action.disabled != null ? { disabled: action.disabled } : {}),
    onSelect: action.onSelect
  }
}

const buildRouteContainerPanelDockChromeActions = (
  actions: RouteContainerPanelDockChromeActionsConfig | undefined
): RouteContainerPanelDockActionItem[] =>
  [
    resolveRouteContainerPanelDockChromeAction('fullscreen', 'fullscreen', actions?.fullscreen, 'fullscreen_exit'),
    resolveRouteContainerPanelDockChromeAction('minimize', 'bottom_panel_close', actions?.minimize),
    resolveRouteContainerPanelDockChromeAction('close', 'disabled_by_default', actions?.close)
  ].filter((action): action is RouteContainerPanelDockActionItem => action != null)

interface RouteContainerPanelDockContextMenuOpenDetail {
  ownerId: string
}

interface RouteContainerPanelDockExternalTabPointerDropDetail extends RouteContainerPanelDockExternalTabDragPayload {
  targetWorkspaceKey: string
}

interface RouteContainerPanelDockExternalDropTarget {
  element: HTMLElement
  targetWorkspaceKey: string
}

interface RouteContainerPanelDockContextMenuState {
  sections: NavRailMoreMenuSection[]
  x: number
  y: number
}

type RouteContainerPanelContextMenuEvent = MouseEvent | ReactMouseEvent<HTMLElement>

const uniqueKnownValues = <Value extends string>(knownValues: readonly Value[], values: readonly Value[]) => {
  const knownValueSet = new Set(knownValues)
  const seen = new Set<Value>()
  const result: Value[] = []

  for (const value of values) {
    if (!knownValueSet.has(value) || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }

  return result
}

const readRouteContainerPanelDockLayout = (
  storageKey: string | undefined,
  tabs: Array<RouteContainerPanelDockTabItem<string>>
): SerializedDockview | null => {
  if (storageKey == null || typeof window === 'undefined') return null

  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null')
    const tabKeys = new Set(tabs.map(tab => tab.key))
    if (value == null || typeof value !== 'object' || value.panels == null || typeof value.panels !== 'object') {
      return null
    }

    return Object.keys(value.panels).every(panelId => tabKeys.has(panelId))
      ? value as SerializedDockview
      : null
  } catch {
    return null
  }
}

const writeRouteContainerPanelDockLayout = (
  storageKey: string | undefined,
  value: SerializedDockview
) => {
  if (storageKey == null || typeof window === 'undefined') return
  window.localStorage.setItem(storageKey, JSON.stringify(value))
}

const readRouteContainerPanelDockExternalTabPayload = (
  dataTransfer: DataTransfer
): RouteContainerPanelDockExternalTabDragPayload | null => {
  try {
    const value = JSON.parse(dataTransfer.getData(ROUTE_CONTAINER_PANEL_DOCK_EXTERNAL_TAB_MIME))
    if (
      value == null ||
      typeof value !== 'object' ||
      typeof value.scope !== 'string' ||
      typeof value.sourceWorkspaceKey !== 'string' ||
      typeof value.tabKey !== 'string'
    ) {
      return null
    }

    return value as RouteContainerPanelDockExternalTabDragPayload
  } catch {
    return null
  }
}

const readRouteContainerPanelDockExternalTabPointerDropDetail = (
  value: unknown
): RouteContainerPanelDockExternalTabPointerDropDetail | null => {
  if (
    value == null ||
    typeof value !== 'object' ||
    typeof (value as RouteContainerPanelDockExternalTabPointerDropDetail).scope !== 'string' ||
    typeof (value as RouteContainerPanelDockExternalTabPointerDropDetail).sourceWorkspaceKey !== 'string' ||
    typeof (value as RouteContainerPanelDockExternalTabPointerDropDetail).targetWorkspaceKey !== 'string' ||
    typeof (value as RouteContainerPanelDockExternalTabPointerDropDetail).tabKey !== 'string'
  ) {
    return null
  }

  return value as RouteContainerPanelDockExternalTabPointerDropDetail
}

const getRouteContainerPanelDockExternalDropTarget = (
  clientX: number,
  clientY: number,
  options: {
    dropTargets?: RouteContainerPanelDockExternalTabDropTarget[]
    scope: string
    sourceWorkspaceKey: string
  }
): RouteContainerPanelDockExternalDropTarget | null => {
  const target = document.elementFromPoint(clientX, clientY)
  if (!(target instanceof Element)) return null

  const dock = target.closest(ROUTE_CONTAINER_PANEL_DOCK_SELECTOR)
  if (dock instanceof HTMLElement) {
    const targetWorkspaceKey = dock.dataset.routeContainerPanelDockWorkspaceKey
    if (
      dock.dataset.routeContainerPanelDockDroppable === 'true' &&
      dock.dataset.routeContainerPanelDockScope === options.scope &&
      targetWorkspaceKey != null &&
      targetWorkspaceKey !== options.sourceWorkspaceKey
    ) {
      return {
        element: dock,
        targetWorkspaceKey
      }
    }
  }

  for (const dropTarget of options.dropTargets ?? []) {
    if (dropTarget.targetWorkspaceKey === options.sourceWorkspaceKey) continue

    try {
      const element = target.closest(dropTarget.selector)
      if (!(element instanceof HTMLElement)) continue

      return {
        element,
        targetWorkspaceKey: dropTarget.targetWorkspaceKey
      }
    } catch {
      continue
    }
  }

  return null
}

const resolveTopRightGroupId = (groups: IDockviewHeaderActionsProps['group'][]) => {
  const visibleGroups = groups
    .filter(group => group.api.isVisible && group.panels.length > 0 && group.api.location.type === 'grid')
    .map(group => ({ group, rect: group.element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 0 && rect.height > 0)

  if (visibleGroups.length === 0) return undefined

  const top = Math.min(...visibleGroups.map(({ rect }) => rect.top))
  return visibleGroups
    .filter(({ rect }) => Math.abs(rect.top - top) <= 2)
    .sort((left, right) => right.rect.right - left.rect.right || left.rect.left - right.rect.left)[0]
    ?.group.api.id
}

const RouteContainerPanelDockContext = createContext<RouteContainerPanelDockContextValue | null>(null)

const resolveRouteContainerPanelTabTitle = <TabKey extends string>(tab: RouteContainerPanelTabItem<TabKey>) => {
  const title = tab.title?.trim()
  return title != null && title.length > 0 ? title : tab.label
}

const hasRouteContainerPanelTabCloseTitle = <TabKey extends string>(tab: RouteContainerPanelTabItem<TabKey>) => {
  const title = tab.title?.trim()
  return title != null && title.length > 0
}

const renderRouteContainerPanelTabIcon = <TabKey extends string>(
  tab: RouteContainerPanelTabItem<TabKey>,
  options: {
    active?: boolean
    className: string
  }
) => {
  if (tab.iconNode != null) {
    return <span className={options.className}>{tab.iconNode}</span>
  }

  return (
    <span className={options.className}>
      <MaterialSymbol
        name={options.active === true && tab.activeIcon != null ? tab.activeIcon : tab.icon}
        aria-hidden='true'
      />
    </span>
  )
}

const getRouteContainerPanelDockGroupTabCount = (api: IDockviewPanelHeaderProps['api']) => api.group.panels.length

const isRouteContainerPanelDockContextMenuTarget = (target: EventTarget | null) => (
  target instanceof Element &&
  target.closest('.route-container-panel-dock-context-dropdown, .route-container-panel-dock__context-anchor') != null
)

const useRouteContainerPanelDockContext = () => {
  const context = useContext(RouteContainerPanelDockContext)
  if (context == null) {
    throw new Error('RouteContainerPanelDockWorkspace must be rendered inside its context provider')
  }
  return context
}

function RouteContainerPanelDockContent({ api, params }: IDockviewPanelProps<{ tabKey: string }>) {
  const { tabByKey } = useRouteContainerPanelDockContext()
  const tab = tabByKey[params.tabKey]
  const [isVisible, setIsVisible] = useState(() => api.isVisible)

  useEffect(() => {
    setIsVisible(api.isVisible)
    const disposable = api.onDidVisibilityChange(() => {
      setIsVisible(api.isVisible)
    })

    return () => disposable.dispose()
  }, [api])

  if (tab == null) return null

  const content = typeof tab.content === 'function'
    ? tab.content({ isVisible, tab, tabKey: tab.key })
    : tab.content

  const contentClassName = `route-container-panel-dock__content ${isVisible ? 'is-visible' : 'is-hidden'}`

  return <div className={contentClassName}>{content}</div>
}

function RouteContainerPanelDockTab({ api, containerApi, params }: IDockviewPanelHeaderProps<{ tabKey: string }>) {
  const {
    activeTab,
    closeLabel,
    closeTab,
    externalTabDrag,
    hasContextMenu,
    isTabClosable,
    openContextMenu,
    openedTabs,
    panelKey,
    selectTab,
    tabByKey,
    tabs,
    visibleTabs
  } = useRouteContainerPanelDockContext()
  const tab = tabByKey[params.tabKey]
  const [isExternalDragging, setIsExternalDragging] = useState(false)
  const externalPointerDropTargetRef = useRef<RouteContainerPanelDockExternalDropTarget | null>(null)
  const skipCloseClickRef = useRef(false)
  const [groupState, setGroupState] = useState(() => ({
    group: api.group,
    tabCount: getRouteContainerPanelDockGroupTabCount(api)
  }))

  const updateGroupState = useCallback(() => {
    setGroupState((current) => {
      const nextGroup = api.group
      const nextTabCount = getRouteContainerPanelDockGroupTabCount(api)
      return current.group === nextGroup && current.tabCount === nextTabCount
        ? current
        : { group: nextGroup, tabCount: nextTabCount }
    })
  }, [api])

  useEffect(() => {
    updateGroupState()
    const disposables = [
      api.onDidGroupChange(updateGroupState),
      containerApi.onDidLayoutChange(updateGroupState)
    ]

    return () => {
      disposables.forEach(disposable => disposable.dispose())
    }
  }, [api, containerApi, updateGroupState])

  useEffect(() => {
    updateGroupState()
    const { model } = groupState.group
    const disposables = [
      model.onDidAddPanel(updateGroupState),
      model.onDidRemovePanel(updateGroupState),
      model.onDidActivePanelChange(updateGroupState)
    ]

    return () => {
      disposables.forEach(disposable => disposable.dispose())
    }
  }, [groupState.group, updateGroupState])

  if (tab == null) return null

  const title = resolveRouteContainerPanelTabTitle(tab)
  const isClosable = isTabClosable(tab.key, groupState.tabCount)
  const tabCloseLabel = closeLabel?.(title) ?? title
  const canDragExternalTab = externalTabDrag?.draggable === true && tab.disabled !== true
  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!hasContextMenu) return

    openContextMenu(event, {
      activeTab,
      closeTab,
      isActive: activeTab === tab.key,
      isClosable,
      isOpened: openedTabs.includes(tab.key),
      openedTabs,
      panelKey,
      selectTab,
      tab,
      tabs,
      target: 'tab',
      visibleTabs
    })
  }
  const clearExternalPointerDropTarget = () => {
    externalPointerDropTargetRef.current?.element.classList.remove('is-external-drop-target')
    externalPointerDropTargetRef.current = null
  }
  const updateExternalPointerDropTarget = (clientX: number, clientY: number) => {
    if (externalTabDrag == null) return null

    const target = getRouteContainerPanelDockExternalDropTarget(clientX, clientY, {
      dropTargets: externalTabDrag.dropTargets,
      scope: externalTabDrag.scope,
      sourceWorkspaceKey: externalTabDrag.workspaceKey
    })

    if (
      target?.element === externalPointerDropTargetRef.current?.element &&
      target?.targetWorkspaceKey === externalPointerDropTargetRef.current?.targetWorkspaceKey
    ) {
      return target
    }

    clearExternalPointerDropTarget()
    target?.element.classList.add('is-external-drop-target')
    externalPointerDropTargetRef.current = target

    return target
  }
  const handleExternalPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!canDragExternalTab || externalTabDrag == null || event.button !== 0) return

    event.stopPropagation()
    selectTab(tab.key)
    api.setActive()
    const pointerId = event.pointerId
    const startX = event.clientX
    const startY = event.clientY
    const sourceWorkspaceKey = externalTabDrag.workspaceKey
    const scope = externalTabDrag.scope
    const tabKey = tab.key
    let didDrag = false

    const cleanup = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      clearExternalPointerDropTarget()
      setIsExternalDragging(false)
    }
    const handlePointerMove = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return

      const moveX = pointerEvent.clientX - startX
      const moveY = pointerEvent.clientY - startY
      if (
        !didDrag &&
        Math.hypot(moveX, moveY) <
          ROUTE_CONTAINER_PANEL_DOCK_EXTERNAL_TAB_POINTER_DRAG_THRESHOLD
      ) return

      didDrag = true
      pointerEvent.preventDefault()
      setIsExternalDragging(true)
      updateExternalPointerDropTarget(pointerEvent.clientX, pointerEvent.clientY)
    }
    const handlePointerUp = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return

      const target = didDrag
        ? updateExternalPointerDropTarget(pointerEvent.clientX, pointerEvent.clientY)
        : null
      cleanup()

      if (didDrag) {
        skipCloseClickRef.current = true
        window.setTimeout(() => {
          skipCloseClickRef.current = false
        }, 0)
      }

      if (target == null) return

      pointerEvent.preventDefault()
      pointerEvent.stopPropagation()
      const targetWorkspaceKey = target.targetWorkspaceKey
      if (externalTabDrag.onDrop != null) {
        const canDrop = externalTabDrag.canDrop?.({
          sourceWorkspaceKey,
          tab,
          tabKey,
          targetWorkspaceKey
        }) ?? true
        if (!canDrop) return

        externalTabDrag.onDrop({
          sourceWorkspaceKey,
          tab,
          tabKey,
          targetWorkspaceKey
        })
        return
      }

      window.dispatchEvent(
        new CustomEvent<RouteContainerPanelDockExternalTabPointerDropDetail>(
          ROUTE_CONTAINER_PANEL_DOCK_EXTERNAL_TAB_POINTER_DROP_EVENT,
          {
            detail: {
              scope,
              sourceWorkspaceKey,
              tabKey,
              targetWorkspaceKey
            }
          }
        )
      )
    }
    const handlePointerCancel = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return
      cleanup()
    }
    window.addEventListener('pointermove', handlePointerMove, { passive: false })
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
  }

  return (
    <div
      className={[
        'route-container-panel-dock-tab',
        isClosable ? 'is-closable' : '',
        canDragExternalTab ? 'is-external-draggable' : '',
        isExternalDragging ? 'is-external-dragging' : ''
      ].filter(Boolean).join(' ')}
      title={title}
      onClick={() => {
        selectTab(tab.key)
        api.setActive()
      }}
      onContextMenu={hasContextMenu ? handleContextMenu : undefined}
      onPointerDown={canDragExternalTab ? handleExternalPointerDown : undefined}
    >
      <span className='route-container-panel-dock-tab__icon'>
        {tab.iconNode ??
          <MaterialSymbol
            name={activeTab === tab.key && tab.activeIcon != null ? tab.activeIcon : tab.icon}
            aria-hidden='true'
          />}
      </span>
      <span className='route-container-panel-dock-tab__label'>{tab.label}</span>
      {tab.badge != null && <span className='route-container-panel-dock-tab__badge'>{tab.badge}</span>}
      {isClosable && (
        <button
          type='button'
          className='route-container-panel-dock-tab__close'
          aria-label={tabCloseLabel}
          title={tabCloseLabel}
          onClick={(event) => {
            event.stopPropagation()
            if (skipCloseClickRef.current) {
              event.preventDefault()
              skipCloseClickRef.current = false
              return
            }

            closeTab(tab.key)
          }}
          onPointerDown={canDragExternalTab ? handleExternalPointerDown : event => event.stopPropagation()}
        >
          <MaterialSymbol name='cancel' aria-hidden='true' />
        </button>
      )}
    </div>
  )
}

const stopDockHeaderActionPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
  event.stopPropagation()
}

const renderRouteContainerPanelSubmenuExpandIcon = () => (
  <span className='material-symbols-rounded nav-menu-submenu-chevron'>
    keyboard_arrow_right
  </span>
)

function RouteContainerPanelDockPrefixActions({ api }: IDockviewHeaderActionsProps) {
  return <RouteContainerPanelDockCreateAction onBeforeOpen={() => api.setActive()} />
}

function RouteContainerPanelDockCreateAction({
  onBeforeOpen
}: {
  onBeforeOpen?: () => void
}) {
  const {
    createMenuIcon,
    createMenuItems,
    createMenuLabel,
    createMenuSections,
    createMenuSelectedKeys,
    onCreateMenuClick,
    onCreateMenuOpenChange
  } = useRouteContainerPanelDockContext()
  const [isOpen, setIsOpen] = useState(false)
  const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac')
  const closeMenu = useCallback(() => setIsOpen(false), [])
  const sectionMenuItems = useMemo(() =>
    buildNavRailMoreMenuItems({
      closeMenu,
      isMac,
      sections: createMenuSections
    }), [closeMenu, createMenuSections, isMac])
  const menuItems = createMenuItems ?? sectionMenuItems
  const sectionSelectedKeys = useMemo(() => getNavRailMoreMenuSelectedKeys(createMenuSections), [createMenuSections])
  const selectedKeys = createMenuSelectedKeys ?? sectionSelectedKeys
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    onCreateMenuOpenChange?.(open)
  }

  if (createMenuLabel == null || menuItems == null || menuItems.length === 0) {
    return null
  }

  return (
    <div className='route-container-panel-dock__prefix-actions' onPointerDown={stopDockHeaderActionPointerDown}>
      <Dropdown
        overlayClassName={`${NAV_RAIL_MORE_DROPDOWN_CLASS} route-container-panel-dock-create-dropdown`}
        menu={{
          expandIcon: renderRouteContainerPanelSubmenuExpandIcon(),
          items: menuItems,
          onClick: onCreateMenuClick,
          selectedKeys,
          triggerSubMenuAction: 'click'
        }}
        open={isOpen}
        placement='bottomLeft'
        trigger={['click']}
        transitionName='ant-slide-down'
        onOpenChange={handleOpenChange}
      >
        <button
          type='button'
          className={[
            'route-container-panel-dock__create-action',
            isOpen ? 'is-open' : ''
          ].filter(Boolean).join(' ')}
          data-dock-panel-no-resize='true'
          aria-label={createMenuLabel}
          aria-haspopup='menu'
          aria-expanded={isOpen}
          title={createMenuLabel}
          onClick={onBeforeOpen}
        >
          <MaterialSymbol name={createMenuIcon} aria-hidden='true' />
        </button>
      </Dropdown>
    </div>
  )
}

function RouteContainerPanelDockHeaderActionButton({
  action
}: {
  action: RouteContainerPanelDockActionItem
}) {
  const [isOpen, setIsOpen] = useState(false)
  const icon = action.active && action.activeIcon != null ? action.activeIcon : action.icon
  const label = action.label
  const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac')
  const closeMenu = useCallback(() => setIsOpen(false), [])
  const sectionMenuItems = useMemo(() =>
    action.menuSections == null
      ? undefined
      : buildNavRailMoreMenuItems({
        closeMenu,
        isMac,
        sections: action.menuSections
      }), [action.menuSections, closeMenu, isMac])
  const sectionSelectedKeys = useMemo(
    () => action.menuSections == null ? [] : getNavRailMoreMenuSelectedKeys(action.menuSections),
    [action.menuSections]
  )
  const menuItems = action.menuItems ?? sectionMenuItems
  const selectedKeys = action.menuSelectedKeys ?? sectionSelectedKeys
  const button = (
    <Tooltip title={label} placement='top'>
      <button
        type='button'
        className={[
          'route-container-panel-dock__header-action',
          action.active ? 'is-active' : '',
          isOpen ? 'is-open' : ''
        ].filter(Boolean).join(' ')}
        aria-label={label}
        aria-pressed={action.active}
        disabled={action.disabled}
        title={label}
        onClick={menuItems == null || menuItems.length === 0 ? action.onSelect : undefined}
      >
        <MaterialSymbol name={icon} aria-hidden='true' />
      </button>
    </Tooltip>
  )

  if (menuItems == null || menuItems.length === 0) return button

  return (
    <Dropdown
      overlayClassName={`${NAV_RAIL_MORE_DROPDOWN_CLASS} route-container-panel-dock-action-dropdown`}
      menu={{
        expandIcon: renderRouteContainerPanelSubmenuExpandIcon(),
        items: menuItems,
        selectedKeys,
        triggerSubMenuAction: 'click'
      }}
      open={isOpen}
      placement='bottomRight'
      trigger={['click']}
      transitionName='ant-slide-down'
      onOpenChange={(open) => {
        setIsOpen(open)
        action.onMenuOpenChange?.(open)
      }}
    >
      {button}
    </Dropdown>
  )
}

function RouteContainerPanelDockHeaderActionButtons({
  actions
}: {
  actions: RouteContainerPanelDockActionItem[]
}) {
  const headerActions = actions

  if (headerActions.length === 0) return null

  return (
    <div className='route-container-panel-dock__header-actions' onPointerDown={stopDockHeaderActionPointerDown}>
      {headerActions.map(action => <RouteContainerPanelDockHeaderActionButton key={action.key} action={action} />)}
    </div>
  )
}

function RouteContainerPanelDockHeaderActions({
  activePanel,
  containerApi,
  group
}: IDockviewHeaderActionsProps) {
  const {
    activeTab,
    getHeaderActions,
    headerActions,
    panelChromeActions,
    panelKey,
    tabByKey
  } = useRouteContainerPanelDockContext()
  const [isTopRightGroup, setIsTopRightGroup] = useState(false)

  const updateActionsVisibility = useCallback(() => {
    setIsTopRightGroup(resolveTopRightGroupId(containerApi.groups) === group.api.id)
  }, [containerApi, group])

  useEffect(() => {
    updateActionsVisibility()
    const animationFrame = window.requestAnimationFrame(updateActionsVisibility)
    const disposables = [
      group.api.onDidDimensionsChange(updateActionsVisibility),
      containerApi.onDidAddGroup(updateActionsVisibility),
      containerApi.onDidLayoutChange(updateActionsVisibility),
      containerApi.onDidMaximizedGroupChange(updateActionsVisibility),
      containerApi.onDidRemoveGroup(updateActionsVisibility)
    ]

    return () => {
      window.cancelAnimationFrame(animationFrame)
      for (const disposable of disposables) disposable.dispose()
    }
  }, [containerApi, group, updateActionsVisibility])

  const groupActiveTab = activePanel == null ? null : tabByKey[activePanel.id] ?? null
  const tabHeaderActions = getHeaderActions?.({
    activeTab,
    groupActiveTab,
    groupActiveTabKey: groupActiveTab?.key ?? null,
    isTopRightGroup,
    panelKey
  }) ?? headerActions
  const resolvedHeaderActions = isTopRightGroup
    ? [...tabHeaderActions, ...panelChromeActions]
    : tabHeaderActions

  if (resolvedHeaderActions.length === 0) return null
  if (getHeaderActions == null && (!isTopRightGroup || activePanel == null)) return null

  return <RouteContainerPanelDockHeaderActionButtons actions={resolvedHeaderActions} />
}

const syncRouteContainerPanelDockPanels = (
  api: Dockview.DockviewApi,
  tabs: Array<RouteContainerPanelDockTabItem<string>>,
  activeTab: string | null
) => {
  const tabKeys = new Set(tabs.map(tab => tab.key))

  for (const panel of api.panels) {
    if (!tabKeys.has(panel.id)) api.removePanel(panel)
  }

  for (const tab of tabs) {
    const panel = api.getPanel(tab.key)
    if (panel == null) {
      api.addPanel({
        id: tab.key,
        component: ROUTE_CONTAINER_PANEL_DOCK_PANEL_COMPONENT,
        tabComponent: ROUTE_CONTAINER_PANEL_DOCK_TAB_COMPONENT,
        title: resolveRouteContainerPanelTabTitle(tab),
        renderer: 'always',
        inactive: tab.key !== activeTab,
        params: { tabKey: tab.key }
      })
      continue
    }

    panel.api.setTitle(resolveRouteContainerPanelTabTitle(tab))
    panel.api.updateParameters({ tabKey: tab.key })
    if (panel.api.renderer !== 'always') panel.api.setRenderer('always')
  }

  if (activeTab != null) api.getPanel(activeTab)?.api.setActive()
}

export function RouteContainerPanelTabs<TabKey extends string>({
  activeTab,
  ariaLabel,
  className,
  closable = false,
  closeLabel,
  getTabMenuItems,
  labelMode = 'icon-only',
  minOpenTabs = 1,
  openedTabs,
  tabs,
  tooltipPlacement = 'top',
  onTabChange,
  onTabClose
}: RouteContainerPanelTabsProps<TabKey>) {
  const tabKeys = tabs.map(tab => tab.key)
  const normalizedOpenedTabs = uniqueKnownValues(tabKeys, openedTabs)
  const openedTabSet = new Set(normalizedOpenedTabs)

  const selectTab = (tabKey: TabKey) => {
    onTabChange(tabKey, uniqueKnownValues(tabKeys, [...normalizedOpenedTabs, tabKey]))
  }

  const closeTab = (tabKey: TabKey) => {
    const tabIndex = normalizedOpenedTabs.indexOf(tabKey)
    const nextOpenedTabs = normalizedOpenedTabs.filter(openedTab => openedTab !== tabKey)
    const fallbackTab = nextOpenedTabs[Math.max(0, tabIndex - 1)] ?? nextOpenedTabs[0] ?? activeTab
    const nextActiveTab = activeTab === tabKey ? fallbackTab : activeTab

    onTabClose?.(tabKey)
    onTabChange(nextActiveTab, nextOpenedTabs)
  }

  const visibleTabs = closable
    ? tabs.filter(tab => openedTabSet.has(tab.key) || tab.key === activeTab)
    : tabs

  return (
    <div
      className={['route-container-panel-tabs', `is-${labelMode}`, className].filter(Boolean).join(' ')}
      role='tablist'
      aria-label={ariaLabel}
    >
      {visibleTabs.map((tab) => {
        const tabTitle = resolveRouteContainerPanelTabTitle(tab)
        const isActive = activeTab === tab.key
        const isOpened = openedTabSet.has(tab.key)
        const isClosable = closable &&
          hasRouteContainerPanelTabCloseTitle(tab) &&
          isOpened && normalizedOpenedTabs.length > minOpenTabs
        const tabCloseLabel = closeLabel?.(tabTitle) ?? tabTitle
        const context: RouteContainerPanelTabMenuContext<TabKey> = {
          activeTab,
          closeTab,
          isActive,
          isClosable,
          isOpened,
          selectTab,
          tab
        }
        const defaultMenuItems: NonNullable<MenuProps['items']> = isClosable
          ? [{
            key: `${tab.key}:close`,
            icon: <MaterialSymbol name='close' aria-hidden='true' />,
            label: tabCloseLabel,
            onClick: () => closeTab(tab.key)
          }]
          : []
        const customMenuItems = getTabMenuItems?.(context) ?? []
        const menuItems = [...customMenuItems, ...defaultMenuItems]
        const tabNode = (
          <span
            key={tab.key}
            className={`route-container-panel-tab ${isActive ? 'is-active' : ''} ${isClosable ? 'is-closable' : ''} ${
              tab.disabled === true ? 'is-disabled' : ''
            }`}
            data-opened={isOpened ? 'true' : undefined}
            role='presentation'
          >
            <Tooltip
              title={tabTitle}
              placement={tooltipPlacement}
              mouseEnterDelay={.3}
              mouseLeaveDelay={.08}
            >
              <button
                type='button'
                className='route-container-panel-tab__trigger'
                role='tab'
                aria-label={tabTitle}
                aria-selected={isActive}
                disabled={tab.disabled}
                title={tabTitle}
                onClick={() => selectTab(tab.key)}
              >
                {renderRouteContainerPanelTabIcon(tab, {
                  active: isActive,
                  className: 'route-container-panel-tab__icon'
                })}
                <span className='route-container-panel-tab__label'>{tab.label}</span>
                {tab.badge != null && <span className='route-container-panel-tab__badge'>{tab.badge}</span>}
              </button>
            </Tooltip>
            {isClosable && (
              <button
                type='button'
                className='route-container-panel-tab__close'
                aria-label={tabCloseLabel}
                title={tabCloseLabel}
                onClick={(event) => {
                  event.stopPropagation()
                  closeTab(tab.key)
                }}
                onPointerDown={event => event.stopPropagation()}
              >
                <MaterialSymbol name='cancel' aria-hidden='true' />
              </button>
            )}
          </span>
        )

        if (menuItems.length === 0) return tabNode

        return (
          <Dropdown
            key={tab.key}
            menu={{ items: menuItems }}
            overlayClassName='route-container-panel-tabs__context-menu'
            trigger={['contextMenu']}
          >
            {tabNode}
          </Dropdown>
        )
      })}
    </div>
  )
}

export function RouteContainerPanelDockWorkspace<TabKey extends string>({
  activeTab,
  ariaLabel,
  className,
  closable = false,
  closeLabel,
  createMenuIcon = 'add_box',
  createMenuItems,
  createMenuLabel,
  createMenuSections = [],
  createMenuSelectedKeys,
  defaultContent,
  disableFloatingGroups = false,
  externalTabDrag,
  getContextMenuSections,
  getHeaderActions,
  getTabContextMenuItems,
  headerActions = [],
  labelMode = 'icon-only',
  minOpenTabs = 0,
  openedTabs,
  panelChromeActions,
  panelKey,
  storageKey,
  tabs,
  onCreateMenuClick,
  onCreateMenuOpenChange,
  onTabChange,
  onTabClose
}: RouteContainerPanelDockProps<TabKey>) {
  const apiRef = useRef<Dockview.DockviewApi | null>(null)
  const contextMenuOwnerId = useId()
  const disposablesRef = useRef<Array<{ dispose: () => void }>>([])
  const isSyncingRef = useRef(false)
  const syncReleaseTimerRef = useRef<number | null>(null)
  const allTabs = useMemo(() => tabs.map(tab => tab as unknown as RouteContainerPanelDockTabItem<string>), [tabs])
  const tabKeys = useMemo(() => tabs.map(tab => tab.key), [tabs])
  const normalizedOpenedTabs = useMemo(() => uniqueKnownValues(tabKeys, openedTabs), [openedTabs, tabKeys])
  const effectiveActiveTab = activeTab ?? normalizedOpenedTabs[0] ?? null
  const visibleTabs = useMemo(() => {
    const openedTabSet = new Set(normalizedOpenedTabs)
    return (closable ? tabs.filter(tab => openedTabSet.has(tab.key) || tab.key === effectiveActiveTab) : tabs)
      .map(tab => tab as unknown as RouteContainerPanelDockTabItem<string>)
  }, [closable, effectiveActiveTab, normalizedOpenedTabs, tabs])
  const tabByKey = useMemo(() => Object.fromEntries(visibleTabs.map(tab => [tab.key, tab])), [visibleTabs])
  const resolvedPanelChromeActions = useMemo(
    () => buildRouteContainerPanelDockChromeActions(panelChromeActions),
    [panelChromeActions]
  )
  const activeTabRef = useRef<TabKey | null>(effectiveActiveTab)
  const normalizedOpenedTabsRef = useRef(normalizedOpenedTabs)
  const visibleTabsRef = useRef(visibleTabs)
  const [isExternalDropTarget, setIsExternalDropTarget] = useState(false)
  const [contextMenuState, setContextMenuState] = useState<RouteContainerPanelDockContextMenuState | null>(null)

  useEffect(() => {
    activeTabRef.current = effectiveActiveTab
    normalizedOpenedTabsRef.current = normalizedOpenedTabs
    visibleTabsRef.current = visibleTabs
  }, [effectiveActiveTab, normalizedOpenedTabs, visibleTabs])

  const disposeDockSubscriptions = useCallback(() => {
    disposablesRef.current.forEach(disposable => disposable.dispose())
    disposablesRef.current = []
  }, [])

  const persistLayout = useCallback(() => {
    const api = apiRef.current
    if (api == null || isSyncingRef.current) return
    writeRouteContainerPanelDockLayout(storageKey, api.toJSON())
  }, [storageKey])

  const canReceiveExternalTabDrag = useCallback((dataTransfer: DataTransfer) => (
    externalTabDrag?.droppable === true &&
    externalTabDrag.onDrop != null
  ), [externalTabDrag])

  const canDropExternalTabPayload = useCallback((
    payload: RouteContainerPanelDockExternalTabDragPayload | null
  ) => {
    if (payload == null || externalTabDrag?.droppable !== true || externalTabDrag.onDrop == null) {
      return false
    }

    const targetWorkspaceKey = externalTabDrag.workspaceKey
    if (payload.scope !== externalTabDrag.scope || payload.sourceWorkspaceKey === targetWorkspaceKey) {
      return false
    }

    const tab = tabs.find(candidate => candidate.key === payload.tabKey)
    if (tab == null || tab.disabled === true) return false

    return externalTabDrag.canDrop?.({
      sourceWorkspaceKey: payload.sourceWorkspaceKey,
      tab,
      tabKey: tab.key,
      targetWorkspaceKey
    }) ?? true
  }, [externalTabDrag, tabs])

  const handleExternalTabDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!canReceiveExternalTabDrag(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setIsExternalDropTarget(true)
  }, [canReceiveExternalTabDrag])

  const handleExternalTabDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!canReceiveExternalTabDrag(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setIsExternalDropTarget(true)
  }, [canReceiveExternalTabDrag])

  const handleExternalTabDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
    setIsExternalDropTarget(false)
  }, [])

  const handleExternalTabDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!canReceiveExternalTabDrag(event.dataTransfer)) return

    const payload = readRouteContainerPanelDockExternalTabPayload(event.dataTransfer)
    if (!canDropExternalTabPayload(payload) || payload == null || externalTabDrag?.onDrop == null) {
      setIsExternalDropTarget(false)
      return
    }

    const tab = tabs.find(candidate => candidate.key === payload.tabKey)
    if (tab == null) {
      setIsExternalDropTarget(false)
      return
    }

    event.preventDefault()
    event.stopPropagation()
    setIsExternalDropTarget(false)
    externalTabDrag.onDrop({
      sourceWorkspaceKey: payload.sourceWorkspaceKey,
      tab,
      tabKey: tab.key,
      targetWorkspaceKey: externalTabDrag.workspaceKey
    })
  }, [canDropExternalTabPayload, canReceiveExternalTabDrag, externalTabDrag, tabs])

  useEffect(() => {
    if (externalTabDrag?.droppable !== true || externalTabDrag.onDrop == null) return

    const handlePointerDrop = (event: Event) => {
      const detail = readRouteContainerPanelDockExternalTabPointerDropDetail(
        (event as CustomEvent<unknown>).detail
      )
      if (detail == null || detail.targetWorkspaceKey !== externalTabDrag.workspaceKey) return

      const payload: RouteContainerPanelDockExternalTabDragPayload = {
        scope: detail.scope,
        sourceWorkspaceKey: detail.sourceWorkspaceKey,
        tabKey: detail.tabKey
      }
      if (!canDropExternalTabPayload(payload)) return

      const tab = tabs.find(candidate => candidate.key === detail.tabKey)
      if (tab == null) return

      externalTabDrag.onDrop?.({
        sourceWorkspaceKey: detail.sourceWorkspaceKey,
        tab,
        tabKey: tab.key,
        targetWorkspaceKey: externalTabDrag.workspaceKey
      })
    }

    window.addEventListener(ROUTE_CONTAINER_PANEL_DOCK_EXTERNAL_TAB_POINTER_DROP_EVENT, handlePointerDrop)
    return () => {
      window.removeEventListener(ROUTE_CONTAINER_PANEL_DOCK_EXTERNAL_TAB_POINTER_DROP_EVENT, handlePointerDrop)
    }
  }, [canDropExternalTabPayload, externalTabDrag, tabs])

  const beginDockSync = useCallback(() => {
    if (syncReleaseTimerRef.current != null) {
      window.clearTimeout(syncReleaseTimerRef.current)
      syncReleaseTimerRef.current = null
    }
    isSyncingRef.current = true
  }, [])

  const endDockSync = useCallback((afterSync?: () => void) => {
    syncReleaseTimerRef.current = window.setTimeout(() => {
      syncReleaseTimerRef.current = null
      isSyncingRef.current = false
      afterSync?.()
    }, 80)
  }, [])

  const selectTab = useCallback((tabKey: string) => {
    const typedTabKey = tabKey as TabKey
    activeTabRef.current = typedTabKey
    onTabChange(typedTabKey, uniqueKnownValues(tabKeys, [...normalizedOpenedTabsRef.current, typedTabKey]))
  }, [onTabChange, tabKeys])

  const closeTab = useCallback((tabKey: string) => {
    const typedTabKey = tabKey as TabKey
    const currentOpenedTabs = normalizedOpenedTabsRef.current
    const tabIndex = currentOpenedTabs.indexOf(typedTabKey)
    const nextOpenedTabs = currentOpenedTabs.filter(openedTab => openedTab !== typedTabKey)
    const fallbackTab = nextOpenedTabs[Math.max(0, tabIndex - 1)] ?? nextOpenedTabs[0] ?? null
    const nextActiveTab = activeTabRef.current === typedTabKey ? fallbackTab : activeTabRef.current

    onTabClose?.(typedTabKey)
    onTabChange(nextActiveTab, nextOpenedTabs)
  }, [onTabChange, onTabClose])

  const isTabClosable = useCallback(
    (tabKey: string, localTabCount?: number) => {
      const tab = visibleTabsRef.current.find(visibleTab => visibleTab.key === tabKey)
      const tabCount = localTabCount ?? normalizedOpenedTabsRef.current.length
      return tab != null && closable && hasRouteContainerPanelTabCloseTitle(tab) &&
        normalizedOpenedTabsRef.current.includes(tabKey as TabKey) &&
        tabCount > minOpenTabs
    },
    [closable, minOpenTabs]
  )

  const closeContextMenu = useCallback(() => setContextMenuState(null), [])
  const openContextMenu = useCallback((
    event: RouteContainerPanelContextMenuEvent,
    context: RouteContainerPanelContextMenuContext<string>
  ) => {
    const customSections = getContextMenuSections?.(
      context as unknown as RouteContainerPanelContextMenuContext<TabKey>
    ) ?? []
    const defaultSections: NavRailMoreMenuSection[] = context.target === 'tab' &&
        context.tab != null &&
        context.isClosable
      ? [{
        items: [{
          icon: 'close',
          key: `route-container-panel:${context.panelKey ?? 'panel'}:${context.tab.key}:close`,
          label: closeLabel?.(resolveRouteContainerPanelTabTitle(context.tab)) ??
            resolveRouteContainerPanelTabTitle(context.tab),
          onSelect: () => {
            if (context.tab != null) context.closeTab(context.tab.key)
          }
        }],
        key: `route-container-panel:${context.panelKey ?? 'panel'}:${context.tab.key}:default`
      }]
      : []
    const sections = [...customSections, ...defaultSections].filter(section => section.items.length > 0)

    if (sections.length === 0) return

    event.preventDefault()
    event.stopPropagation()
    window.dispatchEvent(
      new CustomEvent<RouteContainerPanelDockContextMenuOpenDetail>(
        ROUTE_CONTAINER_PANEL_DOCK_CONTEXT_MENU_OPEN_EVENT,
        { detail: { ownerId: contextMenuOwnerId } }
      )
    )
    setContextMenuState({
      sections,
      x: event.clientX,
      y: event.clientY
    })
  }, [closeLabel, contextMenuOwnerId, getContextMenuSections])

  const handleBlankContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (getContextMenuSections == null) return

    const target = event.target
    if (!(target instanceof Element)) return

    const header = target.closest('.dv-tabs-and-actions-container, .route-container-panel-dock__empty-header')
    const content = target.closest(
      '.route-container-panel-dock__content, .route-container-panel-dock__empty-content, .dv-content-container, .dv-view'
    )
    const isInHeader = header instanceof HTMLElement && event.currentTarget.contains(header)
    const isInContent = content instanceof HTMLElement && event.currentTarget.contains(content)
    if (!isInHeader && !isInContent) return
    if (
      target.closest(
        [
          '.dv-tab',
          '.route-container-panel-dock-tab',
          '.dv-pre-actions-container',
          '.dv-right-actions-container',
          '.ant-dropdown',
          '.ant-select',
          '.ant-input',
          '[contenteditable="true"]',
          '[data-dock-panel-no-resize="true"]',
          '[role="button"]',
          'a',
          'button',
          'input',
          'select',
          'textarea'
        ].join(', ')
      ) != null
    ) {
      return
    }

    const api = apiRef.current
    openContextMenu(event, {
      activeTab: activeTabRef.current,
      closeTab,
      isActive: false,
      isClosable: false,
      isOpened: false,
      openedTabs: normalizedOpenedTabsRef.current,
      panelKey,
      selectTab: (key) => {
        selectTab(key)
        api?.getPanel(key)?.api.setActive()
      },
      tabs: allTabs,
      target: 'blank',
      visibleTabs: visibleTabsRef.current
    })
  }, [allTabs, getContextMenuSections, openContextMenu, panelKey, selectTab])

  const handleReady = useCallback((event: Dockview.DockviewReadyEvent) => {
    apiRef.current = event.api
    disposeDockSubscriptions()
    beginDockSync()
    try {
      const savedLayout = readRouteContainerPanelDockLayout(storageKey, visibleTabsRef.current)
      if (savedLayout != null) event.api.fromJSON(savedLayout, { reuseExistingPanels: true })
      syncRouteContainerPanelDockPanels(event.api, visibleTabsRef.current, activeTabRef.current)
    } finally {
      endDockSync(persistLayout)
    }

    disposablesRef.current = [
      event.api.onDidActivePanelChange((panel) => {
        if (isSyncingRef.current || panel == null) return
        const panelTabKey = panel.id as TabKey
        if (!visibleTabsRef.current.some(tab => tab.key === panelTabKey)) return

        const controlledActiveTab = activeTabRef.current
        if (controlledActiveTab == null || controlledActiveTab === panelTabKey) return

        const controlledPanel = event.api.getPanel(controlledActiveTab)
        if (controlledPanel == null) return

        beginDockSync()
        try {
          controlledPanel.api.setActive()
        } finally {
          endDockSync(persistLayout)
        }
      }),
      event.api.onDidRemovePanel((panel) => {
        if (isSyncingRef.current || !isTabClosable(panel.id)) return
        closeTab(panel.id)
      }),
      event.api.onDidLayoutChange(persistLayout)
    ]
  }, [
    beginDockSync,
    closeTab,
    disposeDockSubscriptions,
    endDockSync,
    isTabClosable,
    persistLayout,
    selectTab,
    storageKey
  ])

  const handleTabContextMenu = useCallback(({ api, group, panel }: GetTabContextMenuItemsParams) => {
    const tab = tabByKey[panel.id]
    if (tab == null) return []

    const isClosable = isTabClosable(tab.key, group.panels.length)
    const context: RouteContainerPanelTabMenuContext<TabKey> = {
      activeTab: activeTabRef.current,
      closeTab: key => closeTab(key),
      isActive: activeTabRef.current === tab.key,
      isClosable,
      isOpened: normalizedOpenedTabsRef.current.includes(tab.key as TabKey),
      selectTab: (key) => {
        selectTab(key)
        api.getPanel(key)?.api.setActive()
      },
      tab: tab as unknown as RouteContainerPanelTabItem<TabKey>
    }
    const customItems = getTabContextMenuItems?.(context) ?? []
    const title = resolveRouteContainerPanelTabTitle(tab)
    const defaultItems: RouteContainerPanelDockContextMenuItem[] = isClosable
      ? [{
        label: closeLabel?.(title) ?? title,
        action: () => closeTab(tab.key)
      }]
      : []

    return [...customItems, ...defaultItems]
  }, [closeLabel, closeTab, getTabContextMenuItems, isTabClosable, selectTab, tabByKey])

  const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac')
  const contextMenuItems = useMemo(() =>
    contextMenuState == null
      ? []
      : buildNavRailMoreMenuItems({
        closeMenu: closeContextMenu,
        isMac,
        sections: contextMenuState.sections
      }), [closeContextMenu, contextMenuState, isMac])
  const contextMenuSelectedKeys = useMemo(
    () => contextMenuState == null ? [] : getNavRailMoreMenuSelectedKeys(contextMenuState.sections),
    [contextMenuState]
  )

  useEffect(() => {
    const api = apiRef.current
    if (api == null || visibleTabs.length === 0) return

    beginDockSync()
    try {
      syncRouteContainerPanelDockPanels(api, visibleTabs, effectiveActiveTab)
    } finally {
      endDockSync(persistLayout)
    }
  }, [beginDockSync, effectiveActiveTab, endDockSync, persistLayout, visibleTabs])

  useEffect(() => {
    if (visibleTabs.length > 0) return
    disposeDockSubscriptions()
    apiRef.current = null
  }, [disposeDockSubscriptions, visibleTabs.length])

  useEffect(() => () => {
    if (syncReleaseTimerRef.current != null) {
      window.clearTimeout(syncReleaseTimerRef.current)
    }
    disposeDockSubscriptions()
  }, [disposeDockSubscriptions])

  useEffect(() => {
    const handleContextMenuOpen = (event: Event) => {
      const detail = (event as CustomEvent<RouteContainerPanelDockContextMenuOpenDetail>).detail
      if (detail?.ownerId !== contextMenuOwnerId) closeContextMenu()
    }

    window.addEventListener(ROUTE_CONTAINER_PANEL_DOCK_CONTEXT_MENU_OPEN_EVENT, handleContextMenuOpen)

    return () => {
      window.removeEventListener(ROUTE_CONTAINER_PANEL_DOCK_CONTEXT_MENU_OPEN_EVENT, handleContextMenuOpen)
    }
  }, [closeContextMenu, contextMenuOwnerId])

  useEffect(() => {
    if (contextMenuState == null) return

    const handlePointerDown = (event: PointerEvent) => {
      if (isRouteContainerPanelDockContextMenuTarget(event.target)) return
      closeContextMenu()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeContextMenu()
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown, true)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [closeContextMenu, contextMenuState])

  const contextValue = useMemo<RouteContainerPanelDockContextValue>(() => ({
    activeTab: effectiveActiveTab,
    closeLabel,
    closeTab,
    closable,
    createMenuIcon,
    createMenuItems,
    createMenuLabel,
    createMenuSections,
    createMenuSelectedKeys,
    externalTabDrag: externalTabDrag as RouteContainerPanelDockExternalTabDragOptions<string> | undefined,
    getHeaderActions: getHeaderActions as
      | ((context: RouteContainerPanelDockHeaderActionContext<string>) => RouteContainerPanelDockActionItem[])
      | undefined,
    hasContextMenu: getContextMenuSections != null,
    headerActions,
    isTabClosable,
    minOpenTabs,
    openContextMenu,
    openedTabs: normalizedOpenedTabs,
    panelChromeActions: resolvedPanelChromeActions,
    panelKey,
    selectTab,
    tabs: allTabs,
    tabByKey,
    visibleTabs,
    onCreateMenuClick,
    onCreateMenuOpenChange
  }), [
    allTabs,
    closeLabel,
    closeTab,
    closable,
    createMenuIcon,
    createMenuItems,
    createMenuLabel,
    createMenuSections,
    createMenuSelectedKeys,
    externalTabDrag,
    effectiveActiveTab,
    getContextMenuSections,
    getHeaderActions,
    headerActions,
    isTabClosable,
    minOpenTabs,
    normalizedOpenedTabs,
    openContextMenu,
    resolvedPanelChromeActions,
    panelKey,
    selectTab,
    tabByKey,
    visibleTabs,
    onCreateMenuClick,
    onCreateMenuOpenChange
  ])

  const defaultContentNode = useMemo(() => {
    if (typeof defaultContent !== 'function') return defaultContent ?? null

    return defaultContent({
      activeTab: effectiveActiveTab,
      openedTabs: normalizedOpenedTabs,
      panelKey,
      tabs,
      visibleTabs: visibleTabs as unknown as Array<RouteContainerPanelDockTabItem<TabKey>>
    })
  }, [defaultContent, effectiveActiveTab, normalizedOpenedTabs, panelKey, tabs, visibleTabs])

  const contextMenuPortal = typeof document === 'undefined' || contextMenuState == null
    ? null
    : createPortal(
      <Dropdown
        overlayClassName={`${NAV_RAIL_MORE_DROPDOWN_CLASS} route-container-panel-dock-context-dropdown`}
        menu={{
          expandIcon: renderRouteContainerPanelSubmenuExpandIcon(),
          items: contextMenuItems,
          selectedKeys: contextMenuSelectedKeys,
          triggerSubMenuAction: 'click'
        }}
        open
        placement='bottomLeft'
        trigger={[]}
        transitionName='ant-slide-down'
        onOpenChange={(open) => {
          if (!open) closeContextMenu()
        }}
      >
        <span
          className='route-container-panel-dock__context-anchor'
          style={{
            left: contextMenuState?.x ?? -9999,
            top: contextMenuState?.y ?? -9999
          }}
        />
      </Dropdown>,
      document.body
    )

  return (
    <RouteContainerPanelDockContext.Provider value={contextValue}>
      {contextMenuPortal}
      <div
        className={[
          'route-container-panel-dock',
          `is-${labelMode}`,
          'dockview-theme-light',
          isExternalDropTarget ? 'is-external-drop-target' : '',
          className
        ].filter(Boolean).join(' ')}
        role='region'
        aria-label={ariaLabel}
        data-route-container-panel-dock-droppable={externalTabDrag?.droppable === true ? 'true' : undefined}
        data-route-container-panel-dock-scope={externalTabDrag?.scope}
        data-route-container-panel-dock-workspace-key={externalTabDrag?.workspaceKey}
        onDragEnter={handleExternalTabDragEnter}
        onDragOver={handleExternalTabDragOver}
        onDragLeave={handleExternalTabDragLeave}
        onDrop={handleExternalTabDrop}
        onContextMenuCapture={handleBlankContextMenu}
      >
        {visibleTabs.length === 0
          ? (
            <div className='route-container-panel-dock__empty-shell'>
              <div className='route-container-panel-dock__empty-header'>
                <RouteContainerPanelDockCreateAction />
                <span className='route-container-panel-dock__empty-tab-strip' />
                <RouteContainerPanelDockEmptyHeaderActions />
              </div>
              <div className='route-container-panel-dock__empty-content'>
                {defaultContentNode}
              </div>
            </div>
          )
          : (
            <Dockview.DockviewReact
              components={{ [ROUTE_CONTAINER_PANEL_DOCK_PANEL_COMPONENT]: RouteContainerPanelDockContent }}
              tabComponents={{ [ROUTE_CONTAINER_PANEL_DOCK_TAB_COMPONENT]: RouteContainerPanelDockTab }}
              prefixHeaderActionsComponent={RouteContainerPanelDockPrefixActions}
              rightHeaderActionsComponent={RouteContainerPanelDockHeaderActions}
              disableFloatingGroups={disableFloatingGroups}
              noPanelsOverlay='watermark'
              floatingGroupBounds='boundedWithinViewport'
              onReady={handleReady}
              getTabContextMenuItems={getContextMenuSections == null ? handleTabContextMenu : undefined}
            />
          )}
      </div>
    </RouteContainerPanelDockContext.Provider>
  )
}

function RouteContainerPanelDockEmptyHeaderActions() {
  const {
    activeTab,
    getHeaderActions,
    headerActions,
    panelChromeActions,
    panelKey
  } = useRouteContainerPanelDockContext()
  const tabHeaderActions = getHeaderActions?.({
    activeTab,
    groupActiveTab: null,
    groupActiveTabKey: null,
    isTopRightGroup: true,
    panelKey
  }) ?? headerActions
  const actions = [...tabHeaderActions, ...panelChromeActions]

  return <RouteContainerPanelDockHeaderActionButtons actions={actions} />
}
