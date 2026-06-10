/* eslint-disable max-lines -- panel shell coordinates dock tabs, shortcuts, and resource/session overlays. */
import 'dockview/dist/styles/dockview.css'
import './ChatInteractionPanel.scss'

import type { MenuProps } from 'antd'
import { useAtomValue } from 'jotai'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'

import type { GitRepositoryState, TerminalShellKind } from '@oneworks/types'

import { getSessionGitState, getWorkspaceGitState } from '#~/api'
import { getAgentRoomApprovalMessages } from '#~/components/agent-room/@core/approval-messages'
import {
  CHAT_BOTTOM_DOCK_DEFAULT_HEIGHT,
  CHAT_BOTTOM_DOCK_HEIGHT_STORAGE_KEY,
  CHAT_BOTTOM_DOCK_MAX_HEIGHT,
  CHAT_BOTTOM_DOCK_MIN_HEIGHT
} from '#~/components/chat/bottom-dock-constants'
import { isTerminalPaneOnSurface } from '#~/components/chat/terminal/@utils/terminal-panes'
import { parseWorkbenchDrawerViewMenuKey } from '#~/components/chat/workbench-create-menu'
import type {
  ChatWorkspaceDrawerAgentApprovals,
  ChatWorkspaceDrawerAgentRoster
} from '#~/components/chat/workspace-drawer/ChatWorkspaceDrawer'
import { useWorkspaceDrawerDockActions } from '#~/components/chat/workspace-drawer/use-workspace-drawer-dock-actions'
import type { WorkspaceDrawerView } from '#~/components/chat/workspace-drawer/workspace-drawer-types'
import type { WorkspaceDrawerViewItem } from '#~/components/chat/workspace-drawer/workspace-drawer-view-items'
import type { WorkspaceMarkdownPreviewMode } from '#~/components/chat/workspace-file-editor/workspace-file-editor-language'
import { DockPanel } from '#~/components/dock-panel/DockPanel'
import type { RouteContainerPanelDockActionItem } from '#~/components/layout/RouteContainerPanelTabs'
import type { ContextPickerFile } from '#~/components/workspace/context-file-types'
import type { ChatRouteBottomPanelState } from '#~/hooks/chat/use-chat-route-bottom-panel'
import { useResponsiveLayout } from '#~/hooks/use-responsive-layout'
import type { PluginContributionWorkbenchAddMenuItem, PluginContributionWorkbenchTab } from '#~/plugins/plugin-manifest'
import { usePluginCommandExecutor, usePluginSlot } from '#~/plugins/plugin-slots'
import { interactionPanelPinnedTabLimitAtom } from '#~/store/index'

import { InteractionPanelContent } from './InteractionPanelContent'
import type { InteractionPanelDockTabHeaderActionContext } from './InteractionPanelDockWorkspace.types'
import { InteractionPanelOpenResourceDialogHost } from './InteractionPanelOpenResourceDialogHost'
import { InteractionPanelPinnedTabEditModal } from './InteractionPanelPinnedTabEditModal'
import type { InteractionPanelPinnedTab } from './interaction-panel-pinned-tabs'
import {
  buildInteractionPanelRunCommandScript,
  buildInteractionPanelRunCommandTaskScript,
  getInteractionPanelRunCommandIcon,
  getInteractionPanelRunCommandTitle
} from './interaction-panel-run-commands'
import type { InteractionPanelRunCommand, InteractionPanelRunCommandTaskStatus } from './interaction-panel-run-commands'
import {
  readPendingInteractionPanelShortcutRequest,
  writePendingInteractionPanelShortcutRequest
} from './interaction-panel-shortcut-request'
import type { InteractionPanelShortcutRequest } from './interaction-panel-shortcut-request'
import { parseInteractionPanelPluginAddMenuKey } from './interaction-panel-tab-menu'
import type { InteractionPanelTab } from './interaction-panel-tabs'
import { useInteractionPanelPinnedTabs } from './use-interaction-panel-pinned-tabs'
import { useInteractionPanelQuerySessionFocus } from './use-interaction-panel-query-session-focus'
import { useInteractionPanelQuerySessionTab } from './use-interaction-panel-query-session-tab'
import { useInteractionPanelShortcuts } from './use-interaction-panel-shortcuts'
import { useInteractionPanelTabs } from './use-interaction-panel-tabs'
import { useInteractionPanelWorkspaceUrlKeys } from './use-interaction-panel-workspace-url-keys'
import type { InteractionTerminalPanesController } from './use-interaction-terminal-panes'

