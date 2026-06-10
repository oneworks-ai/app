/* eslint-disable max-lines -- frontend plugin manifest keeps view, contribution, and host component contracts together */
import type { ComponentType, ReactNode } from 'react'

import type { ChatMessageContent, SessionQueuedMessageMode } from '@oneworks/core'
import type {
  PluginClientManifest,
  PluginContributionBase,
  PluginContributionChatHeaderAction,
  PluginContributionChatInteractionPanelEmptyAction,
  PluginContributionLauncherSearchProvider,
  PluginContributionManifest,
  PluginContributionMenuItem,
  PluginContributionNavItem,
  PluginContributionRoute,
  PluginContributionRouteHeaderAction,
  PluginContributionRouteMenuItem,
  PluginContributionSessionGroup,
  PluginContributionSessionGroupAction,
  PluginContributionSessionGroupCreateSession,
  PluginContributionSessionGroupMatch,
  PluginContributionWorkbenchAddMenuItem,
  PluginContributionWorkbenchTab,
  PluginContributionWorkspaceDrawerTab,
  PluginExtensionContributionManifest,
  PluginExtensionPointManifest,
  PluginLocalizedText,
  PluginManifest,
  PluginRuntimeInstance
} from '@oneworks/types'

import type { PluginI18nContext } from './plugin-i18n'

export type PluginPlacement = 'bottom' | 'right'

export interface PluginDiagnostic {
  code?: string
  details?: unknown
  level: 'error' | 'warning' | 'info'
  message: string
  pluginRoot?: string
  pluginScope?: string
  scope?: string
}

export type {
  PluginClientManifest,
  PluginContributionBase,
  PluginContributionChatHeaderAction,
  PluginContributionChatInteractionPanelEmptyAction,
  PluginContributionLauncherSearchProvider,
  PluginContributionManifest,
  PluginContributionMenuItem,
  PluginContributionNavItem,
  PluginContributionRoute,
  PluginContributionRouteHeaderAction,
  PluginContributionRouteMenuItem,
  PluginContributionSessionGroup,
  PluginContributionSessionGroupAction,
  PluginContributionSessionGroupCreateSession,
  PluginContributionSessionGroupMatch,
  PluginContributionWorkbenchAddMenuItem,
  PluginContributionWorkbenchTab,
  PluginContributionWorkspaceDrawerTab,
  PluginExtensionContributionManifest,
  PluginExtensionPointManifest,
  PluginLocalizedText,
  PluginManifest,
  PluginRuntimeInstance
}

export type PluginSlot =
  | 'nav.items'
  | 'nav.moreMenu'
  | 'nav.footer.before'
  | 'chat.header.actions'
  | 'chat.header.moreMenu'
  | 'chat.interactionPanel.emptyActions'
  | 'sessions.groups'
  | 'route.header.actions'
  | 'route.moreMenu.items'
  | 'route.sidebar.contextMenu'
  | 'route.windowBar.actions'
  | 'workbench.addMenu'
  | 'workbench.tabs'
  | 'launcher.searchProviders'

export interface PluginRouteRegistration extends PluginContributionBase {
  icon?: string
  id: string
  title?: PluginLocalizedText
  viewId: string
}

export interface PluginExtensionPointRegistration extends PluginContributionBase {
  contributionSchema?: Record<string, unknown>
  id: string
  title?: PluginLocalizedText
}

export interface PluginExtensionPointRuntimeRegistration extends PluginExtensionPointRegistration {
  pluginScope: string
}

export interface PluginExtensionContributionRegistration extends PluginContributionBase {
  id: string
  target?: string
  title?: PluginLocalizedText
  [key: string]: unknown
}

export interface PluginClientApiInvocationContext {
  apiId: string
  callerScope: string
  targetScope: string
}

export interface PluginClientApiHandler {
  (input?: unknown, context?: PluginClientApiInvocationContext): unknown | Promise<unknown>
}

export interface PluginClientApiRegistration extends PluginContributionBase {
  handler: PluginClientApiHandler
  id: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  title?: PluginLocalizedText
}

export interface PluginClientApiRuntimeRegistration extends Omit<PluginClientApiRegistration, 'handler'> {
  pluginScope: string
}

