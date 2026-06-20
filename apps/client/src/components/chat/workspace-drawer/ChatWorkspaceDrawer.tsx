/* eslint-disable max-lines -- workspace drawer coordinates built-in views, plugin tabs, dock state, and tree commands together. */

import '../interaction-panel/ChatInteractionPanel.scss'
import './ChatWorkspaceDrawer.scss'

import { App, Dropdown, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, UIEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'

import type { SessionPanelTab } from '@oneworks/core'
import type { GitRepositoryState, TerminalShellKind } from '@oneworks/types'

import { getSessionGitState, getWorkspaceGitState } from '#~/api'
import { getAgentRoomApprovalMessages } from '#~/components/agent-room/@core/approval-messages'
import type {
  AgentRoomMemberView,
  AgentRoomRunView,
  AgentRoomViewModel
} from '#~/components/agent-room/@types/agent-room-view'
import { isTerminalPaneOnSurface } from '#~/components/chat/terminal/@utils/terminal-panes'
import { ChatTerminalView } from '#~/components/chat/terminal/ChatTerminalView'
import {
  buildWorkbenchCreateMenuItems,
  parseWorkbenchDrawerViewMenuKey,
  toWorkbenchDrawerViewMenuKey
} from '#~/components/chat/workbench-create-menu'
import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import type {
  RouteContainerPanelDockActionItem,
  RouteContainerPanelDockChromeActionsConfig,
  RouteContainerPanelDockHeaderActionContext,
  RouteContainerPanelDockLayout,
  RouteContainerPanelDockTabItem,
  RouteContainerPanelTabMenuContext
} from '#~/components/layout/RouteContainerPanelTabs'
import {
  RouteContainerPanelDockWorkspace,
  areRouteContainerPanelDockLayoutsEquivalent
} from '#~/components/layout/RouteContainerPanelTabs'
import type { ContextPickerFile } from '#~/components/workspace/context-file-types'
import { emitDesktopViewShortcut } from '#~/desktop/view-shortcuts'
import { useResponsiveLayout } from '#~/hooks/use-responsive-layout'
import { PluginViewHost } from '#~/plugins/PluginHost'
import type { PluginContributionWorkbenchAddMenuItem, PluginContributionWorkbenchTab } from '#~/plugins/plugin-manifest'
import { usePluginCommandExecutor, usePluginSlot } from '#~/plugins/plugin-slots'
import { interactionPanelPinnedTabLimitAtom } from '#~/store/index'

import { InteractionPanelEmptyState } from '../interaction-panel/InteractionPanelEmptyState'
import { InteractionPanelIframeView } from '../interaction-panel/InteractionPanelIframeView'
import type { InteractionPanelIframePage } from '../interaction-panel/InteractionPanelIframeView'
import { InteractionPanelMobileDebugView } from '../interaction-panel/InteractionPanelMobileDebugView'
import { InteractionPanelPageDebuggerListView } from '../interaction-panel/InteractionPanelPageDebuggerListView'
import { InteractionPanelPinnedTabEditModal } from '../interaction-panel/InteractionPanelPinnedTabEditModal'
import { InteractionPanelSessionView } from '../interaction-panel/InteractionPanelSessionView'
import { buildInteractionPanelDockTabContextMenuItems } from '../interaction-panel/interaction-panel-dock-tab-context-menu'
import {
  createIframePage,
  navigateIframePageHistory,
  normalizeFrameUrl,
  selectIframePageHistoryIndex,
  updateIframePageMetadata,
  updateIframePageUrl
} from '../interaction-panel/interaction-panel-iframe-pages'
import type { OpenInteractionPanelIframeUrlOptions } from '../interaction-panel/interaction-panel-iframe-pages'
import { createInteractionPanelMobileDebugPage } from '../interaction-panel/interaction-panel-mobile-debug-pages'
import type { InteractionPanelMobileDebugPage } from '../interaction-panel/interaction-panel-mobile-debug-pages'
import type { InteractionPanelPinnedTab } from '../interaction-panel/interaction-panel-pinned-tabs'
import {
  areInteractionPanelPluginPagesEqual,
  createInteractionPanelPluginPage,
  normalizeInteractionPanelPluginPages,
  resolveInteractionPanelPluginTabDefinition
} from '../interaction-panel/interaction-panel-plugin-pages'
import type { InteractionPanelPluginPage } from '../interaction-panel/interaction-panel-plugin-pages'
import { createInteractionPanelSessionPage } from '../interaction-panel/interaction-panel-session-pages'
import type { InteractionPanelSessionPage } from '../interaction-panel/interaction-panel-session-pages'
import { getFallbackTabAfterClose, getTabsForCloseScope } from '../interaction-panel/interaction-panel-tab-groups'
import type { InteractionPanelTabCloseScope } from '../interaction-panel/interaction-panel-tab-groups'
import {
  INTERACTION_PANEL_MOBILE_DEBUG_CONFIG_KEY,
  INTERACTION_PANEL_MOBILE_DEBUG_NO_DEVICES_KEY,
  parseInteractionPanelMobileDebugDeviceMenuKey,
  parseInteractionPanelPluginAddMenuKey
} from '../interaction-panel/interaction-panel-tab-menu'
import { toWorkspaceDrawerInteractionTabId } from '../interaction-panel/interaction-panel-tabs'
import type { InteractionPanelTab } from '../interaction-panel/interaction-panel-tabs'
import { useCopyTextWithFeedback } from '../interaction-panel/use-copy-text-with-feedback'
import { useInteractionPanelMobileDebugDeviceOptions } from '../interaction-panel/use-interaction-panel-mobile-debug-device-options'
import { useInteractionPanelPinnedTabs } from '../interaction-panel/use-interaction-panel-pinned-tabs'
import type { InteractionTerminalPanesController } from '../interaction-panel/use-interaction-terminal-panes'
import type { SessionPanelStateController } from '../interaction-panel/use-session-panel-state'
import { WorkspaceDrawerViewPanel } from './WorkspaceDrawerViewPanel'
import { useWorkspaceDrawerDockActions } from './use-workspace-drawer-dock-actions'
import { renderMenuIcon } from './workspace-drawer-toolbar-menu'
import type { WorkspaceDrawerView } from './workspace-drawer-types'
import { buildWorkspaceDrawerViewItems, getPluginWorkspaceDrawerViews } from './workspace-drawer-view-items'
import type { WorkspaceDrawerViewItem } from './workspace-drawer-view-items'

export interface ChatWorkspaceDrawerAgentRoster {
  members: AgentRoomMemberView[]
  onOpenRun?: (run: AgentRoomRunView) => void
}

export interface ChatWorkspaceDrawerAgentApprovals {
  room: AgentRoomViewModel
  onOpenRun?: (run: AgentRoomRunView) => void
}

export interface ChatWorkspaceDrawerLocateFileRequest {
  id: number
  path: string
}

const WORKSPACE_DRAWER_IFRAME_TAB_PREFIX = 'workspace-drawer:iframe:'
const WORKSPACE_DRAWER_MOBILE_DEBUG_TAB_PREFIX = 'workspace-drawer:mobile-debug:'
const WORKSPACE_DRAWER_PAGE_DEBUGGER_TAB_KEY = 'workspace-drawer:page-debugger'
const WORKSPACE_DRAWER_PLUGIN_TAB_PREFIX = 'workspace-drawer:plugin:'
const WORKSPACE_DRAWER_SESSION_TAB_PREFIX = 'workspace-drawer:session:'
const WORKSPACE_DRAWER_TERMINAL_TAB_PREFIX = 'workspace-drawer:terminal:'

const isWorkspaceDrawerDebugEnabled = () => {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('oneworks_debug') === '1'
  } catch {
    return false
  }
}

const debugWorkspaceDrawer = (message: string, data?: unknown) => {
  if (!isWorkspaceDrawerDebugEnabled()) return

  void data
  void message
}

type WorkspaceDrawerDockTabKey =
  | WorkspaceDrawerView
  | `${typeof WORKSPACE_DRAWER_IFRAME_TAB_PREFIX}${string}`
  | `${typeof WORKSPACE_DRAWER_MOBILE_DEBUG_TAB_PREFIX}${string}`
  | typeof WORKSPACE_DRAWER_PAGE_DEBUGGER_TAB_KEY
  | `${typeof WORKSPACE_DRAWER_PLUGIN_TAB_PREFIX}${string}`
  | `${typeof WORKSPACE_DRAWER_SESSION_TAB_PREFIX}${string}`
  | `${typeof WORKSPACE_DRAWER_TERMINAL_TAB_PREFIX}${string}`

const toWorkspaceDrawerIframeTabKey = (pageId: string): WorkspaceDrawerDockTabKey =>
  `${WORKSPACE_DRAWER_IFRAME_TAB_PREFIX}${encodeURIComponent(pageId)}`

const toWorkspaceDrawerMobileDebugTabKey = (pageId: string): WorkspaceDrawerDockTabKey =>
  `${WORKSPACE_DRAWER_MOBILE_DEBUG_TAB_PREFIX}${encodeURIComponent(pageId)}`

const toWorkspaceDrawerPluginTabKey = (pageId: string): WorkspaceDrawerDockTabKey =>
  `${WORKSPACE_DRAWER_PLUGIN_TAB_PREFIX}${encodeURIComponent(pageId)}`

const toWorkspaceDrawerSessionTabKey = (pageId: string): WorkspaceDrawerDockTabKey =>
  `${WORKSPACE_DRAWER_SESSION_TAB_PREFIX}${encodeURIComponent(pageId)}`

const toWorkspaceDrawerTerminalTabKey = (terminalId: string): WorkspaceDrawerDockTabKey =>
  `${WORKSPACE_DRAWER_TERMINAL_TAB_PREFIX}${encodeURIComponent(terminalId)}`

const decodeWorkspaceDrawerHostedTabId = (key: WorkspaceDrawerDockTabKey, prefix: string) =>
  key.startsWith(prefix) ? decodeURIComponent(key.slice(prefix.length)) : undefined

const uniqueWorkspaceDrawerDockTabKeys = (values: readonly WorkspaceDrawerDockTabKey[]) => {
  const seen = new Set<WorkspaceDrawerDockTabKey>()
  const result: WorkspaceDrawerDockTabKey[] = []

  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }

  return result
}

const isWorkspaceDrawerViewTabKey = (
  key: WorkspaceDrawerDockTabKey | null | undefined,
  availableViewSet: ReadonlySet<WorkspaceDrawerView>
): key is WorkspaceDrawerView => key != null && availableViewSet.has(key as WorkspaceDrawerView)

