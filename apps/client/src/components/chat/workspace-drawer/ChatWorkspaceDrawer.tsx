/* eslint-disable max-lines -- workspace drawer coordinates built-in views, plugin tabs, dock state, and tree commands together. */

import '../interaction-panel/ChatInteractionPanel.scss'
import './ChatWorkspaceDrawer.scss'

import type { MenuProps } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'

import type { GitRepositoryState } from '@oneworks/types'

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
import type {
  RouteContainerPanelDockActionItem,
  RouteContainerPanelDockChromeActionsConfig,
  RouteContainerPanelDockHeaderActionContext,
  RouteContainerPanelDockTabItem
} from '#~/components/layout/RouteContainerPanelTabs'
import { RouteContainerPanelDockWorkspace } from '#~/components/layout/RouteContainerPanelTabs'
import type { ContextPickerFile } from '#~/components/workspace/context-file-types'
import { PluginViewHost } from '#~/plugins/PluginHost'
import type { PluginContributionWorkbenchAddMenuItem, PluginContributionWorkbenchTab } from '#~/plugins/plugin-manifest'
import { usePluginCommandExecutor, usePluginSlot } from '#~/plugins/plugin-slots'

import { InteractionPanelIframeView } from '../interaction-panel/InteractionPanelIframeView'
import { InteractionPanelMobileDebugView } from '../interaction-panel/InteractionPanelMobileDebugView'
import { InteractionPanelSessionView } from '../interaction-panel/InteractionPanelSessionView'
import {
  areInteractionPanelPluginPagesEqual,
  createInteractionPanelPluginPage,
  normalizeInteractionPanelPluginPages,
  resolveInteractionPanelPluginTabDefinition
} from '../interaction-panel/interaction-panel-plugin-pages'
import type { InteractionPanelPluginPage } from '../interaction-panel/interaction-panel-plugin-pages'
import {
  INTERACTION_PANEL_MOBILE_DEBUG_CONFIG_KEY,
  INTERACTION_PANEL_MOBILE_DEBUG_NO_DEVICES_KEY,
  parseInteractionPanelMobileDebugDeviceMenuKey,
  parseInteractionPanelPluginAddMenuKey
} from '../interaction-panel/interaction-panel-tab-menu'
import { useInteractionPanelIframePages } from '../interaction-panel/use-interaction-panel-iframe-pages'
import { useInteractionPanelMobileDebugDeviceOptions } from '../interaction-panel/use-interaction-panel-mobile-debug-device-options'
import { useInteractionPanelMobileDebugPages } from '../interaction-panel/use-interaction-panel-mobile-debug-pages'
import { useInteractionPanelSessionPages } from '../interaction-panel/use-interaction-panel-session-pages'
import type { InteractionTerminalPanesController } from '../interaction-panel/use-interaction-terminal-panes'
import { WorkspaceDrawerViewPanel } from './WorkspaceDrawerViewPanel'
import { useWorkspaceDrawerDockActions } from './use-workspace-drawer-dock-actions'
import type { WorkspaceDrawerView } from './workspace-drawer-types'
import { buildWorkspaceDrawerViewItems, getPluginWorkspaceDrawerViews } from './workspace-drawer-view-items'

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

const uniqueWorkspaceDrawerViews = (values: readonly WorkspaceDrawerView[]) => {
  const seen = new Set<WorkspaceDrawerView>()
  const result: WorkspaceDrawerView[] = []

  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }

  return result
}

const haveSameWorkspaceDrawerViews = (
  left: readonly WorkspaceDrawerView[],
  right: readonly WorkspaceDrawerView[]
) => left.length === right.length && left.every((value, index) => value === right[index])