export interface PluginClientApiCallOptions {
  timeoutMs?: number
}

export interface PluginDisposable {
  dispose: () => void
}

export type PluginViewRenderer = (container: HTMLElement, context: PluginViewContext) => void | PluginDisposable

export interface PluginViewRegistration {
  id: string
  render?: PluginViewRenderer
  renderNode?: (context: PluginViewContext) => ReactNode
}

export type PluginViewSurface = 'route' | 'workbench' | 'drawer'
export type PluginHostThemeMode = 'light' | 'dark' | 'system'
export type PluginHostResolvedThemeMode = 'light' | 'dark'

export interface PluginViewHostContext {
  isDarkMode: boolean
  language: string
  resolvedThemeMode: PluginHostResolvedThemeMode
  surface: PluginViewSurface
  themeMode: PluginHostThemeMode
}

export type PluginViewI18nApi = PluginI18nContext

export type PluginHostSenderDensity = 'compact' | 'default'
export type PluginHostSenderSurface = 'chat' | 'plain'
export type PluginHostControlSize = 'large' | 'middle' | 'small'
export type PluginHostIconTone = 'danger' | 'default' | 'muted' | 'primary' | 'success' | 'warning'

export interface PluginHostControlOption {
  disabled?: boolean
  icon?: string
  label?: string
  value: string
}

export type PluginHostOverlaySubmenuPlacement = 'left' | 'right'
export type PluginHostOverlaySubmenuTrigger = 'click' | 'hover'

export interface PluginHostOverlayMenuActionItem {
  children?: PluginHostOverlayMenuItem[]
  confirmLabel?: string
  description?: string
  disabled?: boolean
  icon?: string
  key: string
  label: string
  selected?: boolean
  shortcut?: string
  submenuPlacement?: PluginHostOverlaySubmenuPlacement
  tone?: 'danger'
  trailingIcon?: string
}

export interface PluginHostOverlayMenuDividerItem {
  key: string
  type: 'divider'
}

export interface PluginHostOverlayMenuSectionItem {
  key: string
  label: string
  type: 'section'
}

export type PluginHostOverlayMenuItem =
  | PluginHostOverlayMenuActionItem
  | PluginHostOverlayMenuDividerItem
  | PluginHostOverlayMenuSectionItem

export interface PluginHostOverlayMenuComponentProps {
  alignSubmenus?: boolean
  defaultOpenKeys?: string[]
  items: PluginHostOverlayMenuItem[]
  multi?: boolean
  onItemClick?: (item: PluginHostOverlayMenuActionItem) => void
  onOpenKeysChange?: (keys: string[]) => void
  openKeys?: string[]
  selectedKeys?: string[]
  submenuPlacement?: PluginHostOverlaySubmenuPlacement
  submenuTrigger?: PluginHostOverlaySubmenuTrigger
  surface?: boolean
  width?: number | string
}

export interface PluginHostOverlaySearchMenuComponentProps {
  emptyLabel?: string
  items: PluginHostOverlayMenuItem[]
  onItemClick?: (item: PluginHostOverlayMenuActionItem) => void
  onSearchChange?: (value: string) => void
  placeholder?: string
  searchPlacement?: 'bottom' | 'top'
  searchValue?: string
  selectedKeys?: string[]
}

export interface PluginHostOverlaySearchRowComponentProps {
  autoFocus?: boolean
  clearLabel?: string
  onChange?: (value: string) => void
  onClear?: () => void
  placeholder?: string
  value?: string
}

export interface PluginHostOverlaySegmentedComponentProps {
  ariaLabel: string
  onChange?: (value: string) => void
  options: Array<{ icon: string; label: string; value: string }>
  value?: string
}

export interface PluginHostOverlayTreeNode {
  children?: PluginHostOverlayTreeNode[]
  collapsedIcon?: string
  confirmLabel?: string
  data?: unknown
  disabled?: boolean
  expandedIcon?: string
  icon?: string
  key: string
  label: string
  meta?: string
  selected?: boolean
  title?: string
  trailingIcon?: string
}

export interface PluginHostOverlayTreeComponentProps {
  collapsedKeys?: string[]
  defaultCollapsedKeys?: string[]
  expandAll?: boolean
  nodes: PluginHostOverlayTreeNode[]
  onNodeActivate?: (node: PluginHostOverlayTreeNode) => void
  onNodeToggle?: (key: string) => void
  surface?: boolean
}

