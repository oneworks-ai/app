/* eslint-disable max-lines -- route shell wires chat chrome, workspace drawer, and bottom dock layout. */
import './ChatRoute.scss'

import type { MenuProps } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'

import type { ChatMessage, Session } from '@oneworks/core'
import type { SessionInfo } from '@oneworks/types'

import { ChatHeader } from '#~/components/chat/ChatHeader.js'
import type {
  ChatHeaderBreadcrumb,
  ChatHeaderModeSwitch,
  ChatHeaderMoreItems,
  ChatHeaderRoomIconStatus,
  ChatHeaderView
} from '#~/components/chat/ChatHeader.js'
import type {
  InteractionPanelRunCommand,
  InteractionPanelRunCommandTaskStatus
} from '#~/components/chat/interaction-panel/interaction-panel-run-commands'
import {
  readPendingInteractionPanelShortcutRequest,
  writePendingInteractionPanelShortcutRequest
} from '#~/components/chat/interaction-panel/interaction-panel-shortcut-request'
import type { InteractionPanelShortcutRequest } from '#~/components/chat/interaction-panel/interaction-panel-shortcut-request'
import { useInteractionTerminalPanes } from '#~/components/chat/interaction-panel/use-interaction-terminal-panes'
import { parseWorkbenchDrawerViewMenuKey, toWorkbenchDrawerViewMenuKey } from '#~/components/chat/workbench-create-menu'
import type {
  ChatWorkspaceDrawerAgentApprovals,
  ChatWorkspaceDrawerAgentRoster,
  ChatWorkspaceDrawerLocateFileRequest
} from '#~/components/chat/workspace-drawer/ChatWorkspaceDrawer'
import { ChatWorkspaceDrawer } from '#~/components/chat/workspace-drawer/ChatWorkspaceDrawer'
import type { WorkspaceDrawerView } from '#~/components/chat/workspace-drawer/workspace-drawer-types'
import { buildWorkspaceDrawerViewItems } from '#~/components/chat/workspace-drawer/workspace-drawer-view-items'
import { RouteContainerLayout } from '#~/components/layout/RouteContainerLayout'
import { useDesktopWorkspaceStartupReady } from '#~/components/layout/desktop-workspace-startup-ready'
import { useRouteContainerSidebarOpener } from '#~/components/layout/use-route-container-sidebar-opener'
import type { ContextPickerFile } from '#~/components/workspace/context-file-types'
import { addDesktopViewShortcutListener } from '#~/desktop/view-shortcuts'
import type { SessionCompactionInfo } from '#~/hooks/chat/session-compaction'
import { useChatRouteBottomPanel } from '#~/hooks/chat/use-chat-route-bottom-panel'
import { useTerminalDockVisibility } from '#~/hooks/chat/use-terminal-dock-visibility'
import { useChatLayoutQueryState } from '#~/hooks/use-chat-layout-query-state'
import type { PluginContributionWorkbenchTab } from '#~/plugins/plugin-manifest'
import { usePluginSlot } from '#~/plugins/plugin-slots'
import { useInstallRoutePluginMoreMenu, useInstallRoutePluginWindowBarActions } from '#~/plugins/route-plugin-chrome'

import { ChatRouteBottomPanel } from './ChatRouteBottomPanel'

const WORKSPACE_TERMINAL_SESSION_ID = '__workspace__'
const CHAT_ROUTE_STARTUP_READY_SELECTOR = [
  '.chat-container.ready .chat-input-monaco[data-oneworks-sender-editor-ready="true"]',
  '.chat-container.ready .chat-messages.ready',
  '.chat-container.ready .chat-settings-panel',
  '.chat-container.ready .chat-timeline-view'
].join(',')
const launcherResourceKinds = new Set<DesktopWorkspaceResourceTarget['kind']>([
  'directory',
  'file',
  'new-session',
  'new-terminal',
  'new-website',
  'session',
  'terminal',
  'website'
])

type ChatRouteHistoryView =
  | ReactNode
  | ((controls: {
    onOpenUrlInAppBrowser: (url: string, title?: string) => void
    onOpenWorkspaceFile: (path: string) => void
    workspaceRootPath?: string
  }) => ReactNode)