const WORKSPACE_DRAWER_IFRAME_TAB_PREFIX = 'workspace-drawer:iframe:'
const WORKSPACE_DRAWER_MOBILE_DEBUG_TAB_PREFIX = 'workspace-drawer:mobile-debug:'
const WORKSPACE_DRAWER_PLUGIN_TAB_PREFIX = 'workspace-drawer:plugin:'
const WORKSPACE_DRAWER_SESSION_TAB_PREFIX = 'workspace-drawer:session:'
const WORKSPACE_DRAWER_TERMINAL_TAB_PREFIX = 'workspace-drawer:terminal:'

type WorkspaceDrawerDockTabKey =
  | WorkspaceDrawerView
  | `${typeof WORKSPACE_DRAWER_IFRAME_TAB_PREFIX}${string}`
  | `${typeof WORKSPACE_DRAWER_MOBILE_DEBUG_TAB_PREFIX}${string}`
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

const isWorkspaceDrawerHostedTabKey = (key: WorkspaceDrawerDockTabKey) =>
  key.startsWith(WORKSPACE_DRAWER_IFRAME_TAB_PREFIX) ||
  key.startsWith(WORKSPACE_DRAWER_MOBILE_DEBUG_TAB_PREFIX) ||
  key.startsWith(WORKSPACE_DRAWER_PLUGIN_TAB_PREFIX) ||
  key.startsWith(WORKSPACE_DRAWER_SESSION_TAB_PREFIX) ||
  key.startsWith(WORKSPACE_DRAWER_TERMINAL_TAB_PREFIX)