export type PluginHostOverlayDropdownContent =
  | {
    props: PluginHostOverlayMenuComponentProps
    type: 'menu'
  }
  | {
    props: PluginHostOverlaySearchMenuComponentProps
    type: 'searchMenu'
  }
  | {
    props: PluginHostOverlayTreeComponentProps
    type: 'tree'
  }

export interface PluginHostOverlayDropdownComponentProps {
  closeOnSelect?: boolean
  content: PluginHostOverlayDropdownContent
  defaultOpen?: boolean
  disabled?: boolean
  icon?: string
  label: string
  onOpenChange?: (open: boolean) => void
  open?: boolean
  placement?: 'bottom' | 'bottomLeft' | 'bottomRight' | 'top' | 'topLeft' | 'topRight'
  title?: string
}

export interface PluginHostOverlaySelectLabelComponentProps {
  icon: string
  label: string
  meta?: string
}

export interface PluginHostButtonComponentProps {
  ariaLabel?: string
  danger?: boolean
  disabled?: boolean
  icon?: string
  label?: string
  onClick?: () => void
  shape?: 'circle' | 'default' | 'round'
  size?: PluginHostControlSize
  title?: string
  type?: 'default' | 'dashed' | 'link' | 'primary' | 'text'
}

export interface PluginHostActionItem {
  danger?: boolean
  disabled?: boolean
  icon?: string
  key: string
  label: string
  onSelect?: () => void
  primary?: boolean
  title?: string
}

export interface PluginHostActionBarComponentProps {
  actions?: PluginHostActionItem[]
  ariaLabel?: string
  primaryActions?: PluginHostActionItem[]
  revealedActions?: PluginHostActionItem[]
  size?: PluginHostControlSize
}

export interface PluginHostInputComponentProps {
  allowClear?: boolean
  ariaLabel?: string
  autoFocus?: boolean
  disabled?: boolean
  onChange?: (value: string) => void
  onCommit?: (value: string) => void
  placeholder?: string
  rows?: number
  size?: PluginHostControlSize
  type?: 'password' | 'textarea' | 'text'
  value?: string
}

export interface PluginHostIconComponentProps {
  ariaLabel?: string
  name: string
  size?: PluginHostControlSize | number
  title?: string
  tone?: PluginHostIconTone
}

export interface PluginHostListItem {
  actions?: ReactNode
  active?: boolean
  content: ReactNode
  key: string
}

export interface PluginHostListComponentProps {
  ariaLabel?: string
  empty?: ReactNode
  items: PluginHostListItem[]
}

export interface PluginHostSegmentedComponentProps {
  ariaLabel?: string
  block?: boolean
  disabled?: boolean
  iconOnly?: boolean
  onChange?: (value: string) => void
  options: PluginHostControlOption[]
  size?: PluginHostControlSize
  value?: string
}

export interface PluginHostSwitchComponentProps {
  checked?: boolean
  checkedLabel?: string
  disabled?: boolean
  onChange?: (checked: boolean) => void
  size?: 'default' | 'small'
  uncheckedLabel?: string
}

export interface PluginHostSenderComponentProps {
  adapterLocked?: boolean
  autoFocus?: boolean
  defaultAdapter?: string
  defaultModel?: string
  density?: PluginHostSenderDensity
  showHeader?: boolean
  hideReferenceActions?: boolean
  hideSelectionControls?: boolean
  hideSubmitAction?: boolean
  initialContent?: string
  modelUnavailable?: boolean
  onCancel?: () => void
  onInputChange?: (value: string) => void
  onSend?: (text: string, mode?: SessionQueuedMessageMode) => unknown | Promise<unknown>
  onSendContent?: (
    content: ChatMessageContent[],
    mode?: SessionQueuedMessageMode
  ) => unknown | Promise<unknown>
  placeholder?: string
  showStatusBar?: boolean
  stopLoading?: boolean
  surface?: PluginHostSenderSurface
  submitLabel?: string
  submitLoading?: boolean
}

export interface PluginHostProjectFileTreeNode {
  children?: PluginHostProjectFileTreeNode[]
  isDirectory?: boolean
  name: string
  path: string
  type?: string
}

