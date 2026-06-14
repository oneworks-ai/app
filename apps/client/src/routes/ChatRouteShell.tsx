/* eslint-disable max-lines -- route shell wires chat chrome, workspace drawer, and bottom dock layout. */
import './ChatRoute.scss'

import type { MenuProps } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'

import type { ChatMessage, Session } from '@oneworks/core'
import { usePanelResize } from '@oneworks/route-layout'
import type { SessionInfo } from '@oneworks/types'

import type { NavRailWindowBarAction } from '#~/components/NavRail'
import { ChatHeader } from '#~/components/chat/ChatHeader.js'
import type {
  ChatHeaderBreadcrumb,
  ChatHeaderModeSwitch,
  ChatHeaderMoreItems,
  ChatHeaderRoomIconStatus,
  ChatHeaderView
} from '#~/components/chat/ChatHeader.js'
import {
  MAX_VISIBLE_RECENT_RESOURCE_RESULTS,
  MAX_VISIBLE_RESOURCE_RESULTS,
  buildInteractionPanelRecentFileResources,
  collectInteractionPanelChildSessions,
  collectInteractionPanelWorkspaceFiles,
  compareInteractionPanelRecentResources,
  compareInteractionPanelResources
} from '#~/components/chat/interaction-panel/interaction-panel-resource-search'
import type {
  InteractionPanelResourceSearchResult
} from '#~/components/chat/interaction-panel/interaction-panel-resource-search'
import type {
  InteractionPanelRunCommand,
  InteractionPanelRunCommandTaskStatus
} from '#~/components/chat/interaction-panel/interaction-panel-run-commands'
import {
  readPendingInteractionPanelShortcutRequest,
  writePendingInteractionPanelShortcutRequest
} from '#~/components/chat/interaction-panel/interaction-panel-shortcut-request'
import type { InteractionPanelShortcutRequest } from '#~/components/chat/interaction-panel/interaction-panel-shortcut-request'
import { formatInteractionPanelShortcut } from '#~/components/chat/interaction-panel/interaction-panel-shortcuts'
import { buildInteractionPanelWebsiteResources } from '#~/components/chat/interaction-panel/interaction-panel-website-resources'
import { useInteractionPanelWorkspaceUrlKeys } from '#~/components/chat/interaction-panel/use-interaction-panel-workspace-url-keys'
import { useInteractionTerminalPanes } from '#~/components/chat/interaction-panel/use-interaction-terminal-panes'
import {
  getSessionNotificationFingerprint,
  isSessionNotificationMarkedRead,
  readSessionNotificationReadMarker,
  resolveSessionNotificationIndicator,
  writeSessionNotificationReadMarker
} from '#~/components/chat/session-notification-indicator'
import type { SessionNotificationReadMarker } from '#~/components/chat/session-notification-indicator'
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
import { useRouteSidebar } from '#~/components/layout/route-sidebar-context'
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
import { isShortcutMatch } from '#~/utils/shortcutUtils'

import { ChatRouteBottomPanel } from './ChatRouteBottomPanel'
import { LauncherOverlay } from './LauncherOverlay'

const WORKSPACE_TERMINAL_SESSION_ID = '__workspace__'
const WEB_WORKSPACE_LAUNCHER_SHORTCUT = 'mod+shift+p'
const SESSION_DOCK_PREVIEW_EXIT_MS = 180
const SESSION_DOCK_PREVIEW_EDGE_BUFFER_PX = 56
const WORKSPACE_DRAWER_WIDTH_STORAGE_KEY = 'workspaceDrawerWidth'
const WORKSPACE_DRAWER_DEFAULT_WIDTH = 340
const WORKSPACE_DRAWER_MIN_WIDTH = 220
const WORKSPACE_DRAWER_MIN_CONTENT_WIDTH = 300
const WORKSPACE_DRAWER_MAX_WIDTH_RATIO = 0.7
const CHAT_ROUTE_STARTUP_READY_SELECTOR = [
  '.chat-container.ready .chat-input-monaco[data-oneworks-sender-editor-ready="true"]',
  '.chat-container.ready .chat-messages.ready',
  '.chat-container.ready .chat-settings-panel',
  '.chat-container.ready .chat-timeline-view'
].join(',')