export function ChatWorkspaceDrawer({
  agentApprovals,
  agentRoster,
  defaultView = 'tree',
  isFullscreen = false,
  locateFileRequest,
  onClose,
  onFullscreenChange,
  onOpenFile,
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
  isFullscreen?: boolean
  locateFileRequest?: ChatWorkspaceDrawerLocateFileRequest | null
  onClose?: () => void
  onFullscreenChange?: (fullscreen: boolean) => void
  onOpenFile?: (path: string) => void
  onReferencePaths?: (files: ContextPickerFile[]) => void
  selectedFilePath?: string | null
  settingsView?: ReactNode
  sessionId?: string
  terminalSessionId: string
  terminalPanes: InteractionTerminalPanesController
}) {
  const { i18n, t } = useTranslation()
  const navigate = useNavigate()
  const hasApprovalsTab = agentApprovals != null
  const hasAgentsTab = agentRoster != null
  const hasSettingsTab = settingsView != null
  const pluginTabs = usePluginSlot<PluginContributionWorkbenchTab>('workbench.tabs')
  const pluginAddMenuItems = usePluginSlot<PluginContributionWorkbenchAddMenuItem>('workbench.addMenu')
  const executePluginCommand = usePluginCommandExecutor()
  const pluginLanguage = i18n.resolvedLanguage ?? i18n.language
  const pluginDrawerViews = useMemo(() => getPluginWorkspaceDrawerViews(pluginTabs), [pluginTabs])
  const isPluginDrawerViewUnavailable = useCallback((view: WorkspaceDrawerView) => (
    view.startsWith('plugin:') && !pluginDrawerViews.has(view as `plugin:${string}:${string}`)
  ), [pluginDrawerViews])
  const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac')
  const workspaceDrawerStorageKey = `chat-workspace-drawer:${sessionId ?? 'workspace'}`
  const workspaceDrawerSessionPagesId = `${workspaceDrawerStorageKey}:sessions`
  const workspaceDrawerIframeSessionId = `${workspaceDrawerStorageKey}:iframes`
  const iframePageState = useInteractionPanelIframePages({ terminalSessionId: workspaceDrawerIframeSessionId, t })
  const mobileDebugPageState = useInteractionPanelMobileDebugPages()
  const sessionPageState = useInteractionPanelSessionPages(workspaceDrawerSessionPagesId)
  const [pluginPages, setPluginPages] = useState<InteractionPanelPluginPage[]>([])
  const mobileDebugPage = mobileDebugPageState.mobileDebugPages[0]
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
  const preferredDefaultView: WorkspaceDrawerView = defaultView === 'approvals' && !hasPendingApprovals && hasAgentsTab
    ? 'agents'
    : defaultView
  const fallbackView: WorkspaceDrawerView = hasAgentsTab ? 'agents' : 'tree'
  const isDefaultViewUnavailable = (preferredDefaultView === 'agents' && !hasAgentsTab) ||
    (preferredDefaultView === 'approvals' && !hasApprovalsTab) ||
    (preferredDefaultView === 'settings' && !hasSettingsTab) ||
    isPluginDrawerViewUnavailable(preferredDefaultView)
  const initialView = isDefaultViewUnavailable ? fallbackView : preferredDefaultView
  const [activeView, setActiveView] = useState<WorkspaceDrawerView>(() => initialView)
  const [openedViews, setOpenedViews] = useState<WorkspaceDrawerView[]>(() => [initialView])
  const [activeTabKey, setActiveTabKey] = useState<WorkspaceDrawerDockTabKey>(() => initialView)
  const isActiveViewUnavailable = (activeView === 'agents' && !hasAgentsTab) ||
    (activeView === 'approvals' && !hasApprovalsTab) ||
    (activeView === 'settings' && !hasSettingsTab) ||
    isPluginDrawerViewUnavailable(activeView)
  const openDrawerView = useCallback((view: WorkspaceDrawerView) => {
    if (!availableViewSet.has(view)) return

    setActiveView(view)
    setActiveTabKey(view)
    setOpenedViews(prev => uniqueWorkspaceDrawerViews([...prev, view]))
  }, [availableViewSet])

  const workspaceDrawerDockActions = useWorkspaceDrawerDockActions({
    includeCloseAction: false,
    onActivateView: openDrawerView,
    onClose,
    onForceSync: mutateGitState,
    selectedFilePath,
    t
  })
  const { handleWorkspaceTreeCommand } = workspaceDrawerDockActions
  const panelChromeActions = useMemo<RouteContainerPanelDockChromeActionsConfig>(() => ({
    ...(onClose == null
      ? {}
      : {
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
  }), [isFullscreen, onClose, onFullscreenChange, t])

  useEffect(() => {
    if (isActiveViewUnavailable) {
      setActiveView(fallbackView)
      setActiveTabKey(fallbackView)
      setOpenedViews(prev => uniqueWorkspaceDrawerViews([...prev, fallbackView]))
    }
  }, [fallbackView, isActiveViewUnavailable])

  useEffect(() => {
    if (!isDefaultViewUnavailable) {
      setActiveView(preferredDefaultView)
      setActiveTabKey(current => isWorkspaceDrawerHostedTabKey(current) ? current : preferredDefaultView)
      setOpenedViews(prev => uniqueWorkspaceDrawerViews([...prev, preferredDefaultView]))
    }
  }, [isDefaultViewUnavailable, preferredDefaultView])

  useEffect(() => setTreeActivePath(selectedFilePath ?? null), [selectedFilePath])

  useEffect(() => {
    setPluginPages(current => {
      const nextPages = normalizeInteractionPanelPluginPages(current, pluginTabs, pluginLanguage)
      return areInteractionPanelPluginPagesEqual(current, nextPages) ? current : nextPages
    })
  }, [pluginLanguage, pluginTabs])

  useEffect(() => {
    const path = locateFileRequest?.path.trim()
    if (locateFileRequest == null || path == null || path === '') return

    setTreeActivePath(path)
    handleWorkspaceTreeCommand('locate', path)
  }, [handleWorkspaceTreeCommand, locateFileRequest])

  const resolvedActiveView = isActiveViewUnavailable ? fallbackView : activeView
  const normalizedOpenedViews = useMemo(() => {
    const nextOpenedViews = uniqueWorkspaceDrawerViews(
      [resolvedActiveView, ...openedViews].filter(view => availableViewSet.has(view))
    )

    return nextOpenedViews.length === 0 ? [fallbackView] : nextOpenedViews
  }, [availableViewSet, fallbackView, openedViews, resolvedActiveView])

  useEffect(() => {
    setOpenedViews(prev => {
      const nextOpenedViews = uniqueWorkspaceDrawerViews(
        [resolvedActiveView, ...prev].filter(view => availableViewSet.has(view))
      )

      return haveSameWorkspaceDrawerViews(prev, nextOpenedViews) ? prev : nextOpenedViews
    })
  }, [availableViewSet, resolvedActiveView])

  const drawerTerminalPanes = useMemo(
    () => terminalPanes.panes.filter(pane => isTerminalPaneOnSurface(pane, 'workspace-drawer')),
    [terminalPanes.panes]
  )
  const terminalTabKeys = useMemo(
    () => drawerTerminalPanes.map(pane => toWorkspaceDrawerTerminalTabKey(pane.id)),
    [drawerTerminalPanes]
  )
  const iframeTabKeys = useMemo(
    () => iframePageState.iframePages.map(page => toWorkspaceDrawerIframeTabKey(page.id)),
    [iframePageState.iframePages]
  )
  const mobileDebugTabKeys = useMemo(
    () => mobileDebugPageState.mobileDebugPages.map(page => toWorkspaceDrawerMobileDebugTabKey(page.id)),
    [mobileDebugPageState.mobileDebugPages]
  )
  const pluginTabKeys = useMemo(
    () => pluginPages.map(page => toWorkspaceDrawerPluginTabKey(page.id)),
    [pluginPages]
  )
  const sessionTabKeys = useMemo(
    () => sessionPageState.sessionPages.map(page => toWorkspaceDrawerSessionTabKey(page.id)),
    [sessionPageState.sessionPages]
  )
  const openedTabKeys = useMemo(
    () =>
      uniqueWorkspaceDrawerDockTabKeys([
        ...normalizedOpenedViews,
        ...terminalTabKeys,
        ...iframeTabKeys,
        ...mobileDebugTabKeys,
        ...pluginTabKeys,
        ...sessionTabKeys
      ]),
    [iframeTabKeys, mobileDebugTabKeys, normalizedOpenedViews, pluginTabKeys, sessionTabKeys, terminalTabKeys]
  )
  const resolvedActiveTabKey = openedTabKeys.includes(activeTabKey) ? activeTabKey : resolvedActiveView

  useEffect(() => {
    if (openedTabKeys.includes(activeTabKey)) return
    setActiveTabKey(resolvedActiveView)
  }, [activeTabKey, openedTabKeys, resolvedActiveView])

  const handleDockTabChange = useCallback((
    nextTabKey: WorkspaceDrawerDockTabKey | null,
    nextOpenedTabKeys: WorkspaceDrawerDockTabKey[]
  ) => {
    if (nextTabKey != null) {
      setActiveTabKey(nextTabKey)
      if (isWorkspaceDrawerViewTabKey(nextTabKey, availableViewSet)) {
        setActiveView(nextTabKey)
      }
    }

    const nextOpenedViews = nextOpenedTabKeys
      .filter((key): key is WorkspaceDrawerView => isWorkspaceDrawerViewTabKey(key, availableViewSet))
    setOpenedViews(nextOpenedViews)

    const nextOpenedTabKeySet = new Set<WorkspaceDrawerDockTabKey>(nextOpenedTabKeys)
    const closedTerminalIds = drawerTerminalPanes
      .filter(pane => !nextOpenedTabKeySet.has(toWorkspaceDrawerTerminalTabKey(pane.id)))
      .map(pane => pane.id)
    if (closedTerminalIds.length > 0) {
      terminalPanes.closeTerminals(closedTerminalIds)
    }

    const closedIframeIds = iframePageState.iframePages
      .filter(page => !nextOpenedTabKeySet.has(toWorkspaceDrawerIframeTabKey(page.id)))
      .map(page => page.id)
    if (closedIframeIds.length > 0) {
      iframePageState.closeIframePages(new Set(closedIframeIds))
    }

    const closedMobileDebugIds = mobileDebugPageState.mobileDebugPages
      .filter(page => !nextOpenedTabKeySet.has(toWorkspaceDrawerMobileDebugTabKey(page.id)))
      .map(page => page.id)
    if (closedMobileDebugIds.length > 0) {
      mobileDebugPageState.closeMobileDebugPages(new Set(closedMobileDebugIds))
    }

    const closedSessionPageIds = sessionPageState.sessionPages
      .filter(page => !nextOpenedTabKeySet.has(toWorkspaceDrawerSessionTabKey(page.id)))
      .map(page => page.id)
    if (closedSessionPageIds.length > 0) {
      sessionPageState.closeSessionPages(new Set(closedSessionPageIds))
    }

    const nextOpenedPluginIds = new Set(
      nextOpenedTabKeys.flatMap(key => {
        const id = decodeWorkspaceDrawerHostedTabId(key, WORKSPACE_DRAWER_PLUGIN_TAB_PREFIX)
        return id == null ? [] : [id]
      })
    )
    setPluginPages(current => {
      const nextPages = current.filter(page => nextOpenedPluginIds.has(page.id))
      return nextPages.length === current.length ? current : nextPages
    })
  }, [availableViewSet, drawerTerminalPanes, iframePageState, mobileDebugPageState, sessionPageState, terminalPanes])

  const createMenuItems = useMemo<MenuProps['items']>(() =>
    buildWorkbenchCreateMenuItems(t, isMac, {
      canCreateSessionTab: sessionId != null && sessionId !== '',
      language: pluginLanguage,
      mobileDebugDevices: deviceOptions,
      pluginMenuItems: pluginAddMenuItems,
      selectedMobileDebugDeviceId: mobileDebugPage?.selectedDeviceId,
      workspaceDrawerItems: viewItems
    }), [
    deviceOptions,
    isMac,
    mobileDebugPage?.selectedDeviceId,
    pluginAddMenuItems,
    pluginLanguage,
    sessionId,
    t,
    viewItems
  ])
  const createMenuSelectedKeys = useMemo(
    () => normalizedOpenedViews.map(toWorkbenchDrawerViewMenuKey),
    [normalizedOpenedViews]
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
        setPluginPages(current => [...current, nextPage])
        setActiveTabKey(toWorkspaceDrawerPluginTabKey(nextPage.id))
        return
      }

      void navigate(`/plugins/${item.pluginScope}/${item.id}`)
      return
    }

    if (key === 'resource') {
      openDrawerView('tree')
      return
    }

    if (key === 'terminal') {
      const pane = terminalPanes.addTerminal('default', { surface: 'workspace-drawer' })
      setActiveTabKey(toWorkspaceDrawerTerminalTabKey(pane.id))
      return
    }

    if (key === 'iframe') {
      const page = iframePageState.addIframePage()
      setActiveTabKey(toWorkspaceDrawerIframeTabKey(page.id))
      return
    }

    if (key === 'session') {
      if (sessionId == null || sessionId === '') return
      const page = sessionPageState.addSessionPage(
        t('chat.interactionPanel.sessionTitle', { index: sessionPageState.sessionPages.length + 1 })
      )
      setActiveTabKey(toWorkspaceDrawerSessionTabKey(page.id))
      return
    }

    if (
      key === 'mobile-debug' ||
      key === INTERACTION_PANEL_MOBILE_DEBUG_CONFIG_KEY ||
      key === INTERACTION_PANEL_MOBILE_DEBUG_NO_DEVICES_KEY
    ) {
      const page = mobileDebugPageState.addMobileDebugPage(t('chat.interactionPanel.mobileDebugTitle'), {
        mode: 'config',
        selectedDeviceId: undefined,
        selectedDeviceLabel: t('chat.interactionPanel.mobileDebugConfig')
      })
      setActiveTabKey(toWorkspaceDrawerMobileDebugTabKey(page.id))
      return
    }

    const mobileDebugDevice = parseInteractionPanelMobileDebugDeviceMenuKey(key)
    if (mobileDebugDevice != null) {
      const device = deviceOptions.find(option => option.id === mobileDebugDevice.id)
      const page = mobileDebugPageState.addMobileDebugPage(t('chat.interactionPanel.mobileDebugTitle'), {
        mode: 'targets',
        selectedDeviceId: mobileDebugDevice.id,
        selectedDeviceLabel: device?.label ?? mobileDebugDevice.label ?? mobileDebugDevice.id
      })
      setActiveTabKey(toWorkspaceDrawerMobileDebugTabKey(page.id))
    }
  }, [
    deviceOptions,
    executePluginCommand,
    iframePageState,
    mobileDebugPageState,
    navigate,
    openDrawerView,
    pluginAddMenuItems,
    pluginTabs,
    sessionId,
    sessionPageState,
    t,
    terminalPanes
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
    const drawerTabs: Array<RouteContainerPanelDockTabItem<WorkspaceDrawerDockTabKey>> = viewItems.map(item => ({
      activeIcon: item.icon,
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
      icon: item.icon,
      key: item.key,
      label: item.label,
      title: item.label
    }))
    const terminalTabs: Array<RouteContainerPanelDockTabItem<WorkspaceDrawerDockTabKey>> = drawerTerminalPanes.map(
      pane => {
        const tabKey = toWorkspaceDrawerTerminalTabKey(pane.id)
        const icon = pane.runCommand?.icon ?? (
          terminalPanes.infoById[pane.id]?.isExited === true ? 'terminal_off' : 'terminal'
        )

        return {
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
          icon,
          key: tabKey,
          label: pane.title,
          title: pane.title
        }
      }
    )
    const sessionTabs: Array<RouteContainerPanelDockTabItem<WorkspaceDrawerDockTabKey>> = sessionPageState.sessionPages
      .map(page => {
        const tabKey = toWorkspaceDrawerSessionTabKey(page.id)

        return {
          content: ({ isVisible }) => (
            <div className={`chat-interaction-panel__dock-panel-content ${isVisible ? 'is-visible' : 'is-hidden'}`}>
              <InteractionPanelSessionView
                autoFocusRequestId={isVisible ? page.focusRequestId : undefined}
                page={page}
                sourceSessionId={sessionId}
                onChangePage={updater => sessionPageState.updateSessionPage(page.id, updater)}
              />
            </div>
          ),
          icon: 'chat',
          key: tabKey,
          label: page.title,
          title: page.title
        }
      })
    const mobileDebugTabs: Array<RouteContainerPanelDockTabItem<WorkspaceDrawerDockTabKey>> = mobileDebugPageState
      .mobileDebugPages.map(page => {
        const tabKey = toWorkspaceDrawerMobileDebugTabKey(page.id)

        return {
          content: ({ isVisible }) => (
            <div className={`chat-interaction-panel__dock-panel-content ${isVisible ? 'is-visible' : 'is-hidden'}`}>
              <InteractionPanelMobileDebugView
                isActive={isVisible && resolvedActiveTabKey === tabKey}
                page={page}
                onChangePage={updater => mobileDebugPageState.updateMobileDebugPage(page.id, updater)}
                onOpenDebugUrl={(url, options) => {
                  const iframePage = iframePageState.openIframeUrl(url, options)
                  setActiveTabKey(toWorkspaceDrawerIframeTabKey(iframePage.id))
                }}
              />
            </div>
          ),
          icon: 'phonelink_setup',
          key: tabKey,
          label: page.selectedDeviceLabel == null || page.selectedDeviceLabel === ''
            ? page.title
            : `${page.title} · ${page.selectedDeviceLabel}`,
          title: page.title
        }
      })
    const pluginDockTabs: Array<RouteContainerPanelDockTabItem<WorkspaceDrawerDockTabKey>> = pluginPages.map(page => ({
      content: ({ isVisible }) => (
        <div className={`chat-interaction-panel__dock-panel-content ${isVisible ? 'is-visible' : 'is-hidden'}`}>
          <PluginViewHost
            routeId='chat-workspace-drawer'
            scope={page.pluginScope}
            surface='drawer'
            viewId={page.viewId}
          />
        </div>
      ),
      icon: page.icon,
      key: toWorkspaceDrawerPluginTabKey(page.id),
      label: page.title,
      title: page.title
    }))
    const iframeTabs: Array<RouteContainerPanelDockTabItem<WorkspaceDrawerDockTabKey>> = iframePageState.iframePages
      .map(
        page => {
          const tabKey = toWorkspaceDrawerIframeTabKey(page.id)

          return {
            content: ({ isVisible }) => (
              <div className={`chat-interaction-panel__dock-panel-content ${isVisible ? 'is-visible' : 'is-hidden'}`}>
                <InteractionPanelIframeView
                  isActive={isVisible && resolvedActiveTabKey === tabKey}
                  page={page}
                  projectUrlHistoryKey={`${workspaceDrawerIframeSessionId}:project`}
                  sessionUrlHistoryKey={`${workspaceDrawerIframeSessionId}:session`}
                  onChangeMetadata={iframePageState.handleIframeMetadataChange}
                  onSelectHistory={iframePageState.handleIframeSelectHistory}
                  onChangeUrl={iframePageState.handleIframeUrlChange}
                  onNavigateHistory={iframePageState.handleIframeNavigateHistory}
                />
              </div>
            ),
            icon: 'language',
            iconNode: page.faviconUrl == null || page.faviconUrl === ''
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
            label: page.title,
            title: page.title
          }
        }
      )

    return [
      ...drawerTabs,
      ...terminalTabs,
      ...sessionTabs,
      ...mobileDebugTabs,
      ...pluginDockTabs,
      ...iframeTabs
    ]
  }, [
    agentApprovals,
    agentRoster,
    approvalMessages,
    drawerTerminalPanes,
    iframePageState,
    isGitLoading,
    mobileDebugPageState,
    onOpenFile,
    onReferencePaths,
    pluginPages,
    pluginTabs,
    repoState,
    resolvedActiveTabKey,
    selectedFilePath,
    sessionId,
    sessionPageState,
    settingsView,
    terminalPanes,
    terminalSessionId,
    treeActivePath,
    viewItems,
    workspaceDrawerIframeSessionId,
    workspaceDrawerDockActions.changedLayout,
    workspaceDrawerDockActions.changedTreeCommand,
    workspaceDrawerDockActions.treeRefreshKey,
    workspaceDrawerDockActions.workspaceTreeCommand
  ])

  return (
    <aside className='chat-workspace-drawer' aria-label={t('chat.workspaceDrawerTitle')}>
      <RouteContainerPanelDockWorkspace
        activeTab={resolvedActiveTabKey}
        ariaLabel={t('chat.workspaceDrawerTitle')}
        className='chat-workspace-drawer__dock-workspace'
        closable
        closeLabel={() => t('common.close')}
        createMenuItems={createMenuItems}
        createMenuLabel={t('chat.interactionPanel.addTab')}
        createMenuSelectedKeys={createMenuSelectedKeys}
        getHeaderActions={getHeaderActions}
        labelMode='icon-only'
        minOpenTabs={1}
        openedTabs={openedTabKeys}
        panelChromeActions={panelChromeActions}
        panelKey='chat-workspace-drawer'
        storageKey={workspaceDrawerStorageKey}
        tabs={dockTabs}
        onCreateMenuClick={handleCreateMenuClick}
        onCreateMenuOpenChange={(open) => {
          if (open) void refreshDeviceOptions()
        }}
        onTabChange={handleDockTabChange}
      />
    </aside>
  )
}