type WorkspaceDrawerLocateRequest = ChatWorkspaceDrawerLocateFileRequest | null
type InteractionPanelShortcutAction = InteractionPanelShortcutRequest['action']

let nextInteractionPanelShortcutRequestId = Date.now()
let pendingInteractionPanelShortcutRequest: InteractionPanelShortcutRequest | null = null

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeLauncherResourceTarget = (value: unknown): DesktopWorkspaceResourceTarget | null => {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return null
  }
  const kind = value.kind as DesktopWorkspaceResourceTarget['kind']
  if (!launcherResourceKinds.has(kind)) {
    return null
  }

  return {
    kind,
    ...(typeof value.path === 'string' ? { path: value.path } : {}),
    ...(typeof value.sessionId === 'string' ? { sessionId: value.sessionId } : {}),
    ...(typeof value.terminalId === 'string' ? { terminalId: value.terminalId } : {}),
    ...(typeof value.title === 'string' ? { title: value.title } : {}),
    ...(typeof value.url === 'string' ? { url: value.url } : {})
  }
}

export function ChatRouteShell({
  activeView,
  agentApprovals,
  agentRoster,
  displayTitle,
  debugSessionLogPath,
  enableTimelineView,
  headerActionsOverride,
  headerBreadcrumb,
  headerMoreItems,
  historyTimelineHidden,
  historyView,
  isNewSession = false,
  isReady = true,
  isTerminalPanelFolded,
  isTerminalOpen,
  messages,
  modeSwitch,
  onReferenceWorkspacePaths,
  projectWorkspaceFolder,
  roomIconSeed,
  roomIconStatus,
  session,
  sessionCompactionInfo,
  sessionInfo,
  settingsView,
  setActiveView,
  setIsTerminalPanelFolded,
  setIsTerminalOpen,
  showViewSwitches,
  timelineView,
  onHistoryTimelineHiddenChange,
  workspaceDrawerDefaultView,
  workspaceSession,
  workspaceSessionId
}: {
  activeView: ChatHeaderView
  agentApprovals?: ChatWorkspaceDrawerAgentApprovals
  agentRoster?: ChatWorkspaceDrawerAgentRoster
  displayTitle?: string
  debugSessionLogPath?: string
  enableTimelineView?: boolean
  headerActionsOverride?: ReactNode
  headerBreadcrumb?: ChatHeaderBreadcrumb
  headerMoreItems?: ChatHeaderMoreItems
  historyTimelineHidden?: boolean
  historyView: ChatRouteHistoryView
  isNewSession?: boolean
  isReady?: boolean
  isTerminalPanelFolded: boolean
  isTerminalOpen: boolean
  messages?: ChatMessage[]
  modeSwitch?: ChatHeaderModeSwitch
  onReferenceWorkspacePaths?: (files: ContextPickerFile[]) => void
  projectWorkspaceFolder?: string
  roomIconSeed?: string
  roomIconStatus?: ChatHeaderRoomIconStatus
  session?: Session
  sessionCompactionInfo?: SessionCompactionInfo | null
  sessionInfo: SessionInfo | null
  settingsView?: ReactNode
  setActiveView: (view: ChatHeaderView) => void
  setIsTerminalPanelFolded: (isFolded: boolean) => void
  setIsTerminalOpen: (isOpen: boolean) => void
  showViewSwitches?: boolean
  timelineView?: ReactNode
  onHistoryTimelineHiddenChange?: (hidden: boolean) => void
  workspaceDrawerDefaultView?: WorkspaceDrawerView
  workspaceSession?: Session
  workspaceSessionId?: string
}) {
  const { i18n, t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { openRouteSidebar } = useRouteContainerSidebarOpener()
  const {
    isWorkspaceDrawerFullscreen,
    isWorkspaceDrawerOpen,
    setWorkspaceDrawerFullscreen,
    setWorkspaceDrawerOpen,
    workspaceDrawerView
  } = useChatLayoutQueryState()
  const pluginWorkbenchTabs = usePluginSlot<PluginContributionWorkbenchTab>('workbench.tabs')
  useInstallRoutePluginMoreMenu('chat')
  useInstallRoutePluginWindowBarActions('chat')
  const [workspaceDrawerLocateRequest, setWorkspaceDrawerLocateRequest] = useState<WorkspaceDrawerLocateRequest>(null)
  const handledLauncherRequestIdRef = useRef<string | null>(null)
  const pendingInteractionPanelShortcutClearIdRef = useRef<number | null>(null)
  const [interactionPanelShortcutRequest, setInteractionPanelShortcutRequest] = useState<
    InteractionPanelShortcutRequest | null
  >(null)
  const [runCommandTaskStatuses, setRunCommandTaskStatuses] = useState<InteractionPanelRunCommandTaskStatus[]>([])
  const resolvedWorkspaceSession = workspaceSession ?? session
  const resolvedWorkspaceSessionId = workspaceSessionId ?? resolvedWorkspaceSession?.id
  const sessionWorkspaceRootPath = sessionInfo?.type === 'init' ? sessionInfo.cwd.trim() : ''
  const workspaceRootPath = sessionWorkspaceRootPath === '' ? projectWorkspaceFolder : sessionWorkspaceRootPath
  const terminalSessionId = resolvedWorkspaceSessionId ?? WORKSPACE_TERMINAL_SESSION_ID
  const terminalPanes = useInteractionTerminalPanes(terminalSessionId, t)
  const bottomPanel = useChatRouteBottomPanel({
    isTerminalOpen,
    session: resolvedWorkspaceSession,
    setIsTerminalOpen
  })
  const recentFilePaths = bottomPanel.selectedWorkspaceFilePath == null
    ? bottomPanel.openWorkspaceFilePaths
    : [
      bottomPanel.selectedWorkspaceFilePath,
      ...bottomPanel.openWorkspaceFilePaths.filter(path => path !== bottomPanel.selectedWorkspaceFilePath)
    ]
  const workspaceDrawerCreateItems = useMemo(() =>
    buildWorkspaceDrawerViewItems({
      agentRosterCount: agentRoster?.members.length,
      hasAgentsTab: agentRoster != null,
      hasApprovalsTab: agentApprovals != null,
      hasSettingsTab: settingsView != null,
      language: i18n.resolvedLanguage ?? i18n.language,
      pluginTabs: pluginWorkbenchTabs,
      t
    }), [agentApprovals, agentRoster, i18n.language, i18n.resolvedLanguage, pluginWorkbenchTabs, settingsView, t])
  const activeWorkspaceDrawerView = isWorkspaceDrawerOpen
    ? workspaceDrawerView ?? workspaceDrawerDefaultView
    : undefined
  const workspaceDrawerCreateSelectedKeys = useMemo(
    () => activeWorkspaceDrawerView == null ? [] : [toWorkbenchDrawerViewMenuKey(activeWorkspaceDrawerView)],
    [activeWorkspaceDrawerView]
  )
  const shouldShowWorkspaceDrawer = isWorkspaceDrawerOpen
  const { isRendered: isBottomPanelRendered, isVisible: isBottomPanelVisible } = useTerminalDockVisibility(
    bottomPanel.shouldShowBottomPanel
  )
  useDesktopWorkspaceStartupReady(isReady, { visibleSelector: CHAT_ROUTE_STARTUP_READY_SELECTOR })
  const handleOpenSessionLog = () => {
    if (debugSessionLogPath == null) return
    bottomPanel.handleOpenWorkspaceFile(debugSessionLogPath)
    setWorkspaceDrawerOpen(true)
    setWorkspaceDrawerLocateRequest(current => ({ id: (current?.id ?? 0) + 1, path: debugSessionLogPath }))
  }
  const handleLocateWorkspacePath = useCallback((path: string) => {
    const normalizedPath = path.trim()
    if (normalizedPath === '') return

    setWorkspaceDrawerOpen(true)
    setWorkspaceDrawerLocateRequest(current => ({ id: (current?.id ?? 0) + 1, path: normalizedPath }))
  }, [setWorkspaceDrawerOpen])
  const requestInteractionPanelShortcut = useCallback((
    action: InteractionPanelShortcutAction,
    payload: Omit<InteractionPanelShortcutRequest, 'action' | 'id'> = {}
  ) => {
    const request = {
      action,
      id: ++nextInteractionPanelShortcutRequestId,
      ...payload
    } as InteractionPanelShortcutRequest
    pendingInteractionPanelShortcutRequest = request
    writePendingInteractionPanelShortcutRequest(request)
    setInteractionPanelShortcutRequest(request)
  }, [])
  const handleWorkspaceDrawerCreateMenuClick: NonNullable<MenuProps['onClick']> = useCallback((info) => {
    const drawerView = parseWorkbenchDrawerViewMenuKey(String(info.key))
    if (drawerView == null) return

    setWorkspaceDrawerOpen(true, drawerView)
  }, [setWorkspaceDrawerOpen])
  const handleRunCommand = useCallback((command: InteractionPanelRunCommand) => {
    setIsTerminalPanelFolded(false)
    setIsTerminalOpen(true)
    requestInteractionPanelShortcut('run-command', { command })
  }, [requestInteractionPanelShortcut, setIsTerminalOpen, setIsTerminalPanelFolded])
  const handleTerminateRunCommandTask = useCallback((terminalId: string) => {
    requestInteractionPanelShortcut('terminate-run-command-task', { terminalId })
  }, [requestInteractionPanelShortcut])
  const handleOpenUrlInAppBrowser = useCallback((url: string, title?: string) => {
    const normalizedUrl = url.trim()
    if (normalizedUrl === '') return

    const normalizedTitle = title?.trim()
    setIsTerminalPanelFolded(false)
    setIsTerminalOpen(true)
    requestInteractionPanelShortcut('open-website', {
      url: normalizedUrl,
      ...(normalizedTitle != null && normalizedTitle !== '' && normalizedTitle !== normalizedUrl
        ? { title: normalizedTitle }
        : {})
    })
  }, [requestInteractionPanelShortcut, setIsTerminalOpen, setIsTerminalPanelFolded])
  const resolvedHistoryView = typeof historyView === 'function'
    ? historyView({
      onOpenUrlInAppBrowser: handleOpenUrlInAppBrowser,
      onOpenWorkspaceFile: bottomPanel.handleOpenWorkspaceFile,
      workspaceRootPath
    })
    : historyView
  const renderedView = activeView === 'timeline' && enableTimelineView === true
    ? timelineView ?? resolvedHistoryView
    : resolvedHistoryView
  const clearInteractionPanelShortcutRequest = useCallback((id: number) => {
    if (!bottomPanel.shouldShowBottomPanel) {
      pendingInteractionPanelShortcutClearIdRef.current = id
      return
    }

    pendingInteractionPanelShortcutClearIdRef.current = null
    setInteractionPanelShortcutRequest(current => current?.id === id ? null : current)
  }, [bottomPanel.shouldShowBottomPanel])

  useEffect(() => {
    const pendingRequest = pendingInteractionPanelShortcutRequest ?? readPendingInteractionPanelShortcutRequest()
    if (
      interactionPanelShortcutRequest != null ||
      pendingRequest == null
    ) {
      return
    }

    pendingInteractionPanelShortcutRequest = pendingRequest
    setInteractionPanelShortcutRequest(pendingRequest)
  }, [interactionPanelShortcutRequest])

  useEffect(() => {
    if (!bottomPanel.shouldShowBottomPanel) {
      return
    }

    const pendingClearId = pendingInteractionPanelShortcutClearIdRef.current
    if (pendingClearId == null) {
      return
    }

    pendingInteractionPanelShortcutClearIdRef.current = null
    setInteractionPanelShortcutRequest(current => current?.id === pendingClearId ? null : current)
  }, [bottomPanel.shouldShowBottomPanel])

  const handleLauncherResourceTarget = useCallback((target: DesktopWorkspaceResourceTarget) => {
    const targetPath = target.path
    if (target.kind === 'directory' && targetPath != null && targetPath !== '') {
      setWorkspaceDrawerOpen(true, 'tree')
      setWorkspaceDrawerLocateRequest(current => ({ id: (current?.id ?? 0) + 1, path: targetPath }))
      return
    }

    if (target.kind === 'file' && targetPath != null && targetPath !== '') {
      bottomPanel.handleOpenWorkspaceFile(targetPath)
      setIsTerminalPanelFolded(false)
      setIsTerminalOpen(true)
      return
    }

    if (target.kind === 'new-terminal') {
      setIsTerminalPanelFolded(false)
      setIsTerminalOpen(true)
      requestInteractionPanelShortcut('new-terminal')
      return
    }

    if (target.kind === 'terminal' && target.terminalId != null && target.terminalId !== '') {
      setIsTerminalPanelFolded(false)
      setIsTerminalOpen(true)
      requestInteractionPanelShortcut('open-terminal', { terminalId: target.terminalId })
      return
    }

    if (target.kind === 'new-website') {
      setIsTerminalPanelFolded(false)
      setIsTerminalOpen(true)
      requestInteractionPanelShortcut('new-website')
      return
    }

    if (target.kind === 'website' && target.url != null && target.url !== '') {
      setIsTerminalPanelFolded(false)
      setIsTerminalOpen(true)
      requestInteractionPanelShortcut('open-website', { title: target.title, url: target.url })
      return
    }

    if (target.kind === 'new-session') {
      if (session?.id == null) {
        void navigate('/')
        return
      }
      setIsTerminalPanelFolded(false)
      setIsTerminalOpen(true)
      requestInteractionPanelShortcut('new-session')
      return
    }

    if (target.kind === 'session' && target.sessionId != null && target.sessionId !== '') {
      if (session?.id == null) {
        void navigate(`/session/${encodeURIComponent(target.sessionId)}`)
        return
      }
      setIsTerminalPanelFolded(false)
      setIsTerminalOpen(true)
      requestInteractionPanelShortcut('open-session', {
        sessionId: target.sessionId,
        ...(target.title == null || target.title === '' ? {} : { title: target.title })
      })
    }
  }, [
    bottomPanel,
    navigate,
    requestInteractionPanelShortcut,
    session?.id,
    setIsTerminalOpen,
    setIsTerminalPanelFolded,
    setWorkspaceDrawerOpen
  ])

  useEffect(() => {
    const dispose = window.oneworksDesktop?.onWorkspaceResourceRequest?.((target) => {
      const normalizedTarget = normalizeLauncherResourceTarget(target)
      if (normalizedTarget == null) return
      handleLauncherResourceTarget(normalizedTarget)
    })
    return dispose
  }, [handleLauncherResourceTarget])

  useEffect(() =>
    addDesktopViewShortcutListener((action) => {
      if (action === 'toggle-terminal') {
        if (!isTerminalOpen) {
          setIsTerminalPanelFolded(false)
        }
        bottomPanel.handleToggleBottomPanel()
        return
      }

      if (action === 'toggle-file-tree') {
        setWorkspaceDrawerOpen(!isWorkspaceDrawerOpen, isWorkspaceDrawerOpen ? undefined : 'tree')
        return
      }

      if (action === 'toggle-side-panel') {
        setWorkspaceDrawerOpen(!isWorkspaceDrawerOpen)
        return
      }

      if (action === 'open-browser-tab') {
        setIsTerminalPanelFolded(false)
        setIsTerminalOpen(true)
        requestInteractionPanelShortcut('open-browser-tab')
      }
    }), [
    bottomPanel,
    isTerminalOpen,
    isWorkspaceDrawerOpen,
    requestInteractionPanelShortcut,
    setIsTerminalOpen,
    setIsTerminalPanelFolded,
    setWorkspaceDrawerOpen
  ])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const launcherAction = params.get('launcherAction')?.trim()
    const launcherRequestId = params.get('launcherRequestId')?.trim()
    if (launcherAction == null || launcherAction === '' || launcherRequestId == null || launcherRequestId === '') {
      return
    }
    if (handledLauncherRequestIdRef.current === launcherRequestId) {
      return
    }

    handledLauncherRequestIdRef.current = launcherRequestId
    const launcherPath = params.get('launcherPath')?.trim()
    const launcherSessionId = params.get('launcherSessionId')?.trim()
    const launcherTerminalId = params.get('launcherTerminalId')?.trim()
    const launcherTitle = params.get('launcherTitle')?.trim()
    const launcherUrl = params.get('launcherUrl')?.trim()
    for (
      const key of [
        'launcherAction',
        'launcherPath',
        'launcherRequestId',
        'launcherSessionId',
        'launcherTerminalId',
        'launcherTitle',
        'launcherUrl'
      ]
    ) {
      params.delete(key)
    }
    const cleanedSearch = params.toString()

    const replaceCurrentRoute = () => {
      void navigate({
        pathname: location.pathname,
        search: cleanedSearch === '' ? '' : `?${cleanedSearch}`
      }, { replace: true })
    }

    const target = normalizeLauncherResourceTarget({
      kind: launcherAction,
      ...(launcherPath == null || launcherPath === '' ? {} : { path: launcherPath }),
      ...(launcherSessionId == null || launcherSessionId === '' ? {} : { sessionId: launcherSessionId }),
      ...(launcherTerminalId == null || launcherTerminalId === '' ? {} : { terminalId: launcherTerminalId }),
      ...(launcherTitle == null || launcherTitle === '' ? {} : { title: launcherTitle }),
      ...(launcherUrl == null || launcherUrl === '' ? {} : { url: launcherUrl })
    })

    if (target?.kind === 'new-session' && session?.id == null) {
      void navigate({ pathname: '/', search: cleanedSearch === '' ? '' : `?${cleanedSearch}` }, { replace: true })
      return
    }

    if (target?.kind === 'session' && target.sessionId != null && target.sessionId !== '' && session?.id == null) {
      void navigate({
        pathname: `/session/${encodeURIComponent(target.sessionId)}`,
        search: cleanedSearch === '' ? '' : `?${cleanedSearch}`
      }, { replace: true })
      return
    }

    if (target != null) {
      handleLauncherResourceTarget(target)
    }
    replaceCurrentRoute()
  }, [
    handleLauncherResourceTarget,
    location.pathname,
    location.search,
    navigate,
    session?.id
  ])

  const shouldRenderBottomPanel = bottomPanel.shouldShowBottomPanel || isBottomPanelRendered ||
    interactionPanelShortcutRequest != null
  const routeHeader = (
    <ChatHeader
      breadcrumb={headerBreadcrumb}
      displayTitle={displayTitle}
      roomIconSeed={roomIconSeed}
      roomIconStatus={roomIconStatus}
      sessionCompactionInfo={sessionCompactionInfo}
      sessionInfo={sessionInfo}
      sessionId={session?.id}
      sessionTitle={session?.title}
      sessionStatus={session?.status}
      isStarred={session?.isStarred}
      isArchived={session?.isArchived}
      messages={messages}
      tags={session?.tags}
      lastMessage={session?.lastMessage}
      lastUserMessage={session?.lastUserMessage}
      activeView={activeView}
      enableTimelineView={enableTimelineView}
      historyTimelineHidden={historyTimelineHidden}
      isBottomPanelOpen={bottomPanel.shouldShowBottomPanel}
      isWorkspaceDrawerOpen={isWorkspaceDrawerOpen}
      isNewSessionActive={isNewSession}
      actionsOverride={headerActionsOverride}
      modeSwitch={modeSwitch}
      moreItems={headerMoreItems}
      projectWorkspaceFolder={projectWorkspaceFolder}
      showViewSwitches={showViewSwitches}
      terminalSessionId={terminalSessionId}
      runCommandTaskStatuses={runCommandTaskStatuses}
      onCreateSession={() => void navigate('/')}
      onOpenSidebar={openRouteSidebar}
      onOpenSessionLog={debugSessionLogPath == null ? undefined : handleOpenSessionLog}
      onRunCommand={handleRunCommand}
      onTerminateRunCommandTask={handleTerminateRunCommandTask}
      onHistoryTimelineHiddenChange={onHistoryTimelineHiddenChange}
      onViewChange={setActiveView}
      onToggleBottomPanel={bottomPanel.handleToggleBottomPanel}
      onToggleWorkspaceDrawer={() => setWorkspaceDrawerOpen(!isWorkspaceDrawerOpen)}
    />
  )

  return (
    <RouteContainerLayout
      className={`chat-route-layout ${shouldShowWorkspaceDrawer ? 'has-workspace-drawer' : ''} ${
        bottomPanel.shouldShowBottomPanel ? 'has-bottom-dock' : ''
      }`}
      bodyClassName='chat-route-layout__body'
      header={routeHeader}
      sidePanel={shouldShowWorkspaceDrawer
        ? (
          <ChatWorkspaceDrawer
            agentApprovals={agentApprovals}
            agentRoster={agentRoster}
            defaultView={workspaceDrawerView ?? workspaceDrawerDefaultView}
            isFullscreen={isWorkspaceDrawerFullscreen}
            locateFileRequest={workspaceDrawerLocateRequest}
            recentFilePaths={recentFilePaths}
            selectedFilePath={bottomPanel.selectedWorkspaceFilePath}
            settingsView={settingsView}
            sessionId={resolvedWorkspaceSessionId}
            terminalSessionId={terminalSessionId}
            terminalPanes={terminalPanes}
            onClose={() => setWorkspaceDrawerOpen(false)}
            onFullscreenChange={setWorkspaceDrawerFullscreen}
            onReferencePaths={onReferenceWorkspacePaths}
            onOpenFile={bottomPanel.handleOpenWorkspaceFile}
          />
        )
        : undefined}
      sidePanelClassName='chat-route-layout__workspace-panel'
      sidePanelCompactMode='overlay'
      sidePanelFullscreen={isWorkspaceDrawerFullscreen}
      sidePanelLabel='工作区抽屉'
      sidePanelResize={{
        defaultWidth: 340,
        maxWidth: 760,
        minContentWidth: 300,
        minWidth: 220,
        storageKey: 'workspaceDrawerWidth'
      }}
      onCloseSidePanel={() => setWorkspaceDrawerOpen(false)}
      bottomPanel={shouldRenderBottomPanel
        ? (
          <ChatRouteBottomPanel
            agentApprovals={agentApprovals}
            agentRoster={agentRoster}
            bottomPanel={bottomPanel}
            isFolded={isTerminalPanelFolded}
            isRendered
            isVisible={isBottomPanelVisible}
            shortcutRequest={interactionPanelShortcutRequest}
            sessionId={resolvedWorkspaceSessionId}
            workspaceRootPath={workspaceRootPath}
            onLocateWorkspacePath={handleLocateWorkspacePath}
            onWorkspaceDrawerCreateMenuClick={handleWorkspaceDrawerCreateMenuClick}
            onShortcutRequestHandled={(id) => {
              const pendingRequest = pendingInteractionPanelShortcutRequest ??
                readPendingInteractionPanelShortcutRequest()
              if (pendingRequest?.id === id) {
                pendingInteractionPanelShortcutRequest = null
                writePendingInteractionPanelShortcutRequest(null)
              }
              clearInteractionPanelShortcutRequest(id)
            }}
            onRunCommandTaskStatusesChange={setRunCommandTaskStatuses}
            onFoldChange={setIsTerminalPanelFolded}
            onReferenceWorkspacePaths={onReferenceWorkspacePaths}
            settingsView={settingsView}
            terminalSessionId={terminalSessionId}
            terminalPanes={terminalPanes}
            workspaceDrawerCreateItems={workspaceDrawerCreateItems}
            workspaceDrawerCreateSelectedKeys={workspaceDrawerCreateSelectedKeys}
          />
        )
        : undefined}
    >
      <div
        className={`chat-container ${isReady ? 'ready' : ''} ${isNewSession ? 'is-new-session' : ''}`}
      >
        {renderedView}
      </div>
    </RouteContainerLayout>
  )
}
