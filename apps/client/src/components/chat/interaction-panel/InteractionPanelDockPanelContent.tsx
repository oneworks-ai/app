import { useEffect, useState } from 'react'

import type { IDockviewPanelProps } from 'dockview'

import { ChatTerminalView } from '#~/components/chat/terminal/ChatTerminalView'
import '#~/components/chat/workspace-drawer/ChatWorkspaceDrawer.scss'
import { WorkspaceDrawerViewPanel } from '#~/components/chat/workspace-drawer/WorkspaceDrawerViewPanel'
import { WorkspaceFileEditorView } from '#~/components/chat/workspace-file-editor/WorkspaceFileEditorView'
import { PluginViewHost } from '#~/plugins/PluginHost'

import { InteractionPanelIframeView } from './InteractionPanelIframeView'
import { InteractionPanelMobileDebugView } from './InteractionPanelMobileDebugView'
import { InteractionPanelPageDebuggerListView } from './InteractionPanelPageDebuggerListView'
import { InteractionPanelRunCommandTaskView } from './InteractionPanelRunCommandTaskView'
import { InteractionPanelSessionView } from './InteractionPanelSessionView'
import { useInteractionPanelDockContext } from './interaction-panel-dock-context'

const useDockPanelVisibility = (api: IDockviewPanelProps['api']) => {
  const [isPanelVisible, setIsPanelVisible] = useState(() => api.isVisible)

  useEffect(() => {
    setIsPanelVisible(api.isVisible)
    const disposable = api.onDidVisibilityChange(() => {
      setIsPanelVisible(api.isVisible)
    })
    return () => disposable.dispose()
  }, [api])

  return isPanelVisible
}