const getWorkspaceDrawerDockTabTitle = (
  tab: RouteContainerPanelDockTabItem<WorkspaceDrawerDockTabKey>
) => String(tab.title ?? tab.label ?? '')

const renderWorkspaceDrawerDockTabContent = (
  tab: RouteContainerPanelDockTabItem<WorkspaceDrawerDockTabKey>,
  isVisible: boolean
) =>
  typeof tab.content === 'function'
    ? tab.content({ isVisible, tab, tabKey: tab.key })
    : tab.content

function ChatWorkspaceDrawerMobileActionButton({
  action
}: {
  action: RouteContainerPanelDockActionItem
}) {
  const [isOpen, setIsOpen] = useState(false)
  const icon = action.active && action.activeIcon != null ? action.activeIcon : action.icon
  const hasMenu = action.menuItems != null && action.menuItems.length > 0
  const button = (
    <Tooltip title={action.label} placement='bottom'>
      <button
        type='button'
        className={[
          'chat-workspace-drawer__mobile-icon-button',
          action.active ? 'is-active' : '',
          isOpen ? 'is-open' : ''
        ].filter(Boolean).join(' ')}
        aria-label={action.label}
        aria-pressed={action.active}
        disabled={action.disabled}
        title={action.label}
        onClick={hasMenu ? undefined : action.onSelect}
      >
        <MaterialSymbol name={icon} aria-hidden='true' />
      </button>
    </Tooltip>
  )

  if (!hasMenu) return button

  return (
    <Dropdown
      overlayClassName='chat-workspace-drawer-context-dropdown'
      menu={{ items: action.menuItems }}
      open={isOpen}
      placement='bottomRight'
      trigger={['click']}
      onOpenChange={(open) => {
        setIsOpen(open)
        action.onMenuOpenChange?.(open)
      }}
    >
      {button}
    </Dropdown>
  )
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)

const toWorkspaceDrawerPanelTab = (
  item: WorkspaceDrawerViewItem
): Extract<SessionPanelTab, { kind: 'workspace-drawer' }> => ({
  id: toWorkspaceDrawerInteractionTabId(item.key),
  kind: 'workspace-drawer',
  title: item.label,
  view: item.key
})

const toWorkspaceDrawerDockKeyFromTab = (tab: SessionPanelTab): WorkspaceDrawerDockTabKey | null => {
  if (tab.kind === 'workspace-drawer') return tab.view as WorkspaceDrawerDockTabKey
  if (tab.kind === 'terminal') {
    return tab.id.startsWith(WORKSPACE_DRAWER_TERMINAL_TAB_PREFIX)
      ? tab.id as WorkspaceDrawerDockTabKey
      : toWorkspaceDrawerTerminalTabKey(tab.terminalId)
  }
  if (tab.kind === 'web') {
    return tab.id.startsWith(WORKSPACE_DRAWER_IFRAME_TAB_PREFIX)
      ? tab.id as WorkspaceDrawerDockTabKey
      : toWorkspaceDrawerIframeTabKey(tab.id)
  }
  if (tab.kind === 'mobile-debug') {
    return tab.id.startsWith(WORKSPACE_DRAWER_MOBILE_DEBUG_TAB_PREFIX)
      ? tab.id as WorkspaceDrawerDockTabKey
      : toWorkspaceDrawerMobileDebugTabKey(tab.id)
  }
  if (tab.kind === 'page-debugger') return WORKSPACE_DRAWER_PAGE_DEBUGGER_TAB_KEY
  if (tab.kind === 'plugin') {
    return tab.id.startsWith(WORKSPACE_DRAWER_PLUGIN_TAB_PREFIX)
      ? tab.id as WorkspaceDrawerDockTabKey
      : toWorkspaceDrawerPluginTabKey(tab.id)
  }
  if (tab.kind === 'session') {
    return tab.id.startsWith(WORKSPACE_DRAWER_SESSION_TAB_PREFIX)
      ? tab.id as WorkspaceDrawerDockTabKey
      : toWorkspaceDrawerSessionTabKey(tab.id)
  }
  return null
}

const toWorkspaceDrawerPanelActiveTabId = (
  key: WorkspaceDrawerDockTabKey,
  availableViewSet: ReadonlySet<WorkspaceDrawerView>
) => isWorkspaceDrawerViewTabKey(key, availableViewSet) ? toWorkspaceDrawerInteractionTabId(key) : key

const toHostedPageId = (tabId: string, prefix: string) =>
  tabId.startsWith(prefix) ? decodeURIComponent(tabId.slice(prefix.length)) : tabId

const toRightIframePage = (tab: Extract<SessionPanelTab, { kind: 'web' }>) => ({
  id: toHostedPageId(tab.id, WORKSPACE_DRAWER_IFRAME_TAB_PREFIX),
  title: tab.title,
  url: tab.url,
  ...(tab.faviconUrl == null ? {} : { faviconUrl: tab.faviconUrl }),
  ...(tab.history == null ? {} : { history: tab.history }),
  ...(tab.historyIndex == null ? {} : { historyIndex: tab.historyIndex }),
  ...(tab.variant == null ? {} : { variant: tab.variant })
})

const toRightWebPanelTab = (page: InteractionPanelIframePage): Extract<SessionPanelTab, { kind: 'web' }> => ({
  id: toWorkspaceDrawerIframeTabKey(page.id),
  kind: 'web',
  title: page.title,
  url: page.url,
  ...(page.faviconUrl == null ? {} : { faviconUrl: page.faviconUrl }),
  ...(page.history == null ? {} : { history: page.history }),
  ...(page.historyIndex == null ? {} : { historyIndex: page.historyIndex }),
  ...(page.variant == null ? {} : { variant: page.variant })
})

const toRightMobileDebugPage = (
  tab: Extract<SessionPanelTab, { kind: 'mobile-debug' }>
): InteractionPanelMobileDebugPage => {
  const state = isObjectRecord(tab.state) ? tab.state : {}
  return {
    id: toHostedPageId(tab.id, WORKSPACE_DRAWER_MOBILE_DEBUG_TAB_PREFIX),
    title: tab.title,
    ...(Array.isArray(state.deviceOptions) ? { deviceOptions: state.deviceOptions as any } : {}),
    ...(state.mode === 'config' || state.mode === 'targets' ? { mode: state.mode } : {}),
    ...(typeof state.selectedDeviceId === 'string' ? { selectedDeviceId: state.selectedDeviceId } : {}),
    ...(typeof state.selectedDeviceLabel === 'string' ? { selectedDeviceLabel: state.selectedDeviceLabel } : {})
  }
}

const toRightMobileDebugPanelTab = (
  page: InteractionPanelMobileDebugPage
): Extract<SessionPanelTab, { kind: 'mobile-debug' }> => ({
  id: toWorkspaceDrawerMobileDebugTabKey(page.id),
  kind: 'mobile-debug',
  title: page.title,
  state: {
    ...(page.deviceOptions == null ? {} : { deviceOptions: page.deviceOptions }),
    ...(page.mode == null ? {} : { mode: page.mode }),
    ...(page.selectedDeviceId == null ? {} : { selectedDeviceId: page.selectedDeviceId }),
    ...(page.selectedDeviceLabel == null ? {} : { selectedDeviceLabel: page.selectedDeviceLabel })
  }
})

const toRightSessionPage = (tab: Extract<SessionPanelTab, { kind: 'session' }>): InteractionPanelSessionPage => ({
  id: toHostedPageId(tab.id, WORKSPACE_DRAWER_SESSION_TAB_PREFIX),
  title: tab.title,
  ...(tab.focusRequestId == null ? {} : { focusRequestId: tab.focusRequestId }),
  ...(tab.sessionId == null ? {} : { sessionId: tab.sessionId })
})

const toRightSessionPanelTab = (page: InteractionPanelSessionPage): Extract<SessionPanelTab, { kind: 'session' }> => ({
  id: toWorkspaceDrawerSessionTabKey(page.id),
  kind: 'session',
  title: page.title,
  ...(page.focusRequestId == null ? {} : { focusRequestId: page.focusRequestId }),
  ...(page.sessionId == null ? {} : { sessionId: page.sessionId })
})

const toRightPluginPage = (tab: Extract<SessionPanelTab, { kind: 'plugin' }>): InteractionPanelPluginPage => ({
  icon: tab.icon ?? 'layers',
  id: toHostedPageId(tab.id, WORKSPACE_DRAWER_PLUGIN_TAB_PREFIX),
  pluginScope: tab.pluginScope,
  tabId: tab.tabId,
  title: tab.title,
  viewId: tab.viewId
})

const toRightPluginPanelTab = (
  page: InteractionPanelPluginPage,
  previous?: Extract<SessionPanelTab, { kind: 'plugin' }>
): Extract<SessionPanelTab, { kind: 'plugin' }> => ({
  id: toWorkspaceDrawerPluginTabKey(page.id),
  kind: 'plugin',
  icon: page.icon,
  pluginScope: page.pluginScope,
  tabId: page.tabId,
  title: page.title,
  viewId: page.viewId,
  ...(previous?.state === undefined ? {} : { state: previous.state }),
  ...(previous?.stateVersion == null ? {} : { stateVersion: previous.stateVersion })
})