const clampWorkspaceDrawerWidth = (value: number, maxWidth = Number.POSITIVE_INFINITY) => {
  const resolvedMaxWidth = Number.isFinite(maxWidth)
    ? Math.max(WORKSPACE_DRAWER_MIN_WIDTH, Math.floor(maxWidth))
    : Number.POSITIVE_INFINITY
  return Math.min(Math.max(value, WORKSPACE_DRAWER_MIN_WIDTH), resolvedMaxWidth)
}

const resolveWorkspaceDrawerMaxWidth = (containerWidth?: number) => {
  if (containerWidth == null || !Number.isFinite(containerWidth) || containerWidth <= 0) {
    return Number.POSITIVE_INFINITY
  }

  const contentMaxWidth = containerWidth - WORKSPACE_DRAWER_MIN_CONTENT_WIDTH
  const ratioMaxWidth = containerWidth * WORKSPACE_DRAWER_MAX_WIDTH_RATIO
  return Math.max(WORKSPACE_DRAWER_MIN_WIDTH, Math.floor(Math.min(contentMaxWidth, ratioMaxWidth)))
}

const readWorkspaceDrawerWidth = () => {
  if (typeof localStorage === 'undefined') return WORKSPACE_DRAWER_DEFAULT_WIDTH

  try {
    const storedValue = localStorage.getItem(WORKSPACE_DRAWER_WIDTH_STORAGE_KEY)
    if (storedValue == null) return WORKSPACE_DRAWER_DEFAULT_WIDTH

    const parsedValue = Number(storedValue)
    return Number.isFinite(parsedValue)
      ? clampWorkspaceDrawerWidth(parsedValue)
      : WORKSPACE_DRAWER_DEFAULT_WIDTH
  } catch {
    return WORKSPACE_DRAWER_DEFAULT_WIDTH
  }
}

const writeWorkspaceDrawerWidth = (width: number) => {
  if (typeof localStorage === 'undefined') return

  try {
    localStorage.setItem(WORKSPACE_DRAWER_WIDTH_STORAGE_KEY, String(width))
  } catch {
    // Ignore storage failures; resizing should remain usable.
  }
}

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

const normalizeWebLauncherQuery = (query: string) => query.trim().toLowerCase()

const getWorkspaceFolderName = (workspaceFolder: string) => {
  const normalizedFolder = workspaceFolder.replace(/[\\/]+$/u, '')
  return normalizedFolder.split(/[\\/]/u).filter(Boolean).at(-1) ?? workspaceFolder
}

const matchesWebLauncherQuery = (normalizedQuery: string, values: Array<string | undefined>) => {
  if (normalizedQuery === '') return true
  return values.some(value => value?.toLowerCase().includes(normalizedQuery) === true)
}

const isFileResource = (
  resource: InteractionPanelResourceSearchResult
): resource is Extract<InteractionPanelResourceSearchResult, { kind: 'file' }> => resource.kind === 'file'

const isSessionResource = (
  resource: InteractionPanelResourceSearchResult
): resource is Extract<InteractionPanelResourceSearchResult, { kind: 'session' }> => resource.kind === 'session'

const isWebsiteResource = (
  resource: InteractionPanelResourceSearchResult
): resource is Extract<InteractionPanelResourceSearchResult, { kind: 'website' }> => resource.kind === 'website'