export interface PluginHostProjectFileTreeSelection {
  nodes: PluginHostProjectFileTreeNode[]
  paths: string[]
}

export interface PluginHostProjectFileTreeComponentProps {
  activePath?: string | null
  onOpenFile?: (path: string) => void
  onReferenceNodes?: (nodes: PluginHostProjectFileTreeNode[]) => void
  onSelectionChange?: (selection: PluginHostProjectFileTreeSelection) => void
  refreshKey?: number
  selectableTypes?: 'all' | 'files'
  selectedPaths?: string[]
  selectionMode?: 'multiple' | 'none'
  sessionId?: string
  showContextMenu?: boolean
  showLoadingState?: boolean
}

export interface PluginHostComponentPropsById {
  actionBar: PluginHostActionBarComponentProps
  button: PluginHostButtonComponentProps
  icon: PluginHostIconComponentProps
  input: PluginHostInputComponentProps
  list: PluginHostListComponentProps
  overlayDropdown: PluginHostOverlayDropdownComponentProps
  overlayMenu: PluginHostOverlayMenuComponentProps
  overlaySearchMenu: PluginHostOverlaySearchMenuComponentProps
  overlaySearchRow: PluginHostOverlaySearchRowComponentProps
  overlaySegmented: PluginHostOverlaySegmentedComponentProps
  overlaySelectLabel: PluginHostOverlaySelectLabelComponentProps
  overlayTree: PluginHostOverlayTreeComponentProps
  projectFileTree: PluginHostProjectFileTreeComponentProps
  segmented: PluginHostSegmentedComponentProps
  sender: PluginHostSenderComponentProps
  switch: PluginHostSwitchComponentProps
}

export type PluginHostComponentId = keyof PluginHostComponentPropsById

export interface PluginHostComponentApi {
  render: <T extends PluginHostComponentId>(
    component: T,
    container: HTMLElement,
    props?: PluginHostComponentPropsById[T]
  ) => PluginDisposable
}

export interface PluginHostComponentReactApi {
  ActionBar: ComponentType<PluginHostActionBarComponentProps>
  Button: ComponentType<PluginHostButtonComponentProps>
  Icon: ComponentType<PluginHostIconComponentProps>
  Input: ComponentType<PluginHostInputComponentProps>
  List: ComponentType<PluginHostListComponentProps>
  OverlayDropdown: ComponentType<PluginHostOverlayDropdownComponentProps>
  OverlayMenu: ComponentType<PluginHostOverlayMenuComponentProps>
  OverlaySearchMenu: ComponentType<PluginHostOverlaySearchMenuComponentProps>
  OverlaySearchRow: ComponentType<PluginHostOverlaySearchRowComponentProps>
  OverlaySegmented: ComponentType<PluginHostOverlaySegmentedComponentProps>
  OverlaySelectLabel: ComponentType<PluginHostOverlaySelectLabelComponentProps>
  OverlayTree: ComponentType<PluginHostOverlayTreeComponentProps>
  ProjectFileTree: ComponentType<PluginHostProjectFileTreeComponentProps>
  Segmented: ComponentType<PluginHostSegmentedComponentProps>
  Sender: ComponentType<PluginHostSenderComponentProps>
  Switch: ComponentType<PluginHostSwitchComponentProps>
}

export interface PluginViewContext {
  components: PluginHostComponentApi
  extensions: {
    getContributions: (target: string) => Array<PluginExtensionContributionRegistration & { pluginScope: string }>
    hasPoint: (target: string) => boolean
  }
  host: PluginViewHostContext
  i18n: PluginViewI18nApi
  options: {
    update: (
      options: Record<string, unknown>,
      target?: 'workspace' | 'global'
    ) => Promise<Record<string, unknown>>
    value: Record<string, unknown>
  }
  routeId?: string
  scope: string
  ui: PluginHostComponentReactApi
}

export type PluginCleanup = PluginDisposable | (() => void) | void

export interface PluginCommandHandler {
  (payload?: unknown): unknown | Promise<unknown>
}

export interface PluginLauncherSearchProvider extends PluginContributionLauncherSearchProvider {
  search?: (query: string) => unknown | Promise<unknown>
}