export function ChatWorkspaceDrawer({
  agentApprovals,
  agentRoster,
  defaultView,
  isBottomPanelOpen = false,
  isFullscreen = false,
  locateFileRequest,
  onClose,
  onFullscreenChange,
  onOpenBottomPanel,
  onOpenFile,
  onOpenResource,
  onOpenSidebar,
  openResourceShortcut,
  openResourceShortcutLabel,
  panelStateController,
  onReferencePaths,
  selectedFilePath,
  settingsView,
  sessionId,
  terminalSessionId,
  terminalPanes
}: {
  agentApprovals?: ChatWorkspaceDrawerAgentApprovals
  agentRoster?: ChatWorkspaceDrawerAgentRoster
  defaultView?: WorkspaceDrawerView
  isBottomPanelOpen?: boolean
  isFullscreen?: boolean
  locateFileRequest?: ChatWorkspaceDrawerLocateFileRequest | null
  onClose?: () => void
  onFullscreenChange?: (fullscreen: boolean) => void
  onOpenBottomPanel?: () => void
  onOpenFile?: (path: string) => void
  onOpenResource: () => void
  onOpenSidebar?: () => void
  openResourceShortcut?: string
  openResourceShortcutLabel?: string
  panelStateController: SessionPanelStateController
  onReferencePaths?: (files: ContextPickerFile[]) => void
  selectedFilePath?: string | null
  settingsView?: ReactNode
  sessionId?: string
  terminalSessionId: string
  terminalPanes: InteractionTerminalPanesController
}) {
  const { i18n, t } = useTranslation()
  const { message } = App.useApp()
  const navigate = useNavigate()
  const responsiveLayout = useResponsiveLayout()
  const maxPinnedTabs = useAtomValue(interactionPanelPinnedTabLimitAtom)
  const [editingPinnedTab, setEditingPinnedTab] = useState<InteractionPanelPinnedTab | null>(null)
  const [mobileViewMode, setMobileViewMode] = useState<'overview' | 'tab'>('overview')
  const [mobileSearchQuery, setMobileSearchQuery] = useState('')
  const hasApprovalsTab = agentApprovals != null
  const hasAgentsTab = agentRoster != null
  const hasSettingsTab = settingsView != null
  const pluginTabs = usePluginSlot<PluginContributionWorkbenchTab>('workbench.tabs')
  const pluginAddMenuItems = usePluginSlot<PluginContributionWorkbenchAddMenuItem>('workbench.addMenu')
  const executePluginCommand = usePluginCommandExecutor()
  const pluginLanguage = i18n.resolvedLanguage ?? i18n.language
  const drawerRef = useRef<HTMLElement | null>(null)
  const resetDrawerScroll = useCallback((element: HTMLElement | null) => {
    if (element == null) return
    if (element.scrollTop !== 0) element.scrollTop = 0
    if (element.scrollLeft !== 0) element.scrollLeft = 0
  }, [])
  const handleDrawerScroll = useCallback((event: UIEvent<HTMLElement>) => {
    resetDrawerScroll(event.currentTarget)
  }, [resetDrawerScroll])
  const pluginDrawerViews = useMemo(() => getPluginWorkspaceDrawerViews(pluginTabs), [pluginTabs])
  const isPluginDrawerViewUnavailable = useCallback((view: WorkspaceDrawerView) => (
    view.startsWith('plugin:') && !pluginDrawerViews.has(view as `plugin:${string}:${string}`)
  ), [pluginDrawerViews])
  const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac')
  const { panelState, updateArea } = panelStateController
  const rightPanelTabs = panelState.right.tabs
  const isAndroidDeviceShell = typeof window !== 'undefined' && (
    window.oneworksDeviceShell?.shellKind === 'android' ||
    window.oneworksDesktop?.shellKind === 'android'
  )
  const shouldUseMobileTabSwitcher = isAndroidDeviceShell &&
    (responsiveLayout.isCompactLayout || responsiveLayout.isTouchInteraction)

  useEffect(() => {
    resetDrawerScroll(drawerRef.current)
  }, [isFullscreen, resetDrawerScroll])

  useEffect(() => {
    if (!shouldUseMobileTabSwitcher) {
      setMobileViewMode('overview')
      setMobileSearchQuery('')
    }
  }, [shouldUseMobileTabSwitcher])

  const workspaceDrawerStorageKey = `chat-workspace-drawer:${sessionId ?? 'workspace'}`
  const workspaceDrawerPinnedTabsStorageKey = `${workspaceDrawerStorageKey}:pinned`
  const workspaceDrawerIframeSessionId = `${workspaceDrawerStorageKey}:iframes`
  const copyContextText = useCopyTextWithFeedback(t('common.copyFailed'), message)
  const iframePages = useMemo(() =>
    rightPanelTabs
      .filter((tab): tab is Extract<SessionPanelTab, { kind: 'web' }> => tab.kind === 'web')
      .map(toRightIframePage), [rightPanelTabs])
  const mobileDebugPages = useMemo(() =>
    rightPanelTabs
      .filter((tab): tab is Extract<SessionPanelTab, { kind: 'mobile-debug' }> => tab.kind === 'mobile-debug')
      .map(toRightMobileDebugPage), [rightPanelTabs])
  const sessionPages = useMemo(() =>
    rightPanelTabs
      .filter((tab): tab is Extract<SessionPanelTab, { kind: 'session' }> => tab.kind === 'session')
      .map(toRightSessionPage), [rightPanelTabs])
  const pluginPages = useMemo(() =>
    rightPanelTabs
      .filter((tab): tab is Extract<SessionPanelTab, { kind: 'plugin' }> => tab.kind === 'plugin')
      .map(toRightPluginPage), [rightPanelTabs])
  const isPageDebuggerListOpen = rightPanelTabs.some(tab => tab.kind === 'page-debugger')
  const mobileDebugPage = mobileDebugPages[0]
  const { deviceOptions, refreshDeviceOptions } = useInteractionPanelMobileDebugDeviceOptions(
    mobileDebugPage?.deviceOptions
  )
  const [treeActivePath, setTreeActivePath] = useState<string | null>(selectedFilePath ?? null)
  const gitKey = sessionId != null && sessionId !== ''
    ? ['chat-workspace-drawer-git', sessionId]
    : 'chat-workspace-drawer-git'
  const {
    data: repoState,
    isLoading: isGitLoading,
    mutate: mutateGitState
  } = useSWR<GitRepositoryState>(
    gitKey,
    () => sessionId != null && sessionId !== '' ? getSessionGitState(sessionId) : getWorkspaceGitState(),
    { refreshInterval: 3000, revalidateOnFocus: true }
  )
  const changedFilesCount = repoState?.available === true ? repoState.changedFiles?.length ?? 0 : 0
  const approvalMessages = useMemo(
    () => agentApprovals == null ? [] : getAgentRoomApprovalMessages(agentApprovals.room),
    [agentApprovals]
  )
  const hasPendingApprovals = approvalMessages.length > 0
  const agentRosterSummary = useMemo(() => {
    if (agentRoster == null) {
      return undefined
    }

    return {
      memberCount: agentRoster.members.length,
      pendingCount: agentRoster.members.reduce((count, member) => count + member.pendingCount, 0)
    }
  }, [agentRoster])
  const viewItems = useMemo(() =>
    buildWorkspaceDrawerViewItems({
      agentRosterCount: agentRosterSummary == null
        ? undefined
        : agentRosterSummary.pendingCount > 0
        ? agentRosterSummary.pendingCount
        : agentRosterSummary.memberCount,
      approvalCount: approvalMessages.length,
      changedFilesCount,
      hasAgentsTab: agentRosterSummary != null,
      hasApprovalsTab,
      hasSettingsTab,
      language: pluginLanguage,
      pluginTabs,
      t
    }), [
    agentRosterSummary,
    approvalMessages.length,
    changedFilesCount,
    hasApprovalsTab,
    hasSettingsTab,
    pluginLanguage,
    pluginTabs,
    t
  ])
  const availableViewKeys = useMemo(() => viewItems.map(item => item.key), [viewItems])
  const availableViewSet = useMemo(() => new Set<WorkspaceDrawerView>(availableViewKeys), [availableViewKeys])
  const viewItemByKey = useMemo(() => new Map(viewItems.map(item => [item.key, item])), [viewItems])
  const preferredDefaultView: WorkspaceDrawerView | undefined =
    defaultView === 'approvals' && !hasPendingApprovals && hasAgentsTab
      ? 'agents'
      : defaultView
  const fallbackView: WorkspaceDrawerView = hasAgentsTab ? 'agents' : 'tree'
  const isWorkspaceDrawerViewUnavailable = (view: WorkspaceDrawerView | null | undefined) =>
    (view === 'agents' && !hasAgentsTab) ||
    (view === 'approvals' && !hasApprovalsTab) ||
    (view === 'settings' && !hasSettingsTab) ||
    (view != null && isPluginDrawerViewUnavailable(view))
  const isDefaultViewUnavailable = preferredDefaultView != null &&
    isWorkspaceDrawerViewUnavailable(preferredDefaultView)
  const initialView = preferredDefaultView == null
    ? null
    : isDefaultViewUnavailable
    ? fallbackView
    : preferredDefaultView
  const [activeTabKey, setActiveTabKey] = useState<WorkspaceDrawerDockTabKey | null>(() => initialView)
  const activeTabKeyRef = useRef<WorkspaceDrawerDockTabKey | null>(initialView)
  const locallyActivatedRightTabKeyRef = useRef<WorkspaceDrawerDockTabKey | null>(null)
  const updateRightArea = useCallback((
    updater: (current: SessionPanelTab[], activeTabId?: string) => {
      activeTabId?: string
      tabs: SessionPanelTab[]
    }
  ) => {
    updateArea('right', (area) => {
      const next = updater(area.tabs, area.activeTabId)
      return {
        ...(area.layout == null ? {} : { layout: area.layout }),
        tabs: next.tabs,
        ...(next.activeTabId == null ? {} : { activeTabId: next.activeTabId })
      }
    })
  }, [updateArea])
  const upsertRightPanelTab = useCallback((tab: SessionPanelTab) => {
    updateRightArea((current) => {
      const existingIndex = current.findIndex(item => item.id === tab.id)
      const tabs = existingIndex < 0
        ? [...current, tab]
        : current.map(item => item.id === tab.id ? tab : item)
      return { tabs, activeTabId: tab.id }
    })
  }, [updateRightArea])
  const activateRightPanelTab = useCallback((tabId: string) => {
    updateRightArea(current => ({
      tabs: current,
      activeTabId: tabId
    }))
  }, [updateRightArea])
  const handleRightDockLayoutChange = useCallback((layout: RouteContainerPanelDockLayout) => {
    updateArea('right', area => {
      const currentActiveTabKey = locallyActivatedRightTabKeyRef.current ?? activeTabKeyRef.current
      const activeTabId = currentActiveTabKey == null
        ? area.activeTabId
        : toWorkspaceDrawerPanelActiveTabId(currentActiveTabKey, availableViewSet)
      return {
        ...area,
        ...(activeTabId == null || !area.tabs.some(tab => tab.id === activeTabId) ? {} : { activeTabId }),
        layout:
          areRouteContainerPanelDockLayoutsEquivalent(area.layout as RouteContainerPanelDockLayout | undefined, layout)
            ? area.layout
            : layout as unknown as Record<string, unknown>
      }
    })
  }, [availableViewSet, updateArea])
  const openDrawerView = useCallback((view: WorkspaceDrawerView) => {
    const item = viewItemByKey.get(view)
    if (item == null) return

    activeTabKeyRef.current = view
    locallyActivatedRightTabKeyRef.current = view
    setActiveTabKey(view)
    upsertRightPanelTab(toWorkspaceDrawerPanelTab(item))
  }, [upsertRightPanelTab, viewItemByKey])

  const workspaceDrawerDockActions = useWorkspaceDrawerDockActions({
    includeCloseAction: false,
    onActivateView: openDrawerView,
    onClose,
    onForceSync: mutateGitState,
    selectedFilePath,
    t
  })
  const { handleForceSync, handleWorkspaceTreeCommand } = workspaceDrawerDockActions
  const panelChromeActions = useMemo<RouteContainerPanelDockChromeActionsConfig>(() => ({
    ...(onClose == null
      ? {}
      : {
        ...(!isBottomPanelOpen && onOpenBottomPanel != null
          ? {
            beforeClose: {
              icon: 'bottom_panel_open',
              label: t('chat.bottomPanelToggle'),
              onSelect: onOpenBottomPanel
            }
          }
          : {}),
        close: {
          icon: 'right_panel_close',
          label: t('chat.workspaceDrawerCollapse'),
          onSelect: onClose
        }
      }),
    ...(onFullscreenChange == null
      ? {}
      : {
        fullscreen: {
          active: isFullscreen,
          label: isFullscreen ? t('common.exitFullscreen') : t('common.enterFullscreen'),
          onSelect: () => onFullscreenChange(!isFullscreen)
        }
      })
  }), [isBottomPanelOpen, isFullscreen, onClose, onFullscreenChange, onOpenBottomPanel, t])

  useEffect(() => setTreeActivePath(selectedFilePath ?? null), [selectedFilePath])

  useEffect(() => {
    const nextPages = normalizeInteractionPanelPluginPages(pluginPages, pluginTabs, pluginLanguage)
    if (areInteractionPanelPluginPagesEqual(pluginPages, nextPages)) return

    updateRightArea((current, activeTabId) => {
      const nextPageById = new Map(nextPages.map(page => [page.id, page]))
      const tabs = current.flatMap((tab): SessionPanelTab[] => {
        if (tab.kind !== 'plugin') return [tab]
        const nextPage = nextPageById.get(toHostedPageId(tab.id, WORKSPACE_DRAWER_PLUGIN_TAB_PREFIX))
        return nextPage == null ? [] : [toRightPluginPanelTab(nextPage, tab)]
      })
      return {
        tabs,
        activeTabId: activeTabId != null && tabs.some(tab => tab.id === activeTabId) ? activeTabId : tabs[0]?.id
      }
    })
  }, [pluginLanguage, pluginPages, pluginTabs, updateRightArea])

  useEffect(() => {
    const path = locateFileRequest?.path.trim()
    if (locateFileRequest == null || path == null || path === '') return

    setTreeActivePath(path)
    handleWorkspaceTreeCommand('locate', path)
  }, [handleWorkspaceTreeCommand, locateFileRequest])

  const drawerTerminalPanes = useMemo(
    () => terminalPanes.panes.filter(pane => isTerminalPaneOnSurface(pane, 'workspace-drawer')),
    [terminalPanes.panes]
  )
  const rightPanelTabKeys = useMemo(() =>
    rightPanelTabs
      .map(toWorkspaceDrawerDockKeyFromTab)
      .filter((key): key is WorkspaceDrawerDockTabKey => key != null), [rightPanelTabs])
  const openedTabKeys = useMemo(
    () => uniqueWorkspaceDrawerDockTabKeys(rightPanelTabKeys),
    [rightPanelTabKeys]
  )
  const persistedRightActiveTabKey = useMemo(() => {
    const activePanelTab = rightPanelTabs.find(tab => tab.id === panelState.right.activeTabId)
    return activePanelTab == null ? null : toWorkspaceDrawerDockKeyFromTab(activePanelTab)
  }, [panelState.right.activeTabId, rightPanelTabs])
  const resolvedActiveTabKey = persistedRightActiveTabKey != null && openedTabKeys.includes(persistedRightActiveTabKey)
    ? persistedRightActiveTabKey
    : activeTabKey != null && openedTabKeys.includes(activeTabKey)
    ? activeTabKey
    : openedTabKeys[0] ?? null
  const drawerInteractionTabs = useMemo<InteractionPanelTab[]>(() => {
    const terminalPaneById = new Map(drawerTerminalPanes.map(pane => [pane.id, pane]))
    const iframePageByKey = new Map(iframePages.map(page => [toWorkspaceDrawerIframeTabKey(page.id), page]))
    const mobileDebugPageByKey = new Map(
      mobileDebugPages.map(page => [toWorkspaceDrawerMobileDebugTabKey(page.id), page])
    )
    const pluginPageByKey = new Map(pluginPages.map(page => [toWorkspaceDrawerPluginTabKey(page.id), page]))
    const sessionPageByKey = new Map(sessionPages.map(page => [toWorkspaceDrawerSessionTabKey(page.id), page]))

    return openedTabKeys.flatMap((key): InteractionPanelTab[] => {
      if (isWorkspaceDrawerViewTabKey(key, availableViewSet)) {
        const item = viewItemByKey.get(key)
        if (item == null) return []

        return [{
          canClose: true,
          icon: item.icon,
          id: key,
          kind: 'workspace-drawer',
          label: item.label,
          view: key
        }]
      }

      const terminalId = decodeWorkspaceDrawerHostedTabId(key, WORKSPACE_DRAWER_TERMINAL_TAB_PREFIX)
      const terminalPane = terminalId == null ? undefined : terminalPaneById.get(terminalId)
      if (terminalPane != null) {
        const icon = terminalPane.runCommand?.icon ?? (
          terminalPanes.infoById[terminalPane.id]?.isExited === true ? 'terminal_off' : 'terminal'
        )

        return [{
          canClose: true,
          icon,
          id: key,
          kind: 'terminal',
          label: terminalPane.title,
          shellKind: terminalPane.shellKind
        }]
      }

      const sessionPage = sessionPageByKey.get(key)
      if (sessionPage != null) {
        return [{
          canClose: true,
          icon: 'chat',
          id: key,
          kind: 'session',
          label: sessionPage.title,
          sessionId: sessionPage.sessionId
        }]
      }

      const mobileDebugPage = mobileDebugPageByKey.get(key)
      if (mobileDebugPage != null) {
        return [{
          canClose: true,
          icon: 'phonelink_setup',
          id: key,
          kind: 'mobile-debug',
          label: mobileDebugPage.selectedDeviceLabel == null || mobileDebugPage.selectedDeviceLabel === ''
            ? mobileDebugPage.title
            : `${mobileDebugPage.title} · ${mobileDebugPage.selectedDeviceLabel}`
        }]
      }

      if (key === WORKSPACE_DRAWER_PAGE_DEBUGGER_TAB_KEY) {
        return [{
          canClose: true,
          icon: 'data_object',
          id: key,
          kind: 'page-debugger',
          label: t('chat.interactionPanel.pageDebuggerListTitle')
        }]
      }

      const pluginPage = pluginPageByKey.get(key)
      if (pluginPage != null) {
        return [{
          canClose: true,
          icon: pluginPage.icon,
          id: key,
          kind: 'plugin',
          label: pluginPage.title,
          pluginScope: pluginPage.pluginScope,
          tabId: pluginPage.tabId,
          viewId: pluginPage.viewId
        }]
      }

      const iframePage = iframePageByKey.get(key)
      if (iframePage != null) {
        return [{
          canClose: true,
          faviconUrl: iframePage.faviconUrl,
          icon: 'language',
          id: key,
          kind: 'iframe',
          label: iframePage.title
        }]
      }

      return []
    })
  }, [
    availableViewSet,
    drawerTerminalPanes,
    iframePages,
    mobileDebugPages,
    openedTabKeys,
    pluginPages,
    sessionPages,
    t,
    terminalPanes.infoById,
    viewItemByKey
  ])
  const drawerTabById = useMemo(
    () => Object.fromEntries(drawerInteractionTabs.map(tab => [tab.id, tab])),
    [drawerInteractionTabs]
  )
  const drawerPinnedTabs = useInteractionPanelPinnedTabs({
    maxPinnedTabs,
    tabs: drawerInteractionTabs,
    terminalSessionId: workspaceDrawerPinnedTabsStorageKey
  })
  const drawerPinnedTabById = useMemo(
    () => Object.fromEntries(drawerPinnedTabs.pinnedTabs.map(tab => [tab.id, tab])),
    [drawerPinnedTabs.pinnedTabs]
  )
  const drawerIframePageByTabKey = useMemo(
    () =>
      Object.fromEntries(
        iframePages.map(page => [toWorkspaceDrawerIframeTabKey(page.id), page])
      ),
    [iframePages]
  )

  useEffect(() => {
    activeTabKeyRef.current = activeTabKey
  }, [activeTabKey])

  useEffect(() => {
    if (activeTabKey === resolvedActiveTabKey) {
      if (persistedRightActiveTabKey === resolvedActiveTabKey) {
        locallyActivatedRightTabKeyRef.current = null
      }
      return
    }

    debugWorkspaceDrawer('apply active sync', {
      activeTabKey,
      openedTabKeys,
      persistedRightActiveTabKey,
      resolvedActiveTabKey
    })
    activeTabKeyRef.current = resolvedActiveTabKey
    setActiveTabKey(resolvedActiveTabKey)
  }, [activeTabKey, openedTabKeys, persistedRightActiveTabKey, resolvedActiveTabKey])

  const handleDockTabChange = useCallback((
    nextTabKey: WorkspaceDrawerDockTabKey | null,
    nextOpenedTabKeys: WorkspaceDrawerDockTabKey[]
  ) => {
    debugWorkspaceDrawer('dock tab change', {
      nextOpenedTabKeys,
      nextTabKey,
      persistedRightActiveTabKey
    })
    if (nextTabKey != null) {
      activeTabKeyRef.current = nextTabKey
      locallyActivatedRightTabKeyRef.current = nextTabKey
      setActiveTabKey(nextTabKey)
    } else {
      activeTabKeyRef.current = null
      locallyActivatedRightTabKeyRef.current = null
      setActiveTabKey(null)
    }

    const nextOpenedTabKeySet = new Set<WorkspaceDrawerDockTabKey>(nextOpenedTabKeys)
    const previousTabByDockKey = new Map<WorkspaceDrawerDockTabKey, SessionPanelTab>()
    for (const tab of rightPanelTabs) {
      const key = toWorkspaceDrawerDockKeyFromTab(tab)
      if (key != null) previousTabByDockKey.set(key, tab)
    }
    const closedTerminalIds = rightPanelTabs
      .filter((tab): tab is Extract<SessionPanelTab, { kind: 'terminal' }> => tab.kind === 'terminal')
      .filter(tab => {
        const key = toWorkspaceDrawerDockKeyFromTab(tab)
        return key == null || !nextOpenedTabKeySet.has(key)
      })
      .map(tab => tab.terminalId)
    if (closedTerminalIds.length > 0) {
      terminalPanes.closeTerminals(closedTerminalIds)
    }

    updateRightArea(() => {
      const tabs = nextOpenedTabKeys.flatMap((key): SessionPanelTab[] => {
        if (isWorkspaceDrawerViewTabKey(key, availableViewSet)) {
          const item = viewItems.find(candidate => candidate.key === key)
          return item == null ? [] : [toWorkspaceDrawerPanelTab(item)]
        }

        const tab = previousTabByDockKey.get(key)
        return tab == null ? [] : [tab]
      })
      const activeTabId = nextTabKey == null
        ? undefined
        : toWorkspaceDrawerPanelActiveTabId(nextTabKey, availableViewSet)
      debugWorkspaceDrawer('persist dock tabs', {
        activeTabId,
        nextOpenedTabKeys,
        nextTabKey,
        persistedRightActiveTabKey,
        tabIds: tabs.map(tab => tab.id)
      })
      return {
        tabs,
        ...(activeTabId == null || !tabs.some(tab => tab.id === activeTabId) ? {} : { activeTabId })
      }
    })
  }, [availableViewSet, persistedRightActiveTabKey, rightPanelTabs, terminalPanes, updateRightArea, viewItems])

  const updateRightWebTab = useCallback((
    pageId: string,
    updater: (page: InteractionPanelIframePage) => InteractionPanelIframePage
  ) => {
    updateRightArea((current, activeTabId) => ({
      tabs: current.map(tab =>
        tab.kind === 'web' && toHostedPageId(tab.id, WORKSPACE_DRAWER_IFRAME_TAB_PREFIX) === pageId
          ? toRightWebPanelTab(updater(toRightIframePage(tab)))
          : tab
      ),
      activeTabId
    }))
  }, [updateRightArea])

  const updateRightMobileDebugPage = useCallback((
    pageId: string,
    updater: (page: InteractionPanelMobileDebugPage) => InteractionPanelMobileDebugPage
  ) => {
    updateRightArea((current, activeTabId) => ({
      tabs: current.map(tab =>
        tab.kind === 'mobile-debug' && toHostedPageId(tab.id, WORKSPACE_DRAWER_MOBILE_DEBUG_TAB_PREFIX) === pageId
          ? toRightMobileDebugPanelTab(updater(toRightMobileDebugPage(tab)))
          : tab
      ),
      activeTabId
    }))
  }, [updateRightArea])

  const updateRightSessionPage = useCallback((
    pageId: string,
    updater: (page: InteractionPanelSessionPage) => InteractionPanelSessionPage
  ) => {
    updateRightArea((current, activeTabId) => ({
      tabs: current.map(tab =>
        tab.kind === 'session' && toHostedPageId(tab.id, WORKSPACE_DRAWER_SESSION_TAB_PREFIX) === pageId
          ? toRightSessionPanelTab(updater(toRightSessionPage(tab)))
          : tab
      ),
      activeTabId
    }))
  }, [updateRightArea])

  const updateRightPluginTabState = useCallback((tabId: string, state: unknown) => {
    updateRightArea((current, activeTabId) => ({
      tabs: current.map(tab => tab.kind === 'plugin' && tab.id === tabId ? { ...tab, state } : tab),
      activeTabId
    }))
  }, [updateRightArea])

  const openRightIframeUrl = useCallback((
    url: string,
    options: OpenInteractionPanelIframeUrlOptions = {}
  ) => {
    const normalizedUrl = normalizeFrameUrl(url)
    const existingTab = rightPanelTabs.find((tab): tab is Extract<SessionPanelTab, { kind: 'web' }> =>
      tab.kind === 'web' && normalizeFrameUrl(tab.url) === normalizedUrl
    )

    if (existingTab != null) {
      const page = toRightIframePage(existingTab)
      const nextPage = {
        ...page,
        ...(options.faviconUrl == null || options.faviconUrl.trim() === '' ? {} : { faviconUrl: options.faviconUrl }),
        ...(options.title == null || options.title.trim() === '' ? {} : { title: options.title.trim() }),
        ...(options.variant == null ? {} : { variant: options.variant })
      }
      const nextTab = toRightWebPanelTab(nextPage)
      upsertRightPanelTab(nextTab)
      setActiveTabKey(nextTab.id as WorkspaceDrawerDockTabKey)
      return nextPage
    }

    const nextPage = updateIframePageUrl(
      createIframePage(
        options.title?.trim() || t('chat.interactionPanel.iframeTitle', { index: iframePages.length + 1 }),
        options
      ),
      normalizedUrl
    )
    const nextTab = toRightWebPanelTab(nextPage)
    upsertRightPanelTab(nextTab)
    setActiveTabKey(nextTab.id as WorkspaceDrawerDockTabKey)
    return nextPage
  }, [iframePages.length, rightPanelTabs, t, upsertRightPanelTab])

  const handleOpenResourceAction = useCallback(() => {
    onOpenResource()
  }, [onOpenResource])
  const handleNewTerminalAction = useCallback((shellKind: TerminalShellKind = 'default') => {
    const pane = terminalPanes.addTerminal(shellKind, { surface: 'workspace-drawer' })
    const tabKey = toWorkspaceDrawerTerminalTabKey(pane.id)
    setActiveTabKey(tabKey)
    upsertRightPanelTab({
      id: tabKey,
      kind: 'terminal',
      terminalId: pane.id,
      title: pane.title,
      ...(pane.runCommand == null ? {} : { runCommand: pane.runCommand }),
      ...(pane.shellKind == null ? {} : { shellKind: pane.shellKind })
    })
  }, [terminalPanes, upsertRightPanelTab])
  const handleNewWebPageAction = useCallback(() => {
    const page = createIframePage(t('chat.interactionPanel.iframeTitle', { index: iframePages.length + 1 }))
    const tab = toRightWebPanelTab(page)
    setActiveTabKey(tab.id as WorkspaceDrawerDockTabKey)
    upsertRightPanelTab(tab)
  }, [iframePages.length, t, upsertRightPanelTab])
  const handleNewSessionAction = useCallback(() => {
    if (sessionId == null || sessionId === '') return

    const page = createInteractionPanelSessionPage(
      t('chat.interactionPanel.sessionTitle', { index: sessionPages.length + 1 })
    )
    const tab = toRightSessionPanelTab(page)
    setActiveTabKey(tab.id as WorkspaceDrawerDockTabKey)
    upsertRightPanelTab(tab)
  }, [sessionId, sessionPages.length, t, upsertRightPanelTab])
  const handleNewMobileDebugPageAction = useCallback(() => {
    const page = {
      ...createInteractionPanelMobileDebugPage(t('chat.interactionPanel.mobileDebugTitle')),
      mode: 'config',
      selectedDeviceId: undefined,
      selectedDeviceLabel: t('chat.interactionPanel.mobileDebugConfig')
    } satisfies InteractionPanelMobileDebugPage
    const tab = toRightMobileDebugPanelTab(page)
    setActiveTabKey(tab.id as WorkspaceDrawerDockTabKey)
    upsertRightPanelTab(tab)
  }, [t, upsertRightPanelTab])
  const handleNewPageDebuggerListAction = useCallback(() => {
    setActiveTabKey(WORKSPACE_DRAWER_PAGE_DEBUGGER_TAB_KEY)
    upsertRightPanelTab({
      id: WORKSPACE_DRAWER_PAGE_DEBUGGER_TAB_KEY,
      kind: 'page-debugger',
      title: t('chat.interactionPanel.pageDebuggerListTitle')
    })
  }, [t, upsertRightPanelTab])

  const handleCloseDockTabGroup = useCallback((tab: InteractionPanelTab, scope: InteractionPanelTabCloseScope) => {
    const targetTabs = getTabsForCloseScope(drawerInteractionTabs, tab, scope)
    const targetTabKeys = new Set(targetTabs.map(item => item.id as WorkspaceDrawerDockTabKey))
    const fallbackTab = getFallbackTabAfterClose(drawerInteractionTabs, targetTabs, tab)
    const nextOpenedTabKeys = openedTabKeys.filter(key => !targetTabKeys.has(key))
    const nextActiveTabKey = resolvedActiveTabKey != null && targetTabKeys.has(resolvedActiveTabKey)
      ? (fallbackTab?.id as WorkspaceDrawerDockTabKey | undefined) ?? null
      : resolvedActiveTabKey

    handleDockTabChange(nextActiveTabKey, nextOpenedTabKeys)
  }, [drawerInteractionTabs, handleDockTabChange, openedTabKeys, resolvedActiveTabKey])

  const getTabContextMenuItems = useCallback((
    context: RouteContainerPanelTabMenuContext<WorkspaceDrawerDockTabKey>
  ) =>
    buildInteractionPanelDockTabContextMenuItems({
      allTabs: drawerInteractionTabs,
      canPinMoreTabs: drawerPinnedTabs.canPinMoreTabs,
      iframePage: drawerIframePageByTabKey[context.tab.key],
      onCopyText: copyContextText,
      onCloseTabGroup: handleCloseDockTabGroup,
      onEditPinnedTab: setEditingPinnedTab,
      onNewTerminal: handleNewTerminalAction,
      onPinTab: drawerPinnedTabs.pinTab,
      onUnpinTab: drawerPinnedTabs.unpinTab,
      pinnedTab: drawerPinnedTabById[context.tab.key],
      t,
      tab: drawerTabById[context.tab.key]
    }), [
    copyContextText,
    drawerIframePageByTabKey,
    drawerInteractionTabs,
    drawerPinnedTabById,
    drawerPinnedTabs.canPinMoreTabs,
    drawerPinnedTabs.pinTab,
    drawerPinnedTabs.unpinTab,
    drawerTabById,
    handleCloseDockTabGroup,
    handleNewTerminalAction,
    t
  ])

  const createMenuItems = useMemo<MenuProps['items']>(() =>
    buildWorkbenchCreateMenuItems(t, isMac, {
      canCreateSessionTab: sessionId != null && sessionId !== '',
      language: pluginLanguage,
      mobileDebugDevices: deviceOptions,
      openResourceShortcut,
      pluginMenuItems: pluginAddMenuItems,
      selectedMobileDebugDeviceId: mobileDebugPage?.selectedDeviceId,
      workspaceDrawerItems: viewItems
    }), [
    deviceOptions,
    isMac,
    mobileDebugPage?.selectedDeviceId,
    openResourceShortcut,
    openResourceShortcutLabel,
    pluginAddMenuItems,
    pluginLanguage,
    sessionId,
    t,
    viewItems
  ])
  const createMenuSelectedKeys = useMemo(
    () =>
      rightPanelTabs.flatMap((tab): string[] => {
        if (tab.kind !== 'workspace-drawer') return []
        const view = tab.view as WorkspaceDrawerView
        return availableViewSet.has(view) ? [toWorkbenchDrawerViewMenuKey(view)] : []
      }),
    [availableViewSet, rightPanelTabs]
  )
  const handleCreateMenuClick: NonNullable<MenuProps['onClick']> = useCallback((info) => {
    const key = String(info.key)
    const drawerView = parseWorkbenchDrawerViewMenuKey(key)
    if (drawerView != null) {
      openDrawerView(drawerView)
      return
    }

    const pluginMenuKey = parseInteractionPanelPluginAddMenuKey(key)
    if (pluginMenuKey != null) {
      const item = pluginAddMenuItems.find(candidate =>
        candidate.pluginScope === pluginMenuKey.scope && candidate.id === pluginMenuKey.id
      )
      if (item == null) return

      if (item.command != null && executePluginCommand != null) {
        void executePluginCommand(item.pluginScope, item.command)
        return
      }
      if (item.route != null) {
        void navigate(item.route)
        return
      }
      if (item.href != null) {
        window.open(item.href, '_blank', 'noopener,noreferrer')
        return
      }

      const tab = resolveInteractionPanelPluginTabDefinition({
        fallbackToSingle: item.tab == null,
        pluginScope: item.pluginScope,
        tabId: item.tab ?? item.id,
        tabs: pluginTabs
      })
      const nextPage = tab == null ? null : createInteractionPanelPluginPage(tab, pluginLanguage)
      if (nextPage != null) {
        const nextTab = toRightPluginPanelTab(nextPage)
        setActiveTabKey(nextTab.id as WorkspaceDrawerDockTabKey)
        upsertRightPanelTab(nextTab)
        return
      }

      void navigate(`/plugins/${item.pluginScope}/${item.id}`)
      return
    }

    if (key === 'resource') {
      handleOpenResourceAction()
      return
    }

    if (key === 'terminal') {
      handleNewTerminalAction()
      return
    }

    if (key === 'iframe') {
      handleNewWebPageAction()
      return
    }

    if (key === 'page-debugger') {
      handleNewPageDebuggerListAction()
      return
    }

    if (key === 'session') {
      handleNewSessionAction()
      return
    }

    if (
      key === 'mobile-debug' ||
      key === INTERACTION_PANEL_MOBILE_DEBUG_CONFIG_KEY ||
      key === INTERACTION_PANEL_MOBILE_DEBUG_NO_DEVICES_KEY
    ) {
      handleNewMobileDebugPageAction()
      return
    }

    const mobileDebugDevice = parseInteractionPanelMobileDebugDeviceMenuKey(key)
    if (mobileDebugDevice != null) {
      const device = deviceOptions.find(option => option.id === mobileDebugDevice.id)
      const page = {
        ...createInteractionPanelMobileDebugPage(t('chat.interactionPanel.mobileDebugTitle')),
        mode: 'targets',
        selectedDeviceId: mobileDebugDevice.id,
        selectedDeviceLabel: device?.label ?? mobileDebugDevice.label ?? mobileDebugDevice.id
      } satisfies InteractionPanelMobileDebugPage
      const tab = toRightMobileDebugPanelTab(page)
      setActiveTabKey(tab.id as WorkspaceDrawerDockTabKey)
      upsertRightPanelTab(tab)
    }
  }, [
    deviceOptions,
    executePluginCommand,
    handleNewMobileDebugPageAction,
    handleNewPageDebuggerListAction,
    handleNewSessionAction,
    handleNewTerminalAction,
    handleNewWebPageAction,
    handleOpenResourceAction,
    navigate,
    openDrawerView,
    pluginAddMenuItems,
    pluginTabs,
    sessionId,
    t,
    upsertRightPanelTab
  ])

  const getHeaderActions = useCallback((
    context: RouteContainerPanelDockHeaderActionContext<WorkspaceDrawerDockTabKey>
  ): RouteContainerPanelDockActionItem[] =>
    workspaceDrawerDockActions.getActionsForView({
      isTopRightGroup: context.isTopRightGroup,
      view: isWorkspaceDrawerViewTabKey(context.groupActiveTabKey, availableViewSet)
        ? context.groupActiveTabKey
        : null
    }), [availableViewSet, workspaceDrawerDockActions])

  const dockTabs = useMemo<Array<RouteContainerPanelDockTabItem<WorkspaceDrawerDockTabKey>>>(() => {
    const drawerTabs: Array<RouteContainerPanelDockTabItem<WorkspaceDrawerDockTabKey>> = viewItems.map((item) => {
      const pinnedTab = drawerPinnedTabById[item.key]

      return {
        activeIcon: pinnedTab?.icon ?? item.icon,
        badge: item.count != null && item.count > 0
          ? <span className='chat-workspace-drawer__view-count'>{item.count}</span>
          : undefined,
        content: () => (
          <WorkspaceDrawerViewPanel
            activeView={item.key}
            agentApprovals={agentApprovals}
            agentRoster={agentRoster}
            approvalMessages={approvalMessages}
            changedLayout={workspaceDrawerDockActions.changedLayout}
            changedTreeCommand={workspaceDrawerDockActions.changedTreeCommand}
            isGitLoading={isGitLoading}
            repoState={repoState}
            selectedFilePath={item.key === 'tree' ? treeActivePath : selectedFilePath}
            settingsView={settingsView}
            sessionId={sessionId}
            pluginTabs={pluginTabs}
            treeRefreshKey={workspaceDrawerDockActions.treeRefreshKey}
            workspaceTreeCommand={workspaceDrawerDockActions.workspaceTreeCommand}
            onOpenFile={onOpenFile}
            onReferencePaths={onReferencePaths}
          />
        ),
        icon: pinnedTab?.icon ?? item.icon,
        key: item.key,
        label: pinnedTab?.title ?? item.label,
        title: pinnedTab?.originalTitle ?? item.label
      }
    })
    const terminalPaneById = new Map(drawerTerminalPanes.map(pane => [pane.id, pane]))
    const terminalTabs: Array<RouteContainerPanelDockTabItem<WorkspaceDrawerDockTabKey>> = rightPanelTabs.flatMap(
      (tab) => {
        if (tab.kind !== 'terminal') return []
        const pane = terminalPaneById.get(tab.terminalId)
        if (pane == null) return []
        const tabKey = toWorkspaceDrawerDockKeyFromTab(tab)
        if (tabKey == null) return []
        const icon = pane.runCommand?.icon ?? (
          terminalPanes.infoById[pane.id]?.isExited === true ? 'terminal_off' : 'terminal'
        )
        const pinnedTab = drawerPinnedTabById[tabKey]

        return [{
          activeIcon: pinnedTab?.icon ?? icon,
          content: ({ isVisible }) => (
            <div className={`chat-interaction-panel__dock-panel-content ${isVisible ? 'is-visible' : 'is-hidden'}`}>
              <ChatTerminalView
                activeTerminalId={isVisible ? pane.id : ''}
                panes={[pane]}
                sessionId={terminalSessionId}
                onExit={terminalPanes.closeTerminal}
                onInfoChange={terminalPanes.handleInfoChange}
                onInitialCommandSent={terminalPanes.markInitialCommandSent}
                onRestartChange={terminalPanes.handleRestartChange}
                onTerminateChange={terminalPanes.handleTerminateChange}
              />
            </div>
          ),
          icon: pinnedTab?.icon ?? icon,
          key: tabKey,
          label: pinnedTab?.title ?? pane.title,
          title: pinnedTab?.originalTitle ?? pane.title
        }]
      }
    )
    const sessionTabs: Array<RouteContainerPanelDockTabItem<WorkspaceDrawerDockTabKey>> = sessionPages
      .map(page => {
        const tabKey = toWorkspaceDrawerSessionTabKey(page.id)
        const pinnedTab = drawerPinnedTabById[tabKey]

        return {
          activeIcon: pinnedTab?.icon ?? 'chat',
          content: ({ isVisible }) => (
            <div className={`chat-interaction-panel__dock-panel-content ${isVisible ? 'is-visible' : 'is-hidden'}`}>
              <InteractionPanelSessionView
                autoFocusRequestId={isVisible ? page.focusRequestId : undefined}
                page={page}
                sourceSessionId={sessionId}
                onChangePage={updater => updateRightSessionPage(page.id, updater)}
              />
            </div>
          ),
          icon: pinnedTab?.icon ?? 'chat',
          key: tabKey,
          label: pinnedTab?.title ?? page.title,
          title: pinnedTab?.originalTitle ?? page.title
        }
      })
    const mobileDebugTabs: Array<RouteContainerPanelDockTabItem<WorkspaceDrawerDockTabKey>> = mobileDebugPages.map(
      page => {
        const tabKey = toWorkspaceDrawerMobileDebugTabKey(page.id)
        const label = page.selectedDeviceLabel == null || page.selectedDeviceLabel === ''
          ? page.title
          : `${page.title} · ${page.selectedDeviceLabel}`
        const pinnedTab = drawerPinnedTabById[tabKey]

        return {
          activeIcon: pinnedTab?.icon ?? 'phonelink_setup',
          content: ({ isVisible }) => (
            <div className={`chat-interaction-panel__dock-panel-content ${isVisible ? 'is-visible' : 'is-hidden'}`}>
              <InteractionPanelMobileDebugView
                isActive={isVisible && resolvedActiveTabKey === tabKey}
                page={page}
                onChangePage={updater => updateRightMobileDebugPage(page.id, updater)}
                onOpenDebugUrl={(url, options) => {
                  const iframePage = openRightIframeUrl(url, options)
                  setActiveTabKey(toWorkspaceDrawerIframeTabKey(iframePage.id))
                }}
              />
            </div>
          ),
          icon: pinnedTab?.icon ?? 'phonelink_setup',
          key: tabKey,
          label: pinnedTab?.title ?? label,
          title: pinnedTab?.originalTitle ?? page.title
        }
      }
    )
    const pageDebuggerTabs: Array<RouteContainerPanelDockTabItem<WorkspaceDrawerDockTabKey>> = isPageDebuggerListOpen
      ? [{
        activeIcon: drawerPinnedTabById[WORKSPACE_DRAWER_PAGE_DEBUGGER_TAB_KEY]?.icon ?? 'data_object',
        content: ({ isVisible }) => (
          <div className={`chat-interaction-panel__dock-panel-content ${isVisible ? 'is-visible' : 'is-hidden'}`}>
            <InteractionPanelPageDebuggerListView
              isActive={isVisible && resolvedActiveTabKey === WORKSPACE_DRAWER_PAGE_DEBUGGER_TAB_KEY}
            />
          </div>
        ),
        icon: drawerPinnedTabById[WORKSPACE_DRAWER_PAGE_DEBUGGER_TAB_KEY]?.icon ?? 'data_object',
        key: WORKSPACE_DRAWER_PAGE_DEBUGGER_TAB_KEY,
        label: drawerPinnedTabById[WORKSPACE_DRAWER_PAGE_DEBUGGER_TAB_KEY]?.title ??
          t('chat.interactionPanel.pageDebuggerListTitle'),
        title: drawerPinnedTabById[WORKSPACE_DRAWER_PAGE_DEBUGGER_TAB_KEY]?.originalTitle ??
          t('chat.interactionPanel.pageDebuggerListTitle')
      }]
      : []
    const pluginDockTabs: Array<RouteContainerPanelDockTabItem<WorkspaceDrawerDockTabKey>> = pluginPages.map((page) => {
      const tabKey = toWorkspaceDrawerPluginTabKey(page.id)
      const pinnedTab = drawerPinnedTabById[tabKey]
      const panelTab = rightPanelTabs.find((tab): tab is Extract<SessionPanelTab, { kind: 'plugin' }> =>
        tab.kind === 'plugin' && toHostedPageId(tab.id, WORKSPACE_DRAWER_PLUGIN_TAB_PREFIX) === page.id
      )

      return {
        activeIcon: pinnedTab?.icon ?? page.icon,
        content: ({ isVisible }) => (
          <div className={`chat-interaction-panel__dock-panel-content ${isVisible ? 'is-visible' : 'is-hidden'}`}>
            <PluginViewHost
              routeId='chat-workspace-drawer'
              scope={page.pluginScope}
              surface='drawer'
              tab={panelTab == null
                ? undefined
                : {
                  id: panelTab.id,
                  setState: nextState => updateRightPluginTabState(panelTab.id, nextState),
                  state: panelTab.state
                }}
              viewId={page.viewId}
            />
          </div>
        ),
        icon: pinnedTab?.icon ?? page.icon,
        key: tabKey,
        label: pinnedTab?.title ?? page.title,
        title: pinnedTab?.originalTitle ?? page.title
      }
    })
    const iframeTabs: Array<RouteContainerPanelDockTabItem<WorkspaceDrawerDockTabKey>> = iframePages
      .map(
        page => {
          const tabKey = toWorkspaceDrawerIframeTabKey(page.id)
          const pinnedTab = drawerPinnedTabById[tabKey]

          return {
            activeIcon: pinnedTab?.icon ?? 'language',
            content: ({ isVisible }) => (
              <div className={`chat-interaction-panel__dock-panel-content ${isVisible ? 'is-visible' : 'is-hidden'}`}>
                <InteractionPanelIframeView
                  isActive={isVisible && resolvedActiveTabKey === tabKey}
                  page={page}
                  projectUrlHistoryKey={`${workspaceDrawerIframeSessionId}:project`}
                  sessionUrlHistoryKey={`${workspaceDrawerIframeSessionId}:session`}
                  onChangeMetadata={(pageId, metadata) =>
                    updateRightWebTab(pageId, current => updateIframePageMetadata(current, metadata))}
                  onSelectHistory={(pageId, index) =>
                    updateRightWebTab(pageId, current => selectIframePageHistoryIndex(current, index))}
                  onChangeUrl={(pageId, url) => updateRightWebTab(pageId, current => updateIframePageUrl(current, url))}
                  onNavigateHistory={(pageId, delta) =>
                    updateRightWebTab(pageId, current => navigateIframePageHistory(current, delta))}
                />
              </div>
            ),
            icon: pinnedTab?.icon ?? 'language',
            iconNode: pinnedTab?.customIcon != null || page.faviconUrl == null || page.faviconUrl === ''
              ? undefined
              : (
                <img
                  alt=''
                  aria-hidden='true'
                  className='chat-interaction-panel__dock-tab-favicon'
                  src={page.faviconUrl}
                />
              ),
            key: tabKey,
            label: pinnedTab?.title ?? page.title,
            title: pinnedTab?.originalTitle ?? page.title
          }
        }
      )

    return [
      ...drawerTabs,
      ...terminalTabs,
      ...sessionTabs,
      ...mobileDebugTabs,
      ...pageDebuggerTabs,
      ...pluginDockTabs,
      ...iframeTabs
    ]
  }, [
    agentApprovals,
    agentRoster,
    approvalMessages,
    drawerPinnedTabById,
    drawerTerminalPanes,
    iframePages,
    isPageDebuggerListOpen,
    isGitLoading,
    mobileDebugPages,
    onOpenFile,
    onReferencePaths,
    openRightIframeUrl,
    pluginPages,
    pluginTabs,
    repoState,
    resolvedActiveTabKey,
    rightPanelTabs,
    selectedFilePath,
    sessionId,
    sessionPages,
    settingsView,
    t,
    terminalPanes,
    terminalSessionId,
    treeActivePath,
    updateRightMobileDebugPage,
    updateRightPluginTabState,
    updateRightSessionPage,
    updateRightWebTab,
    viewItems,
    workspaceDrawerIframeSessionId,
    workspaceDrawerDockActions.changedLayout,
    workspaceDrawerDockActions.changedTreeCommand,
    workspaceDrawerDockActions.treeRefreshKey,
    workspaceDrawerDockActions.workspaceTreeCommand
  ])

  const dockTabByKey = useMemo(
    () => new Map(dockTabs.map(tab => [tab.key, tab])),
    [dockTabs]
  )
  const openedDockTabs = useMemo(
    () =>
      openedTabKeys.flatMap((key) => {
        const tab = dockTabByKey.get(key)
        return tab == null ? [] : [tab]
      }),
    [dockTabByKey, openedTabKeys]
  )
  const activeMobileTab = resolvedActiveTabKey == null
    ? null
    : dockTabByKey.get(resolvedActiveTabKey) ?? null
  const mobileSearchTerm = mobileSearchQuery.trim().toLocaleLowerCase()
  const mobileOverviewTabs = useMemo(() => {
    return dockTabs.filter((tab) => {
      if (mobileSearchTerm === '') return true
      return getWorkspaceDrawerDockTabTitle(tab).toLocaleLowerCase().includes(mobileSearchTerm)
    })
  }, [dockTabs, mobileSearchTerm])
  const mobileInactiveTabCount = Math.max(0, dockTabs.length - openedDockTabs.length)

  const openMobileTab = useCallback((tabKey: WorkspaceDrawerDockTabKey) => {
    handleDockTabChange(tabKey, uniqueWorkspaceDrawerDockTabKeys([...openedTabKeys, tabKey]))
    setMobileViewMode('tab')
  }, [handleDockTabChange, openedTabKeys])

  const closeMobileTab = useCallback((tabKey: WorkspaceDrawerDockTabKey) => {
    const nextOpenedTabKeys = openedTabKeys.filter(key => key !== tabKey)
    const nextActiveTabKey = resolvedActiveTabKey === tabKey
      ? nextOpenedTabKeys.at(-1) ?? null
      : resolvedActiveTabKey

    handleDockTabChange(nextActiveTabKey, nextOpenedTabKeys)
    if (nextActiveTabKey == null) setMobileViewMode('overview')
  }, [handleDockTabChange, openedTabKeys, resolvedActiveTabKey])

  const refreshMobileTab = useCallback(() => {
    if (resolvedActiveTabKey == null) return

    if (isWorkspaceDrawerViewTabKey(resolvedActiveTabKey, availableViewSet)) {
      handleForceSync()
      return
    }

    const currentRightPanelTab = rightPanelTabs.find(tab =>
      toWorkspaceDrawerDockKeyFromTab(tab) === resolvedActiveTabKey
    )
    if (currentRightPanelTab?.kind === 'web') {
      emitDesktopViewShortcut('reload-browser-page')
      return
    }

    handleDockTabChange(
      resolvedActiveTabKey,
      uniqueWorkspaceDrawerDockTabKeys([...openedTabKeys, resolvedActiveTabKey])
    )
  }, [
    availableViewSet,
    handleDockTabChange,
    openedTabKeys,
    resolvedActiveTabKey,
    rightPanelTabs,
    handleForceSync
  ])

  const mobileCurrentHeaderActions = useMemo(() => {
    if (activeMobileTab == null) return []

    return getHeaderActions({
      activeTab: resolvedActiveTabKey,
      groupActiveTab: activeMobileTab,
      groupActiveTabKey: activeMobileTab.key,
      isTopRightGroup: true,
      panelKey: 'chat-workspace-drawer'
    })
  }, [activeMobileTab, getHeaderActions, resolvedActiveTabKey])
  const mobileMoreAction = mobileCurrentHeaderActions.find(action => action.icon === 'more_vert')
  const mobileRegularActions = mobileCurrentHeaderActions.filter(action => action.icon !== 'more_vert')
  const mobileVisibleHeaderActions = mobileRegularActions.slice(0, 2)
  const mobileOverflowHeaderActions = mobileRegularActions.slice(2)
  const mobileMoreMenuItems = useMemo<MenuProps['items']>(() => {
    const items: MenuProps['items'] = []
    const moreItems = mobileMoreAction?.menuItems
    if (moreItems != null && moreItems.length > 0) {
      items.push(...moreItems)
    }
    if (mobileOverflowHeaderActions.length > 0) {
      if (items.length > 0) items.push({ type: 'divider' })
      items.push(...mobileOverflowHeaderActions.map(action => ({
        disabled: action.disabled,
        icon: renderMenuIcon(action.icon),
        key: `mobile-overflow:${action.key}`,
        label: action.label,
        onClick: action.onSelect
      })))
    }
    if (items.length > 0) items.push({ type: 'divider' })
    items.push({
      icon: renderMenuIcon('tab'),
      key: 'mobile-tabs-overview',
      label: t('chat.workspaceDrawerTitle'),
      onClick: () => setMobileViewMode('overview')
    })
    items.push({
      disabled: activeMobileTab == null,
      icon: renderMenuIcon('close'),
      key: 'mobile-tabs-close-current',
      label: t('common.close'),
      onClick: () => {
        if (activeMobileTab != null) closeMobileTab(activeMobileTab.key)
      }
    })
    if (onClose != null) {
      items.push({
        icon: renderMenuIcon('chat'),
        key: 'mobile-tabs-back-session',
        label: t('chat.mobileTabsBackToSession', '返回会话'),
        onClick: onClose
      })
    }
    return items
  }, [
    activeMobileTab,
    closeMobileTab,
    mobileMoreAction?.menuItems,
    mobileOverflowHeaderActions,
    onClose,
    t
  ])
  const mobileOverviewMoreMenuItems = useMemo<MenuProps['items']>(() => [
    {
      icon: renderMenuIcon('language'),
      key: 'new-web-page',
      label: t('chat.interactionPanel.addIframe'),
      onClick: handleNewWebPageAction
    },
    {
      icon: renderMenuIcon('terminal'),
      key: 'new-terminal',
      label: t('launcher.resource.newTerminal', '新建终端 Tab'),
      onClick: () => handleNewTerminalAction()
    },
    ...(onClose == null
      ? []
      : [
        { type: 'divider' as const },
        {
          icon: renderMenuIcon('chat'),
          key: 'back-session',
          label: t('chat.mobileTabsBackToSession', '返回会话'),
          onClick: onClose
        }
      ])
  ], [handleNewTerminalAction, handleNewWebPageAction, onClose, t])
  const mobileActiveContent = activeMobileTab == null
    ? null
    : renderWorkspaceDrawerDockTabContent(activeMobileTab, true)
  const mobileDrawerContent = shouldUseMobileTabSwitcher
    ? (
      mobileViewMode === 'tab' && activeMobileTab != null
        ? (
          <div className='chat-workspace-drawer__mobile-page'>
            <header className='chat-workspace-drawer__mobile-page-header'>
              <div className='chat-workspace-drawer__mobile-header-group'>
                <Tooltip title={t('chat.sidebarOpen', '打开左侧')} placement='bottom'>
                  <button
                    type='button'
                    className='chat-workspace-drawer__mobile-icon-button'
                    aria-label={t('chat.sidebarOpen', '打开左侧')}
                    disabled={onOpenSidebar == null}
                    onClick={onOpenSidebar}
                  >
                    <MaterialSymbol name='left_panel_open' aria-hidden='true' />
                  </button>
                </Tooltip>
                <Tooltip title={t('chat.mobileTabsBackToSession', '返回会话')} placement='bottom'>
                  <button
                    type='button'
                    className='chat-workspace-drawer__mobile-icon-button'
                    aria-label={t('chat.mobileTabsBackToSession', '返回会话')}
                    disabled={onClose == null}
                    onClick={onClose}
                  >
                    <MaterialSymbol name='arrow_back' aria-hidden='true' />
                  </button>
                </Tooltip>
              </div>
              <h2 className='chat-workspace-drawer__mobile-page-title'>
                {getWorkspaceDrawerDockTabTitle(activeMobileTab)}
              </h2>
              <div className='chat-workspace-drawer__mobile-header-group is-right'>
                <Tooltip title={t('common.refresh', '刷新')} placement='bottom'>
                  <button
                    type='button'
                    className='chat-workspace-drawer__mobile-icon-button'
                    aria-label={t('common.refresh', '刷新')}
                    onClick={refreshMobileTab}
                  >
                    <MaterialSymbol name='refresh' aria-hidden='true' />
                  </button>
                </Tooltip>
                {mobileVisibleHeaderActions.map(action => (
                  <ChatWorkspaceDrawerMobileActionButton key={action.key} action={action} />
                ))}
                <Dropdown
                  overlayClassName='chat-workspace-drawer-context-dropdown'
                  menu={{ items: mobileMoreMenuItems }}
                  placement='bottomRight'
                  trigger={['click']}
                >
                  <button
                    type='button'
                    className='chat-workspace-drawer__mobile-icon-button'
                    aria-label={t('common.moreActions')}
                    title={t('common.moreActions')}
                  >
                    <MaterialSymbol name='more_vert' aria-hidden='true' />
                  </button>
                </Dropdown>
              </div>
            </header>
            <div className='chat-workspace-drawer__mobile-page-body'>
              {mobileActiveContent}
            </div>
          </div>
        )
        : (
          <div className='chat-workspace-drawer__mobile-switcher'>
            <header className='chat-workspace-drawer__mobile-switcher-header'>
              <Dropdown
                overlayClassName='chat-workspace-drawer-context-dropdown'
                menu={{
                  items: createMenuItems,
                  onClick: handleCreateMenuClick,
                  selectedKeys: createMenuSelectedKeys
                }}
                placement='bottomLeft'
                trigger={['click']}
                onOpenChange={(open) => {
                  if (open) void refreshDeviceOptions()
                }}
              >
                <button
                  type='button'
                  className='chat-workspace-drawer__mobile-add'
                  aria-label={t('chat.interactionPanel.addTab')}
                  title={t('chat.interactionPanel.addTab')}
                >
                  <MaterialSymbol name='add' aria-hidden='true' />
                </button>
              </Dropdown>
              <div className='chat-workspace-drawer__mobile-mode-switch' aria-label={t('chat.workspaceDrawerTitle')}>
                <button
                  type='button'
                  className='is-active'
                  aria-label={t('chat.workspaceDrawerTitle')}
                  aria-pressed='true'
                >
                  <MaterialSymbol name='tab' aria-hidden='true' />
                  <span>{openedDockTabs.length}</span>
                </button>
                <button
                  type='button'
                  aria-label={t('chat.interactionPanel.allTabs', '所有标签页')}
                  aria-pressed='false'
                >
                  <MaterialSymbol name='grid_view' aria-hidden='true' />
                </button>
              </div>
              <Dropdown
                overlayClassName='chat-workspace-drawer-context-dropdown'
                menu={{ items: mobileOverviewMoreMenuItems }}
                placement='bottomRight'
                trigger={['click']}
              >
                <button
                  type='button'
                  className='chat-workspace-drawer__mobile-more'
                  aria-label={t('common.moreActions')}
                  title={t('common.moreActions')}
                >
                  <MaterialSymbol name='more_vert' aria-hidden='true' />
                </button>
              </Dropdown>
            </header>
            <label className='chat-workspace-drawer__mobile-search'>
              <MaterialSymbol name='search' aria-hidden='true' />
              <input
                value={mobileSearchQuery}
                placeholder={t('chat.interactionPanel.searchTabs', '搜索标签页')}
                onChange={event => setMobileSearchQuery(event.target.value)}
              />
            </label>
            <button
              type='button'
              className='chat-workspace-drawer__mobile-inactive-card'
              onClick={() => setMobileSearchQuery('')}
            >
              <span className='chat-workspace-drawer__mobile-inactive-icon' aria-hidden='true'>
                <MaterialSymbol name='tab_group' />
              </span>
              <span className='chat-workspace-drawer__mobile-inactive-copy'>
                <strong>
                  {t('chat.interactionPanel.inactiveTabsTitle', {
                    count: mobileInactiveTabCount,
                    defaultValue: '({{count}}) 个闲置标签页'
                  })}
                </strong>
                <span>{t('chat.interactionPanel.inactiveTabsDescription', '未使用或重复的标签页和标签页分组')}</span>
              </span>
              <MaterialSymbol name='chevron_right' aria-hidden='true' />
            </button>
            <div className='chat-workspace-drawer__mobile-tab-grid'>
              {mobileOverviewTabs.map((tab) => {
                const title = getWorkspaceDrawerDockTabTitle(tab)
                const isOpened = openedTabKeys.includes(tab.key)
                const isActive = resolvedActiveTabKey === tab.key
                const iconName = tab.activeIcon ?? tab.icon

                return (
                  <article
                    key={tab.key}
                    className={[
                      'chat-workspace-drawer__mobile-tab-card',
                      isActive ? 'is-active' : '',
                      isOpened ? 'is-opened' : ''
                    ].filter(Boolean).join(' ')}
                  >
                    <div className='chat-workspace-drawer__mobile-tab-card-header'>
                      <button
                        type='button'
                        className='chat-workspace-drawer__mobile-tab-card-title'
                        onClick={() => openMobileTab(tab.key)}
                      >
                        {tab.iconNode ?? <MaterialSymbol name={iconName} aria-hidden='true' />}
                        <span>{title}</span>
                      </button>
                      {isOpened
                        ? (
                          <button
                            type='button'
                            className='chat-workspace-drawer__mobile-tab-card-close'
                            aria-label={t('common.close')}
                            onClick={() => closeMobileTab(tab.key)}
                          >
                            <MaterialSymbol name='close' aria-hidden='true' />
                          </button>
                        )
                        : null}
                    </div>
                    <button
                      type='button'
                      className='chat-workspace-drawer__mobile-tab-card-preview'
                      onClick={() => openMobileTab(tab.key)}
                    >
                      <span />
                      <span />
                      <span />
                    </button>
                  </article>
                )
              })}
            </div>
          </div>
        )
    )
    : (
      <RouteContainerPanelDockWorkspace
        activeTab={resolvedActiveTabKey}
        ariaLabel={t('chat.workspaceDrawerTitle')}
        className='chat-workspace-drawer__dock-workspace'
        closable
        closeLabel={() => t('common.close')}
        createMenuItems={createMenuItems}
        createMenuLabel={t('chat.interactionPanel.addTab')}
        createMenuSelectedKeys={createMenuSelectedKeys}
        defaultContent={
          <InteractionPanelEmptyState
            canCreateSessionTab={sessionId != null && sessionId !== ''}
            onNewMobileDebugPage={handleNewMobileDebugPageAction}
            onNewSession={handleNewSessionAction}
            onNewTerminal={handleNewTerminalAction}
            onNewWebPage={handleNewWebPageAction}
            onOpenResource={handleOpenResourceAction}
            openResourceShortcutLabel={openResourceShortcutLabel}
          />
        }
        getHeaderActions={getHeaderActions}
        getTabContextMenuItems={getTabContextMenuItems}
        labelMode='responsive'
        layout={panelState.right.layout as RouteContainerPanelDockLayout | undefined}
        minOpenTabs={0}
        openedTabs={openedTabKeys}
        panelChromeActions={panelChromeActions}
        panelKey='chat-workspace-drawer'
        tabs={dockTabs}
        onCreateMenuClick={handleCreateMenuClick}
        onCreateMenuOpenChange={(open) => {
          if (open) void refreshDeviceOptions()
        }}
        onLayoutChange={handleRightDockLayoutChange}
        onTabChange={handleDockTabChange}
      />
    )

  return (
    <>
      <aside
        ref={drawerRef}
        className={[
          'chat-workspace-drawer',
          shouldUseMobileTabSwitcher ? 'chat-workspace-drawer--mobile-tabs' : ''
        ].filter(Boolean).join(' ')}
        aria-label={t('chat.workspaceDrawerTitle')}
        onScroll={handleDrawerScroll}
      >
        {mobileDrawerContent}
      </aside>
      <InteractionPanelPinnedTabEditModal
        pinnedTab={editingPinnedTab}
        onClose={() => setEditingPinnedTab(null)}
        onSave={(edits) => {
          if (editingPinnedTab != null) {
            drawerPinnedTabs.updatePinnedTab(editingPinnedTab.tab, edits)
          }
          setEditingPinnedTab(null)
        }}
      />
    </>
  )
}