type InteractionPanelTabHeaderActionResolver = (
  context: InteractionPanelDockTabHeaderActionContext
) => RouteContainerPanelDockActionItem[]

const CHAT_INTERACTION_PANEL_MINIMIZED_HEIGHT =
  'calc(var(--app-chrome-icon-size, 18px) + var(--route-container-header-padding-block, 10px) + var(--route-container-header-padding-block, 10px) + var(--route-container-header-border-width, var(--app-chrome-border-width, 1px)))'

export function ChatInteractionPanel({
  agentApprovals,
  agentRoster,
  bottomPanel,
  isFolded,
  isVisible,
  shortcutRequest,
  onShortcutRequestHandled,
  onRunCommandTaskStatusesChange,
  onFoldChange,
  onLocateWorkspacePath,
  onReferenceWorkspacePaths,
  onWorkspaceDrawerCreateMenuClick,
  settingsView,
  sessionId,
  terminalSessionId,
  terminalPanes,
  workspaceDrawerCreateItems,
  workspaceDrawerCreateSelectedKeys,
  workspaceRootPath
}: {
  agentApprovals?: ChatWorkspaceDrawerAgentApprovals
  agentRoster?: ChatWorkspaceDrawerAgentRoster
  bottomPanel: ChatRouteBottomPanelState
  isFolded: boolean
  isVisible: boolean
  shortcutRequest?: InteractionPanelShortcutRequest | null
  onShortcutRequestHandled?: (id: number) => void
  onRunCommandTaskStatusesChange?: (statuses: InteractionPanelRunCommandTaskStatus[]) => void
  onFoldChange: (isFolded: boolean) => void
  onLocateWorkspacePath: (path: string) => void
  onReferenceWorkspacePaths?: (files: ContextPickerFile[]) => void
  onWorkspaceDrawerCreateMenuClick?: NonNullable<MenuProps['onClick']>
  settingsView?: ReactNode
  sessionId?: string
  terminalSessionId: string
  terminalPanes: InteractionTerminalPanesController
  workspaceDrawerCreateItems?: WorkspaceDrawerViewItem[]
  workspaceDrawerCreateSelectedKeys?: string[]
  workspaceRootPath?: string
}) {
  const { i18n, t } = useTranslation()
  const navigate = useNavigate()
  const { isCompactLayout, isTouchInteraction } = useResponsiveLayout()
  const isCompactView = isCompactLayout || isTouchInteraction
  const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac')
  const maxPinnedTabs = useAtomValue(interactionPanelPinnedTabLimitAtom)
  const pluginAddMenuItems = usePluginSlot<PluginContributionWorkbenchAddMenuItem>('workbench.addMenu')
  const pluginWorkbenchTabs = usePluginSlot<PluginContributionWorkbenchTab>('workbench.tabs')
  const executePluginCommand = usePluginCommandExecutor()
  const pluginLanguage = i18n.resolvedLanguage ?? i18n.language
  const canCreateSessionTab = sessionId != null && sessionId !== ''
  const [isOpenResourceDialogOpen, setIsOpenResourceDialogOpen] = useState(false)
  const [editingPinnedTab, setEditingPinnedTab] = useState<InteractionPanelPinnedTab | null>(null)
  const [markdownPreviewMode, setMarkdownPreviewMode] = useState<WorkspaceMarkdownPreviewMode>('preview')
  const handledShortcutRequestIdRef = useRef<number | null>(null)
  const { projectUrlHistoryKey, sessionUrlHistoryKey } = useInteractionPanelWorkspaceUrlKeys(
    sessionId,
    terminalSessionId
  )
  const recentFilePaths = bottomPanel.selectedWorkspaceFilePath == null
    ? bottomPanel.openWorkspaceFilePaths
    : [
      bottomPanel.selectedWorkspaceFilePath,
      ...bottomPanel.openWorkspaceFilePaths.filter(path => path !== bottomPanel.selectedWorkspaceFilePath)
    ]
  const bottomTerminalPanes = useMemo(
    () => terminalPanes.panes.filter(pane => isTerminalPaneOnSurface(pane, 'bottom')),
    [terminalPanes.panes]
  )
  const gitKey = sessionId != null && sessionId !== ''
    ? ['chat-workspace-drawer-git', sessionId]
    : 'chat-workspace-drawer-git'
  const { data: repoState, isLoading: isGitLoading, mutate: mutateGitState } = useSWR<GitRepositoryState>(
    gitKey,
    () => sessionId != null && sessionId !== '' ? getSessionGitState(sessionId) : getWorkspaceGitState(),
    { refreshInterval: 3000, revalidateOnFocus: true }
  )
  const approvalMessages = useMemo(
    () => agentApprovals == null ? [] : getAgentRoomApprovalMessages(agentApprovals.room),
    [agentApprovals]
  )
  const runCommandTaskStatuses = useMemo<InteractionPanelRunCommandTaskStatus[]>(() =>
    bottomTerminalPanes
      .filter(pane => pane.runCommand != null)
      .map(pane => ({
        commandId: pane.runCommand!.commandId,
        isRunning: terminalPanes.runTaskRunningById[pane.id] === true,
        terminalId: pane.id
      })), [bottomTerminalPanes, terminalPanes.runTaskRunningById])
  const panelTabs = useInteractionPanelTabs({
    bottomPanel,
    canCreateSessionTab,
    terminalPanes,
    terminalSessionId,
    workspaceDrawerItems: workspaceDrawerCreateItems,
    language: pluginLanguage,
    t
  })
  const activateWorkspaceDrawerView = useCallback((view: WorkspaceDrawerView) => {
    onFoldChange(false)
    panelTabs.openWorkspaceDrawerView(view)
  }, [onFoldChange, panelTabs])
  const workspaceDrawerDockActions = useWorkspaceDrawerDockActions({
    onActivateView: activateWorkspaceDrawerView,
    onForceSync: mutateGitState,
    selectedFilePath: bottomPanel.selectedWorkspaceFilePath,
    t
  })
  const { getActionsForView } = workspaceDrawerDockActions
  const workspaceDrawerTabHeaderActionResolver = useCallback(({
    groupActiveTab,
    isTopRightGroup
  }: InteractionPanelDockTabHeaderActionContext): RouteContainerPanelDockActionItem[] => {
    if (groupActiveTab?.kind !== 'workspace-drawer') return []

    return getActionsForView({
      isTopRightGroup,
      view: groupActiveTab.view
    })
  }, [getActionsForView])
  const tabHeaderActionResolvers = useMemo<InteractionPanelTabHeaderActionResolver[]>(
    () => [workspaceDrawerTabHeaderActionResolver],
    [workspaceDrawerTabHeaderActionResolver]
  )
  const getTabHeaderActions = useCallback(
    (context: InteractionPanelDockTabHeaderActionContext) =>
      tabHeaderActionResolvers.flatMap(resolve => resolve(context)),
    [tabHeaderActionResolvers]
  )
  const pinnedTabs = useInteractionPanelPinnedTabs({
    maxPinnedTabs,
    tabs: panelTabs.tabs,
    terminalSessionId
  })
  const querySessionFocus = useInteractionPanelQuerySessionFocus()
  const handleAddMenuClick: NonNullable<MenuProps['onClick']> = (info) => {
    const pluginMenuKey = parseInteractionPanelPluginAddMenuKey(String(info.key))
    if (pluginMenuKey != null) {
      const item = pluginAddMenuItems.find(candidate =>
        candidate.pluginScope === pluginMenuKey.scope && candidate.id === pluginMenuKey.id
      )
      if (item == null) return

      onFoldChange(false)
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
      if (
        panelTabs.openPluginTab(item.pluginScope, item.tab ?? item.id, { fallbackToSingle: item.tab == null }) != null
      ) {
        return
      }
      void navigate(`/plugins/${item.pluginScope}/${item.id}`)
      return
    }

    if (info.key === 'resource') {
      onFoldChange(false)
      setIsOpenResourceDialogOpen(true)
      return
    }
    onFoldChange(false)
    panelTabs.handleAddMenuClick(info)
  }
  const handleWorkbenchCreateMenuClick: NonNullable<MenuProps['onClick']> = (info) => {
    const drawerView = parseWorkbenchDrawerViewMenuKey(String(info.key))
    if (drawerView != null) {
      onFoldChange(false)
      if (panelTabs.openWorkspaceDrawerView(drawerView) == null) {
        onWorkspaceDrawerCreateMenuClick?.(info)
      }
      return
    }

    handleAddMenuClick(info)
  }
  const handleAddPanelTab = (key: string) => {
    if (key === 'session' && !canCreateSessionTab) return

    onFoldChange(false)
    panelTabs.handleAddMenuClick({ key })
  }
  const handleNewTerminal = (
    shellKind?: TerminalShellKind,
    options: { initialCommand?: string; title?: string } = {}
  ) => {
    onFoldChange(false)
    panelTabs.addTerminal(shellKind, options)
  }
  const handleRunCommand = (command: InteractionPanelRunCommand) => {
    onFoldChange(false)
    const title = getInteractionPanelRunCommandTitle(command)
    const icon = getInteractionPanelRunCommandIcon(command)
    const script = buildInteractionPanelRunCommandScript(command)
    const taskScript = buildInteractionPanelRunCommandTaskScript(script)
    const existingPane = bottomTerminalPanes.find(pane => pane.runCommand?.commandId === command.id)
    if (existingPane != null) {
      const tab: InteractionPanelTab = {
        canClose: true,
        icon: existingPane.runCommand?.icon ?? icon,
        id: existingPane.id,
        kind: 'terminal' as const,
        label: existingPane.title,
        shellKind: existingPane.shellKind
      }
      panelTabs.activateTab(tab)
      pinnedTabs.pinTab(tab, { replaceOldest: true })
      const existingInfo = terminalPanes.infoById[existingPane.id]
      const isTaskRunning = terminalPanes.runTaskRunningById[existingPane.id] === true
      if (!isTaskRunning) {
        terminalPanes.restartTerminal(existingPane.id, taskScript, {
          restartRunning: existingInfo?.isExited === true
        })
      }
      return
    }

    const pane = panelTabs.addTerminal('default', {
      initialCommand: taskScript,
      runCommand: {
        commandId: command.id,
        icon,
        script,
        title
      },
      title
    })
    pinnedTabs.pinTab({
      canClose: true,
      icon,
      id: pane.id,
      kind: 'terminal',
      label: pane.title,
      shellKind: pane.shellKind
    }, { replaceOldest: true })
  }
  const handleNewWebPage = () => {
    onFoldChange(false)
    panelTabs.handleAddMenuClick({ key: 'iframe' })
  }
  const handleNewMobileDebugPage = () => {
    onFoldChange(false)
    panelTabs.handleAddMenuClick({ key: 'mobile-debug' })
  }
  const handleNewSession = () => handleAddPanelTab('session')
  const handleActivateTab = (tab: InteractionPanelTab) => {
    onFoldChange(false)
    panelTabs.activateTab(tab)
  }
  const handleOpenResourceDialog = () => {
    onFoldChange(false)
    setIsOpenResourceDialogOpen(true)
  }
  const handlePanelAction = () => {
    if (isFolded) {
      bottomPanel.handleCloseBottomPanel()
      return
    }
    onFoldChange(true)
  }
  const handlePanelClose = () => {
    bottomPanel.handleCloseBottomPanel()
  }
  const workspaceDrawerState = useMemo(() => ({
    agentApprovals,
    agentRoster,
    approvalMessages,
    changedLayout: workspaceDrawerDockActions.changedLayout,
    changedTreeCommand: workspaceDrawerDockActions.changedTreeCommand,
    isGitLoading,
    onOpenFile: bottomPanel.handleOpenWorkspaceFile,
    onReferencePaths: onReferenceWorkspacePaths,
    pluginTabs: pluginWorkbenchTabs,
    repoState,
    settingsView,
    treeRefreshKey: workspaceDrawerDockActions.treeRefreshKey,
    workspaceTreeCommand: workspaceDrawerDockActions.workspaceTreeCommand
  }), [
    agentApprovals,
    agentRoster,
    approvalMessages,
    bottomPanel.handleOpenWorkspaceFile,
    isGitLoading,
    onReferenceWorkspacePaths,
    pluginWorkbenchTabs,
    repoState,
    settingsView,
    workspaceDrawerDockActions.changedLayout,
    workspaceDrawerDockActions.changedTreeCommand,
    workspaceDrawerDockActions.treeRefreshKey,
    workspaceDrawerDockActions.workspaceTreeCommand
  ])

  useEffect(() => {
    const currentRequest = shortcutRequest ?? readPendingInteractionPanelShortcutRequest()
    if (currentRequest == null || handledShortcutRequestIdRef.current === currentRequest.id) {
      return
    }

    handledShortcutRequestIdRef.current = currentRequest.id
    if (currentRequest.action === 'open-browser-tab' || currentRequest.action === 'new-website') {
      handleNewWebPage()
    } else if (currentRequest.action === 'open-website') {
      onFoldChange(false)
      panelTabs.openIframeUrl(
        currentRequest.url,
        currentRequest.title == null ? undefined : { title: currentRequest.title }
      )
    } else if (currentRequest.action === 'new-terminal') {
      handleNewTerminal()
    } else if (currentRequest.action === 'run-command') {
      handleRunCommand(currentRequest.command)
    } else if (currentRequest.action === 'terminate-run-command-task') {
      terminalPanes.terminateTerminal(currentRequest.terminalId)
    } else if (currentRequest.action === 'open-terminal') {
      onFoldChange(false)
      const existingPane = terminalPanes.panes.find(pane => pane.id === currentRequest.terminalId)
      if (existingPane == null) {
        handleNewTerminal()
      } else {
        terminalPanes.setActiveTerminalId(currentRequest.terminalId)
        bottomPanel.handleSelectBottomPanelView('terminal')
        panelTabs.activateTab({
          canClose: true,
          icon: 'terminal',
          id: currentRequest.terminalId,
          kind: 'terminal',
          label: existingPane.title,
          shellKind: existingPane.shellKind
        })
      }
    } else if (currentRequest.action === 'new-session') {
      handleNewSession()
    } else if (currentRequest.action === 'open-session') {
      onFoldChange(false)
      panelTabs.openSessionPage(currentRequest.sessionId, currentRequest.title ?? currentRequest.sessionId)
    } else if (currentRequest.action === 'create-menu-item') {
      handleAddMenuClick({ key: currentRequest.menuKey } as Parameters<NonNullable<MenuProps['onClick']>>[0])
    }

    const pendingRequest = readPendingInteractionPanelShortcutRequest()
    if (pendingRequest?.id === currentRequest.id) {
      writePendingInteractionPanelShortcutRequest(null)
    }
    onShortcutRequestHandled?.(currentRequest.id)
  }, [
    bottomPanel,
    handleNewSession,
    handleNewTerminal,
    handleNewWebPage,
    handleRunCommand,
    onFoldChange,
    onShortcutRequestHandled,
    panelTabs,
    shortcutRequest,
    terminalPanes
  ])

  useEffect(() => {
    onRunCommandTaskStatusesChange?.(runCommandTaskStatuses)
  }, [onRunCommandTaskStatusesChange, runCommandTaskStatuses])

  useEffect(() => () => onRunCommandTaskStatusesChange?.([]), [onRunCommandTaskStatusesChange])

  useInteractionPanelShortcuts({
    enabled: isVisible,
    isMac,
    onNewIframe: handleNewWebPage,
    onNewTerminal: handleNewTerminal,
    onOpenResource: handleOpenResourceDialog
  })

  useInteractionPanelQuerySessionTab({
    enabled: canCreateSessionTab,
    onFoldChange,
    onOpenSessionPage: panelTabs.openSessionPage
  })

  return (
    <>
      <DockPanel
        allowFullscreen={!isCompactView}
        allowResize={!isCompactView}
        className='chat-interaction-panel'
        defaultHeight={isCompactView ? 208 : CHAT_BOTTOM_DOCK_DEFAULT_HEIGHT}
        closeIcon={isFolded ? 'close' : 'bottom_panel_close'}
        fullscreenEnterLabel={t('common.enterFullscreen')}
        fullscreenExitLabel={t('common.exitFullscreen')}
        fullscreenMinimizedIcon='bottom_panel_open'
        fullscreenMinimizedLabel={t('chat.interactionPanel.expandPanel')}
        isMinimized={isFolded}
        isOpen={isVisible}
        maxHeight={isCompactView ? 320 : CHAT_BOTTOM_DOCK_MAX_HEIGHT}
        minimizedHeight={CHAT_INTERACTION_PANEL_MINIMIZED_HEIGHT}
        minHeight={isCompactView ? 180 : CHAT_BOTTOM_DOCK_MIN_HEIGHT}
        hideHeader={true}
        closeLabel={t(isFolded ? 'chat.interactionPanel.hidePanel' : 'chat.interactionPanel.minimizePanel')}
        resizeLabel={t('chat.bottomPanelResizePanel')}
        storageKey={CHAT_BOTTOM_DOCK_HEIGHT_STORAGE_KEY}
        onClose={handlePanelAction}
        onExpandMinimized={() => onFoldChange(false)}
      >
        {({ isFullscreen, onToggleFullscreen }) => (
          <InteractionPanelContent
            activeTab={panelTabs.activeTab}
            activeSessionFocusRequestId={querySessionFocus.focusRequestId}
            activeSessionFocusSessionId={querySessionFocus.sessionId}
            bottomPanel={bottomPanel}
            canFullscreenPanel={!isCompactView}
            canCreateSessionTab={canCreateSessionTab}
            canPinMoreTabs={pinnedTabs.canPinMoreTabs}
            iframePages={panelTabs.iframePages}
            isPanelFullscreen={isFullscreen}
            isPanelMinimized={isFolded}
            isVisible={isVisible}
            markdownPreviewMode={markdownPreviewMode}
            mobileDebugPages={panelTabs.mobileDebugPages}
            pinnedTabs={pinnedTabs.pinnedTabs}
            tabs={panelTabs.tabs}
            projectUrlHistoryKey={projectUrlHistoryKey}
            sessionId={sessionId}
            sessionPages={panelTabs.sessionPages}
            sessionUrlHistoryKey={sessionUrlHistoryKey}
            terminalPanes={terminalPanes}
            terminalSessionId={terminalSessionId}
            workspaceDrawerCreateItems={workspaceDrawerCreateItems}
            workspaceDrawerCreateSelectedKeys={workspaceDrawerCreateSelectedKeys}
            workspaceDrawerState={workspaceDrawerState}
            workspaceRootPath={workspaceRootPath}
            getTabHeaderActions={getTabHeaderActions}
            onActivateTab={handleActivateTab}
            onCloseTab={panelTabs.handleCloseTab}
            onCloseTabGroup={panelTabs.handleCloseTabGroup}
            onEditPinnedTab={setEditingPinnedTab}
            onIframeMetadataChange={panelTabs.handleIframeMetadataChange}
            onIframeNavigateHistory={panelTabs.handleIframeNavigateHistory}
            onIframeSelectHistory={panelTabs.handleIframeSelectHistory}
            onIframeUrlChange={panelTabs.handleIframeUrlChange}
            onLocateWorkspacePath={onLocateWorkspacePath}
            onMarkdownPreviewModeChange={setMarkdownPreviewMode}
            onMobileDebugPageChange={panelTabs.updateMobileDebugPage}
            onAddMenuClick={handleWorkbenchCreateMenuClick}
            onNewSession={handleNewSession}
            onNewTerminal={handleNewTerminal}
            onNewWebPage={handleNewWebPage}
            onOpenIframeUrl={panelTabs.openIframeUrl}
            onNewMobileDebugPage={handleNewMobileDebugPage}
            onOpenResource={handleOpenResourceDialog}
            onPanelExpand={() => onFoldChange(false)}
            onPanelClose={handlePanelClose}
            onPanelAction={handlePanelAction}
            onPinTab={pinnedTabs.pinTab}
            onRunCommand={handleRunCommand}
            onSessionPageChange={panelTabs.updateSessionPage}
            onTogglePanelFullscreen={onToggleFullscreen}
            onUnpinTab={pinnedTabs.unpinTab}
          />
        )}
      </DockPanel>
      <InteractionPanelOpenResourceDialogHost
        bottomPanel={bottomPanel}
        iframePages={panelTabs.iframePages}
        open={isOpenResourceDialogOpen}
        projectUrlHistoryKey={projectUrlHistoryKey}
        recentFilePaths={recentFilePaths}
        sessionId={sessionId}
        sessionUrlHistoryKey={sessionUrlHistoryKey}
        onClose={() => setIsOpenResourceDialogOpen(false)}
        onFoldChange={onFoldChange}
        onOpenWebsite={panelTabs.openIframeUrl}
      />
      <InteractionPanelPinnedTabEditModal
        pinnedTab={editingPinnedTab}
        onClose={() => setEditingPinnedTab(null)}
        onSave={(edits) => {
          if (editingPinnedTab != null) pinnedTabs.updatePinnedTab(editingPinnedTab.tab, edits)
          setEditingPinnedTab(null)
        }}
      />
    </>
  )
}