export function InteractionPanelDockPanelContentBody({
  isPanelVisible,
  tabId
}: {
  isPanelVisible: boolean
  tabId: string
}) {
  const {
    activeTab,
    activeSessionFocusRequestId,
    activeSessionFocusSessionId,
    bottomPanel,
    iframePages,
    isVisible,
    markdownPreviewMode,
    mobileDebugPages,
    projectUrlHistoryKey,
    sessionId,
    sessionPages,
    sessionUrlHistoryKey,
    tabById,
    terminalPanes,
    terminalSessionId,
    workspaceDrawerState,
    workspaceFileFocusRequest,
    workspaceRootPath,
    onIframeMetadataChange,
    onIframePageChange,
    onIframeNavigateHistory,
    onIframeSelectHistory,
    onIframeUrlChange,
    onLocateWorkspacePath,
    onMobileDebugPageChange,
    onWorkspaceFileCommentDraftStateChange,
    onCloseWorkspaceFilePaths,
    onOpenIframeUrl,
    onPluginTabStateChange,
    onReferenceAnnotations,
    onReferenceFileComments,
    hasPendingAnnotationReferences,
    pendingAnnotationPreview,
    pendingAnnotations,
    pendingFileComments,
    onSelectWorkspaceFilePath,
    onSessionPageChange
  } = useInteractionPanelDockContext()
  const tab = tabById[tabId]

  if (tab == null) {
    return null
  }

  const contentClassName = `chat-interaction-panel__dock-panel-content ${isPanelVisible ? 'is-visible' : 'is-hidden'}`

  if (tab.kind === 'terminal') {
    const pane = terminalPanes.panes.find(item => item.id === tab.id)
    if (pane == null) return null
    if (pane.runCommand != null) {
      return (
        <div className={contentClassName}>
          <InteractionPanelRunCommandTaskView
            activeTerminalId={isPanelVisible ? pane.id : ''}
            pane={pane}
            sessionId={terminalSessionId}
            terminalPanes={terminalPanes}
          />
        </div>
      )
    }

    return (
      <div className={contentClassName}>
        <ChatTerminalView
          activeTerminalId={isPanelVisible ? pane.id : ''}
          panes={[pane]}
          sessionId={terminalSessionId}
          onExit={terminalPanes.closeTerminal}
          onInfoChange={terminalPanes.handleInfoChange}
          onInitialCommandSent={terminalPanes.markInitialCommandSent}
          onRestartChange={terminalPanes.handleRestartChange}
          onTerminateChange={terminalPanes.handleTerminateChange}
        />
      </div>
    )
  }

  if (tab.kind === 'file') {
    const closeFilePathsToRight = (path: string) => {
      const tabIndex = bottomPanel.openWorkspaceFilePaths.indexOf(path)
      if (tabIndex < 0) return
      onCloseWorkspaceFilePaths(bottomPanel.openWorkspaceFilePaths.slice(tabIndex + 1))
    }

    return (
      <div className={contentClassName}>
        <WorkspaceFileEditorView
          variant='content'
          showTabs={false}
          isOpen={isVisible && activeTab.kind === 'file' && activeTab.path === tab.path}
          markdownPreviewMode={markdownPreviewMode}
          openPaths={bottomPanel.openWorkspaceFilePaths}
          path={tab.path}
          sessionId={sessionId}
          workspaceRootPath={workspaceRootPath}
          focusRequest={workspaceFileFocusRequest?.path === tab.path ? workspaceFileFocusRequest : null}
          pendingFileComments={pendingFileComments}
          onCommentDraftStateChange={onWorkspaceFileCommentDraftStateChange}
          onClose={() => onCloseWorkspaceFilePaths([tab.path])}
          onCloseAllPaths={() => onCloseWorkspaceFilePaths(bottomPanel.openWorkspaceFilePaths)}
          onCloseOtherPaths={path =>
            onCloseWorkspaceFilePaths(bottomPanel.openWorkspaceFilePaths.filter(item => item !== path))}
          onClosePath={path => onCloseWorkspaceFilePaths([path])}
          onClosePathsToRight={closeFilePathsToRight}
          onLocatePath={onLocateWorkspacePath}
          onReferenceFileComments={onReferenceFileComments}
          onReferenceWorkspacePaths={workspaceDrawerState.onReferencePaths}
          onSelectPath={onSelectWorkspaceFilePath}
        />
      </div>
    )
  }

  if (tab.kind === 'session') {
    const page = sessionPages.find(item => item.id === tab.id)
    if (page == null) return null
    const shouldUseQueryFocus = activeSessionFocusRequestId != null &&
      (activeSessionFocusSessionId == null ||
        page.sessionId == null ||
        page.sessionId === activeSessionFocusSessionId)
    const autoFocusRequestId = shouldUseQueryFocus ? activeSessionFocusRequestId : page.focusRequestId
    return (
      <div className={contentClassName}>
        <InteractionPanelSessionView
          autoFocusRequestId={isPanelVisible ? autoFocusRequestId : undefined}
          page={page}
          sourceSessionId={sessionId}
          onChangePage={(updater) => onSessionPageChange(page.id, updater)}
        />
      </div>
    )
  }

  if (tab.kind === 'mobile-debug') {
    const page = mobileDebugPages.find(item => item.id === tab.id)
    if (page == null) return null
    return (
      <div className={contentClassName}>
        <InteractionPanelMobileDebugView
          isActive={activeTab.kind === 'mobile-debug' && activeTab.id === tab.id}
          page={page}
          onChangePage={(updater) => onMobileDebugPageChange(page.id, updater)}
          onOpenDebugUrl={onOpenIframeUrl}
        />
      </div>
    )
  }

  if (tab.kind === 'page-debugger') {
    return (
      <div className={contentClassName}>
        <InteractionPanelPageDebuggerListView
          isActive={activeTab.kind === 'page-debugger' && activeTab.id === tab.id}
        />
      </div>
    )
  }

  if (tab.kind === 'plugin') {
    return (
      <div className={contentClassName}>
        <PluginViewHost
          scope={tab.pluginScope}
          routeId={tab.tabId}
          surface='workbench'
          tab={{
            id: tab.id,
            setState: nextState => onPluginTabStateChange(tab.id, nextState),
            state: tab.state
          }}
          viewId={tab.viewId}
        />
      </div>
    )
  }

  if (tab.kind === 'workspace-drawer') {
    return (
      <div className={contentClassName}>
        <WorkspaceDrawerViewPanel
          activeView={tab.view}
          agentApprovals={workspaceDrawerState.agentApprovals}
          agentRoster={workspaceDrawerState.agentRoster}
          approvalMessages={workspaceDrawerState.approvalMessages}
          changedLayout={workspaceDrawerState.changedLayout}
          changedTreeCommand={workspaceDrawerState.changedTreeCommand}
          isGitLoading={workspaceDrawerState.isGitLoading}
          pluginTabs={workspaceDrawerState.pluginTabs}
          repoState={workspaceDrawerState.repoState}
          selectedFilePath={bottomPanel.selectedWorkspaceFilePath}
          settingsView={workspaceDrawerState.settingsView}
          sessionId={sessionId}
          treeRefreshKey={workspaceDrawerState.treeRefreshKey}
          workspaceTreeCommand={workspaceDrawerState.workspaceTreeCommand}
          onOpenFile={workspaceDrawerState.onOpenFile}
          onReferencePaths={workspaceDrawerState.onReferencePaths}
        />
      </div>
    )
  }

  const page = iframePages.find(item => item.id === tab.id)
  if (page == null) {
    return null
  }

  return (
    <div className={contentClassName}>
      <InteractionPanelIframeView
        isActive={activeTab.kind === 'iframe' && activeTab.id === tab.id}
        page={page}
        onChangePage={(updater) => onIframePageChange(page.id, updater)}
        projectUrlHistoryKey={projectUrlHistoryKey}
        sessionId={sessionId}
        sessionUrlHistoryKey={sessionUrlHistoryKey}
        onChangeMetadata={onIframeMetadataChange}
        onSelectHistory={onIframeSelectHistory}
        onChangeUrl={onIframeUrlChange}
        onNavigateHistory={onIframeNavigateHistory}
        onReferenceAnnotations={onReferenceAnnotations}
        hasPendingAnnotationReferences={hasPendingAnnotationReferences}
        pendingAnnotationPreview={pendingAnnotationPreview}
        pendingAnnotations={pendingAnnotations}
      />
    </div>
  )
}

export function InteractionPanelDockPanelContent({ api, params }: IDockviewPanelProps<{ tabId: string }>) {
  const isPanelVisible = useDockPanelVisibility(api)

  return <InteractionPanelDockPanelContentBody isPanelVisible={isPanelVisible} tabId={params.tabId} />
}