const toLauncherWorkspaceResourceSearchResponse = ({
  files,
  sessions,
  terminals,
  websites
}: {
  files: InteractionPanelResourceSearchResult[]
  sessions: InteractionPanelResourceSearchResult[]
  terminals: DesktopWorkspaceResourceSearchResult[]
  websites: InteractionPanelResourceSearchResult[]
}): DesktopWorkspaceResourceSearchResponse => ({
  files: files.filter(isFileResource).map(file => ({
    directory: file.directory,
    id: file.id,
    kind: 'file',
    name: file.name,
    path: file.path,
    title: file.name,
    updatedAt: file.updatedAt
  })),
  sessions: sessions.filter(isSessionResource).map(sessionResource => ({
    createdAt: sessionResource.createdAt,
    id: sessionResource.id,
    kind: 'session',
    sessionId: sessionResource.sessionId,
    subtitle: sessionResource.sessionId,
    title: sessionResource.title
  })),
  terminals,
  websites: websites.filter(isWebsiteResource).map(website => ({
    faviconUrl: website.faviconUrl,
    id: website.id,
    kind: 'website',
    title: website.title,
    updatedAt: website.updatedAt,
    url: website.url
  }))
})

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
  const { clearRouteWindowBar, hasRouteSidebarProvider, setRouteWindowBar } = useRouteSidebar()
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
  const [isWebLauncherOpen, setIsWebLauncherOpen] = useState(false)
  const [isSessionDockPreviewOpen, setIsSessionDockPreviewOpen] = useState(false)
  const [isSessionDockPreviewRendered, setIsSessionDockPreviewRendered] = useState(false)
  const [isSessionDockPreviewExiting, setIsSessionDockPreviewExiting] = useState(false)
  const [isSessionDockPreviewPinned, setIsSessionDockPreviewPinned] = useState(false)
  const [workspaceDrawerWidth, setWorkspaceDrawerWidthState] = useState(readWorkspaceDrawerWidth)
  const [runCommandTaskStatuses, setRunCommandTaskStatuses] = useState<InteractionPanelRunCommandTaskStatus[]>([])
  const [sessionNotificationReadMarker, setSessionNotificationReadMarker] = useState<
    SessionNotificationReadMarker | null
  >(() => readSessionNotificationReadMarker(workspaceSessionId ?? session?.id))
  const resolvedWorkspaceSession = workspaceSession ?? session
  const resolvedWorkspaceSessionId = workspaceSessionId ?? resolvedWorkspaceSession?.id
  const sessionWorkspaceRootPath = sessionInfo?.type === 'init' ? sessionInfo.cwd.trim() : ''
  const workspaceRootPath = sessionWorkspaceRootPath === '' ? projectWorkspaceFolder : sessionWorkspaceRootPath
  const terminalSessionId = resolvedWorkspaceSessionId ?? WORKSPACE_TERMINAL_SESSION_ID
  const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac')
  const fullscreenSessionWindowBarLabel = resolvedWorkspaceSession?.title?.trim() ||
    displayTitle?.trim() ||
    t('navRail.conversations')
  const sessionNotificationFingerprint = resolvedWorkspaceSession == null
    ? ''
    : getSessionNotificationFingerprint(resolvedWorkspaceSession)
  const sessionNotificationRead = isSessionNotificationMarkedRead(
    resolvedWorkspaceSession,
    sessionNotificationReadMarker
  )
  const sessionNotificationIndicator = useMemo(() =>
    resolveSessionNotificationIndicator(resolvedWorkspaceSession, {
      completedRead: sessionNotificationRead
    }), [
    resolvedWorkspaceSession,
    sessionNotificationFingerprint,
    sessionNotificationRead
  ])
  const sessionNotificationBadge = useMemo(() => {
    if (sessionNotificationIndicator == null) return undefined

    return {
      ...(sessionNotificationIndicator.animated == null
        ? {}
        : { animated: sessionNotificationIndicator.animated }),
      label: t(`common.status.${sessionNotificationIndicator.status}`),
      tone: sessionNotificationIndicator.tone
    }
  }, [sessionNotificationIndicator, t])
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
  const { projectUrlHistoryKey, sessionUrlHistoryKey } = useInteractionPanelWorkspaceUrlKeys(
    resolvedWorkspaceSessionId,
    terminalSessionId
  )
  const canUseWorkspaceLauncher = workspaceRootPath != null && workspaceRootPath.trim() !== ''
  const canUseWebLauncherShortcut = window.oneworksDesktop == null && canUseWorkspaceLauncher
  const webWorkspaceLauncherShortcutLabel = useMemo(
    () => formatInteractionPanelShortcut(WEB_WORKSPACE_LAUNCHER_SHORTCUT, isMac),
    [isMac]
  )
  const openResourceShortcut = canUseWebLauncherShortcut ? WEB_WORKSPACE_LAUNCHER_SHORTCUT : undefined
  const openResourceShortcutLabel = canUseWebLauncherShortcut ? webWorkspaceLauncherShortcutLabel : undefined
  const workspaceDrawerWidthStyle = useMemo(() =>
    ({
      '--route-container-side-panel-width': `${workspaceDrawerWidth}px`
    }) as CSSProperties, [workspaceDrawerWidth])
  const handleWorkspaceDrawerWidthChange = useCallback((width: number) => {
    setWorkspaceDrawerWidthState(clampWorkspaceDrawerWidth(width))
  }, [])
  const commitWorkspaceDrawerWidth = useCallback((width: number, maxWidth?: number) => {
    const resolvedWidth = clampWorkspaceDrawerWidth(width, maxWidth)
    setWorkspaceDrawerWidthState(resolvedWidth)
    writeWorkspaceDrawerWidth(resolvedWidth)
  }, [])
  const resolveWorkspaceDrawerMaxWidthFromElement = useCallback((element: Element | null | undefined) => {
    const mainElement = element?.closest('.route-container-layout__main') ??
      document.querySelector('.chat-route-layout .route-container-layout__main')
    return resolveWorkspaceDrawerMaxWidth(mainElement?.getBoundingClientRect().width)
  }, [])
  const sessionDockPreviewResizeMaxWidth = typeof window === 'undefined'
    ? Number.POSITIVE_INFINITY
    : resolveWorkspaceDrawerMaxWidth(window.innerWidth)
  const sessionDockPreviewResize = usePanelResize({
    axis: 'x',
    cursor: 'col-resize',
    direction: -1,
    disabled: !isSessionDockPreviewRendered || !isWorkspaceDrawerFullscreen,
    getMaxValue: (event) => resolveWorkspaceDrawerMaxWidthFromElement(event?.currentTarget),
    max: sessionDockPreviewResizeMaxWidth,
    min: WORKSPACE_DRAWER_MIN_WIDTH,
    onCommit: (width) =>
      commitWorkspaceDrawerWidth(
        width,
        resolveWorkspaceDrawerMaxWidthFromElement(document.querySelector('.chat-session-dock-preview-resize-handle'))
      ),
    onPreview: handleWorkspaceDrawerWidthChange,
    onResizeStart: () => {
      setIsSessionDockPreviewRendered(true)
      setIsSessionDockPreviewExiting(false)
      setIsSessionDockPreviewOpen(true)
    },
    value: workspaceDrawerWidth
  })
  const webLauncherWorkspaceContext = useMemo<DesktopWorkspaceSelectorProject | undefined>(() => {
    const normalizedWorkspaceRootPath = workspaceRootPath?.trim()
    if (normalizedWorkspaceRootPath == null || normalizedWorkspaceRootPath === '') return undefined

    const workspaceName = getWorkspaceFolderName(normalizedWorkspaceRootPath)
    return {
      description: normalizedWorkspaceRootPath,
      isCurrent: true,
      name: workspaceName === '' ? displayTitle?.trim() || normalizedWorkspaceRootPath : workspaceName,
      status: 'ready',
      workspaceFolder: normalizedWorkspaceRootPath
    }
  }, [displayTitle, workspaceRootPath])
  const handleSessionDockPreviewOpen = useCallback(() => {
    if (!isWorkspaceDrawerFullscreen) return

    setIsSessionDockPreviewRendered(true)
    setIsSessionDockPreviewExiting(false)
    setIsSessionDockPreviewOpen(true)
  }, [isWorkspaceDrawerFullscreen])
  const clearSessionDockPreview = useCallback(() => {
    setIsSessionDockPreviewRendered(false)
    setIsSessionDockPreviewExiting(false)
    setIsSessionDockPreviewPinned(false)
    setIsSessionDockPreviewOpen(false)
  }, [])
  const handleWorkspaceDrawerFullscreenChange = useCallback((fullscreen: boolean) => {
    if (!fullscreen) {
      clearSessionDockPreview()
    }

    setWorkspaceDrawerFullscreen(fullscreen)
  }, [clearSessionDockPreview, setWorkspaceDrawerFullscreen])
  const handleSessionDockPreviewPinToggle = useCallback(() => {
    if (isSessionDockPreviewPinned) {
      setIsSessionDockPreviewPinned(false)
      setIsSessionDockPreviewOpen(false)
      return
    }

    setIsSessionDockPreviewPinned(true)
    setIsSessionDockPreviewRendered(true)
    setIsSessionDockPreviewExiting(false)
    setIsSessionDockPreviewOpen(true)
  }, [isSessionDockPreviewPinned])

  const markSessionNotificationRead = useCallback(() => {
    if (resolvedWorkspaceSession == null) return

    const marker = writeSessionNotificationReadMarker(resolvedWorkspaceSession)
    if (marker != null) {
      setSessionNotificationReadMarker(marker)
    }
  }, [resolvedWorkspaceSession, sessionNotificationFingerprint])

  useEffect(() => {
    setSessionNotificationReadMarker(readSessionNotificationReadMarker(resolvedWorkspaceSessionId))
  }, [resolvedWorkspaceSessionId])

  useEffect(() => {
    if (resolvedWorkspaceSession == null) return
    if (isWorkspaceDrawerFullscreen && !isSessionDockPreviewOpen && !isSessionDockPreviewPinned) return

    markSessionNotificationRead()
  }, [
    isSessionDockPreviewOpen,
    isSessionDockPreviewPinned,
    isWorkspaceDrawerFullscreen,
    markSessionNotificationRead,
    resolvedWorkspaceSession,
    sessionNotificationFingerprint
  ])

  useEffect(() => {
    if (isSessionDockPreviewOpen) {
      setIsSessionDockPreviewRendered(true)
      setIsSessionDockPreviewExiting(false)
      return undefined
    }

    if (!isSessionDockPreviewRendered) return undefined

    setIsSessionDockPreviewExiting(true)
    const timeoutId = window.setTimeout(() => {
      setIsSessionDockPreviewRendered(false)
      setIsSessionDockPreviewExiting(false)
    }, SESSION_DOCK_PREVIEW_EXIT_MS)

    return () => window.clearTimeout(timeoutId)
  }, [isSessionDockPreviewOpen, isSessionDockPreviewRendered])

  useEffect(() => {
    if (!isSessionDockPreviewOpen || isSessionDockPreviewPinned) return undefined

    let closeTimer: number | null = null
    const clearCloseTimer = () => {
      if (closeTimer == null) return

      window.clearTimeout(closeTimer)
      closeTimer = null
    }
    const scheduleClose = () => {
      clearCloseTimer()
      closeTimer = window.setTimeout(() => {
        closeTimer = null
        setIsSessionDockPreviewOpen(false)
      }, 180)
    }
    const isPointerInPreviewBuffer = (event: PointerEvent, element: Element | null) => {
      if (!(element instanceof HTMLElement)) return false

      const rect = element.getBoundingClientRect()
      return event.clientX >= rect.right &&
        event.clientX <= rect.right + SESSION_DOCK_PREVIEW_EDGE_BUFFER_PX &&
        event.clientY >= rect.top - SESSION_DOCK_PREVIEW_EDGE_BUFFER_PX &&
        event.clientY <= rect.bottom + SESSION_DOCK_PREVIEW_EDGE_BUFFER_PX
    }
    const handlePointerMove = (event: PointerEvent) => {
      if (sessionDockPreviewResize.isResizing) {
        clearCloseTimer()
        return
      }

      const target = event.target
      if (!(target instanceof Node)) return

      const previewSurface = document.querySelector(
        '.chat-route-layout.is-session-dock-previewing .route-container-layout__surface'
      )
      const previewTrigger = document.querySelector(
        '[data-nav-rail-window-action-key="chat-session"]'
      )
      const previewResizeHandle = document.querySelector('.chat-session-dock-preview-resize-handle')
      if (
        previewSurface?.contains(target) === true ||
        previewTrigger?.contains(target) === true ||
        previewResizeHandle?.contains(target) === true ||
        isPointerInPreviewBuffer(event, previewSurface)
      ) {
        clearCloseTimer()
        return
      }

      scheduleClose()
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    return () => {
      clearCloseTimer()
      window.removeEventListener('pointermove', handlePointerMove)
    }
  }, [isSessionDockPreviewOpen, isSessionDockPreviewPinned, sessionDockPreviewResize.isResizing])

  useEffect(() => {
    const key = 'chat-workspace-drawer-fullscreen-window-bar'
    if (!hasRouteSidebarProvider || !isWorkspaceDrawerFullscreen) return undefined

    const actions: NavRailWindowBarAction[] = [
      ...(resolvedWorkspaceSessionId == null || resolvedWorkspaceSessionId === ''
        ? []
        : [
          {
            active: isSessionDockPreviewPinned,
            badge: sessionNotificationBadge,
            icon: 'chat_bubble',
            key: 'chat-session',
            label: fullscreenSessionWindowBarLabel,
            showTooltip: false,
            title: fullscreenSessionWindowBarLabel,
            onPreviewOpen: handleSessionDockPreviewOpen,
            onSelect: handleSessionDockPreviewPinToggle
          }
        ])
    ]

    setRouteWindowBar({
      actions,
      hideCreateSessionAction: true,
      key
    })

    return () => clearRouteWindowBar(key)
  }, [
    clearRouteWindowBar,
    fullscreenSessionWindowBarLabel,
    handleSessionDockPreviewOpen,
    handleSessionDockPreviewPinToggle,
    hasRouteSidebarProvider,
    isSessionDockPreviewPinned,
    isWorkspaceDrawerFullscreen,
    resolvedWorkspaceSessionId,
    sessionNotificationBadge,
    setRouteWindowBar
  ])

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
  const handleOpenWebLauncher = useCallback(() => {
    if (!canUseWorkspaceLauncher) return
    setIsWebLauncherOpen(true)
  }, [canUseWorkspaceLauncher])
  const searchWebLauncherWorkspaceResources = useCallback(async (
    query: string
  ): Promise<DesktopWorkspaceResourceSearchResponse> => {
    const normalizedQuery = normalizeWebLauncherQuery(query)
    const queryTokens = normalizedQuery.split(/\s+/u).filter(Boolean)
    const recentFiles = buildInteractionPanelRecentFileResources(recentFilePaths)
    const websites = buildInteractionPanelWebsiteResources({
      iframePages: [],
      projectUrlHistoryKey,
      sessionUrlHistoryKey
    })
    const terminals: DesktopWorkspaceResourceSearchResult[] = terminalPanes.panes
      .map((pane, index) => ({
        id: `terminal:${pane.id}`,
        kind: 'terminal' as const,
        shellKind: pane.shellKind,
        terminalId: pane.id,
        title: pane.title,
        updatedAt: Number.MAX_SAFE_INTEGER - index
      }))
      .filter(terminal =>
        matchesWebLauncherQuery(normalizedQuery, [terminal.title, terminal.terminalId, terminal.shellKind])
      )

    const [files, sessions] = await Promise.all([
      normalizedQuery === ''
        ? Promise.resolve(recentFiles)
        : collectInteractionPanelWorkspaceFiles({
          isCancelled: () => false,
          queryTokens,
          sessionId: resolvedWorkspaceSessionId
        }),
      collectInteractionPanelChildSessions(resolvedWorkspaceSessionId)
    ])

    const filteredSessions = sessions.filter(resource =>
      matchesWebLauncherQuery(normalizedQuery, [resource.title, resource.sessionId])
    )
    const filteredWebsites = websites.filter(resource =>
      matchesWebLauncherQuery(normalizedQuery, [resource.title, resource.url])
    )

    if (normalizedQuery === '') {
      return toLauncherWorkspaceResourceSearchResponse({
        files: [...files].sort(compareInteractionPanelRecentResources).slice(0, MAX_VISIBLE_RECENT_RESOURCE_RESULTS),
        sessions: [...filteredSessions]
          .sort(compareInteractionPanelRecentResources)
          .slice(0, MAX_VISIBLE_RECENT_RESOURCE_RESULTS),
        terminals: terminals.slice(0, MAX_VISIBLE_RECENT_RESOURCE_RESULTS),
        websites: [...filteredWebsites]
          .sort(compareInteractionPanelRecentResources)
          .slice(0, MAX_VISIBLE_RECENT_RESOURCE_RESULTS)
      })
    }

    return toLauncherWorkspaceResourceSearchResponse({
      files: [...files].sort(compareInteractionPanelResources(normalizedQuery)).slice(0, MAX_VISIBLE_RESOURCE_RESULTS),
      sessions: [...filteredSessions]
        .sort(compareInteractionPanelResources(normalizedQuery))
        .slice(0, MAX_VISIBLE_RESOURCE_RESULTS),
      terminals: terminals.slice(0, MAX_VISIBLE_RESOURCE_RESULTS),
      websites: [...filteredWebsites]
        .sort(compareInteractionPanelResources(normalizedQuery))
        .slice(0, MAX_VISIBLE_RESOURCE_RESULTS)
    })
  }, [
    projectUrlHistoryKey,
    recentFilePaths,
    resolvedWorkspaceSessionId,
    sessionUrlHistoryKey,
    terminalPanes.panes
  ])
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

  const requestLauncherResourceTarget = useCallback((target: DesktopWorkspaceResourceTarget) => {
    const params = new URLSearchParams(location.search)
    params.set('launcherAction', target.kind)
    params.set('launcherRequestId', `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
    const optionalParams: Array<[string, string | undefined]> = [
      ['launcherPath', target.path],
      ['launcherSessionId', target.sessionId],
      ['launcherTerminalId', target.terminalId],
      ['launcherTitle', target.title],
      ['launcherUrl', target.url]
    ]

    for (const [key, value] of optionalParams) {
      if (value == null || value === '') {
        params.delete(key)
      } else {
        params.set(key, value)
      }
    }

    void navigate({
      pathname: location.pathname,
      search: `?${params.toString()}`
    }, { replace: true })
  }, [location.pathname, location.search, navigate])

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
    if (!canUseWebLauncherShortcut) {
      setIsWebLauncherOpen(false)
      return
    }

    const handleWebLauncherShortcut = (event: KeyboardEvent) => {
      if (event.isComposing || !isShortcutMatch(event, WEB_WORKSPACE_LAUNCHER_SHORTCUT, isMac)) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      setIsWebLauncherOpen(open => !open)
    }

    window.addEventListener('keydown', handleWebLauncherShortcut, true)
    return () => window.removeEventListener('keydown', handleWebLauncherShortcut, true)
  }, [canUseWebLauncherShortcut, isMac])

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
      hideTitleIcon={isSessionDockPreviewRendered}
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
      sessionDockPreviewPinned={isSessionDockPreviewPinned}
      onCreateSession={() => void navigate('/')}
      onOpenSidebar={openRouteSidebar}
      onOpenSessionLog={debugSessionLogPath == null ? undefined : handleOpenSessionLog}
      onRunCommand={handleRunCommand}
      onToggleSessionDockPreviewPinned={isSessionDockPreviewRendered ? handleSessionDockPreviewPinToggle : undefined}
      onTerminateRunCommandTask={handleTerminateRunCommandTask}
      onHistoryTimelineHiddenChange={onHistoryTimelineHiddenChange}
      onViewChange={setActiveView}
      onToggleBottomPanel={bottomPanel.handleToggleBottomPanel}
      onToggleWorkspaceDrawer={() => setWorkspaceDrawerOpen(!isWorkspaceDrawerOpen)}
    />
  )

  return (
    <>
      <RouteContainerLayout
        className={`chat-route-layout ${shouldShowWorkspaceDrawer ? 'has-workspace-drawer' : ''} ${
          bottomPanel.shouldShowBottomPanel ? 'has-bottom-dock' : ''
        } ${isSessionDockPreviewRendered ? 'is-session-dock-previewing' : ''} ${
          isSessionDockPreviewExiting ? 'is-session-dock-preview-exiting' : ''
        } ${sessionDockPreviewResize.isResizing ? 'is-session-dock-preview-resizing' : ''}`}
        style={workspaceDrawerWidthStyle}
        bodyClassName='chat-route-layout__body'
        header={routeHeader}
        mainOverlay={isSessionDockPreviewRendered
          ? (
            <>
              {sessionDockPreviewResize.isResizing && (
                <div className='chat-session-dock-preview-resize-shield' aria-hidden='true' />
              )}
              <div
                aria-label={t('common.dragResize')}
                aria-valuemax={Number.isFinite(sessionDockPreviewResizeMaxWidth)
                  ? Math.floor(sessionDockPreviewResizeMaxWidth)
                  : undefined}
                aria-valuemin={WORKSPACE_DRAWER_MIN_WIDTH}
                aria-valuenow={Math.floor(workspaceDrawerWidth)}
                className={[
                  'chat-session-dock-preview-resize-handle',
                  sessionDockPreviewResize.isResizing ? 'is-resizing' : ''
                ].filter(Boolean).join(' ')}
                onKeyDown={sessionDockPreviewResize.handleKeyDown}
                onPointerDown={sessionDockPreviewResize.handlePointerDown}
                role='separator'
                tabIndex={0}
                title={t('common.dragResize')}
              />
            </>
          )
          : undefined}
        sidePanel={shouldShowWorkspaceDrawer
          ? (
            <ChatWorkspaceDrawer
              agentApprovals={agentApprovals}
              agentRoster={agentRoster}
              defaultView={workspaceDrawerView ?? workspaceDrawerDefaultView}
              isBottomPanelOpen={bottomPanel.shouldShowBottomPanel}
              isFullscreen={isWorkspaceDrawerFullscreen}
              locateFileRequest={workspaceDrawerLocateRequest}
              selectedFilePath={bottomPanel.selectedWorkspaceFilePath}
              settingsView={settingsView}
              sessionId={resolvedWorkspaceSessionId}
              terminalSessionId={terminalSessionId}
              terminalPanes={terminalPanes}
              onClose={() => setWorkspaceDrawerOpen(false)}
              onFullscreenChange={handleWorkspaceDrawerFullscreenChange}
              onOpenBottomPanel={() => {
                if (!bottomPanel.shouldShowBottomPanel) {
                  bottomPanel.handleToggleBottomPanel()
                }
              }}
              onReferencePaths={onReferenceWorkspacePaths}
              onOpenFile={bottomPanel.handleOpenWorkspaceFile}
              onOpenResource={handleOpenWebLauncher}
              openResourceShortcut={openResourceShortcut}
              openResourceShortcutLabel={openResourceShortcutLabel}
            />
          )
          : undefined}
        sidePanelClassName='chat-route-layout__workspace-panel'
        sidePanelCompactMode='overlay'
        sidePanelFullscreen={isWorkspaceDrawerFullscreen}
        sidePanelLabel='工作区抽屉'
        sidePanelResize={{
          defaultWidth: WORKSPACE_DRAWER_DEFAULT_WIDTH,
          maxWidthRatio: WORKSPACE_DRAWER_MAX_WIDTH_RATIO,
          minContentWidth: WORKSPACE_DRAWER_MIN_CONTENT_WIDTH,
          minWidth: WORKSPACE_DRAWER_MIN_WIDTH,
          onWidthChange: handleWorkspaceDrawerWidthChange,
          storageKey: WORKSPACE_DRAWER_WIDTH_STORAGE_KEY,
          width: workspaceDrawerWidth
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
              openResourceKeyboardShortcut={canUseWebLauncherShortcut ? null : undefined}
              openResourceShortcut={openResourceShortcut}
              openResourceShortcutLabel={openResourceShortcutLabel}
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
              onOpenResource={handleOpenWebLauncher}
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
      {canUseWorkspaceLauncher
        ? (
          <LauncherOverlay
            open={isWebLauncherOpen}
            workspaceContext={webLauncherWorkspaceContext}
            searchWorkspaceResources={searchWebLauncherWorkspaceResources}
            onClose={() => setIsWebLauncherOpen(false)}
            onOpenWorkspaceResource={requestLauncherResourceTarget}
          />
        )
        : undefined}
    </>
  )
}
