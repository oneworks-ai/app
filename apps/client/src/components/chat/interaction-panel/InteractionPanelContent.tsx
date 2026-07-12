/* eslint-disable max-lines -- interaction panel content maps the shared dock contract to each tab family in one place. */
import type { MenuProps } from 'antd'

import type { TerminalShellKind } from '@oneworks/types'

import type {
  PendingAnnotation,
  PendingAnnotationPreviewState,
  PendingFileComment
} from '#~/components/chat/sender/@types/sender-composer'
import type { WorkspaceDrawerViewItem } from '#~/components/chat/workspace-drawer/workspace-drawer-view-items'
import type { WorkspaceMarkdownPreviewMode } from '#~/components/chat/workspace-file-editor/workspace-file-editor-language'
import type { WorkspaceFileFocusRequest } from '#~/components/chat/workspace-file-editor/workspace-file-focus-request'
import type {
  RouteContainerPanelDockActionItem,
  RouteContainerPanelDockLayout
} from '#~/components/layout/RouteContainerPanelTabs'
import type { ChatRouteBottomPanelState } from '#~/hooks/chat/use-chat-route-bottom-panel'

import { InteractionPanelDockWorkspace } from './InteractionPanelDockWorkspace'
import type {
  InteractionPanelDockTabHeaderActionContext,
  InteractionPanelWorkspaceDrawerState
} from './InteractionPanelDockWorkspace.types'
import { InteractionPanelEmptyDockWorkspace } from './InteractionPanelEmptyDockWorkspace'
import type { InteractionPanelIframePage } from './InteractionPanelIframeView'
import type { OpenInteractionPanelIframeUrlOptions } from './interaction-panel-iframe-pages'
import type { InteractionPanelMobileDebugPage } from './interaction-panel-mobile-debug-pages'
import type { InteractionPanelPinnedTab } from './interaction-panel-pinned-tabs'
import type { InteractionPanelRunCommand } from './interaction-panel-run-commands'
import type { InteractionPanelSessionPage } from './interaction-panel-session-pages'
import type { InteractionPanelTabCloseScope } from './interaction-panel-tab-groups'
import type { ActiveInteractionTab, InteractionPanelTab } from './interaction-panel-tabs'
import type { useInteractionTerminalPanes } from './use-interaction-terminal-panes'

export function InteractionPanelContent({
  activeTab,
  activeSessionFocusRequestId,
  activeSessionFocusSessionId,
  bottomPanel,
  hasPendingAnnotationReferences,
  canCreateSessionTab,
  canFullscreenPanel,
  canPinMoreTabs,
  iframePages,
  isPanelFullscreen,
  isPanelMinimized,
  isVisible,
  layout,
  markdownPreviewMode,
  mobileDebugPages,
  openResourceShortcut,
  openResourceShortcutLabel,
  pendingAnnotationPreview,
  pendingAnnotations,
  pendingFileComments,
  pinnedTabs,
  tabs,
  onActivateTab,
  onCloseTab,
  onCloseTabGroup,
  onCloseWorkspaceFilePaths,
  onIframeUrlChange,
  onIframeMetadataChange,
  onIframePageChange,
  onIframeNavigateHistory,
  onIframeSelectHistory,
  onLayoutChange,
  onLocateWorkspacePath,
  onMarkdownPreviewModeChange,
  onMobileDebugPageChange,
  onAddMenuClick,
  onNewTerminal,
  onNewWebPage,
  onOpenIframeUrl,
  onOpenResource,
  onPanelExpand,
  onPanelClose,
  onPanelAction,
  projectUrlHistoryKey,
  sessionId,
  sessionPages,
  sessionUrlHistoryKey,
  terminalPanes,
  terminalSessionId,
  workspaceDrawerCreateItems,
  workspaceDrawerCreateSelectedKeys,
  workspaceDrawerState,
  workspaceFileFocusRequest,
  workspaceRootPath,
  getTabHeaderActions,
  onEditPinnedTab,
  onNewSession,
  onNewMobileDebugPage,
  onPinTab,
  onPluginTabStateChange,
  onRunCommand,
  onReferenceAnnotations,
  onReferenceFileComments,
  onSelectWorkspaceFilePath,
  onSessionPageChange,
  onTogglePanelFullscreen,
  onUnpinTab
}: {
  activeTab: ActiveInteractionTab | null
  activeSessionFocusRequestId?: string
  activeSessionFocusSessionId?: string
  bottomPanel: ChatRouteBottomPanelState
  hasPendingAnnotationReferences?: boolean
  canCreateSessionTab: boolean
  canFullscreenPanel: boolean
  canPinMoreTabs: boolean
  iframePages: InteractionPanelIframePage[]
  isPanelFullscreen: boolean
  isPanelMinimized: boolean
  isVisible: boolean
  layout?: RouteContainerPanelDockLayout | null
  markdownPreviewMode: WorkspaceMarkdownPreviewMode
  mobileDebugPages: InteractionPanelMobileDebugPage[]
  openResourceShortcut?: string
  openResourceShortcutLabel?: string
  pendingAnnotationPreview?: PendingAnnotationPreviewState
  pendingAnnotations?: PendingAnnotation[]
  pendingFileComments?: PendingFileComment[]
  pinnedTabs: InteractionPanelPinnedTab[]
  tabs: InteractionPanelTab[]
  onIframeUrlChange: (pageId: string, url: string) => void
  onIframeMetadataChange: (pageId: string, metadata: { faviconUrl?: string; title?: string }) => void
  onIframePageChange: (
    pageId: string,
    updater: (page: InteractionPanelIframePage) => InteractionPanelIframePage
  ) => void
  onIframeNavigateHistory: (pageId: string, delta: -1 | 1) => void
  onIframeSelectHistory: (pageId: string, index: number) => void
  onLayoutChange?: (layout: RouteContainerPanelDockLayout) => void
  onLocateWorkspacePath: (path: string) => void
  onMarkdownPreviewModeChange: (mode: WorkspaceMarkdownPreviewMode) => void
  onMobileDebugPageChange: (
    pageId: string,
    updater: (page: InteractionPanelMobileDebugPage) => InteractionPanelMobileDebugPage
  ) => void
  onAddMenuClick: NonNullable<MenuProps['onClick']>
  onNewTerminal: (shellKind?: TerminalShellKind) => void
  onNewWebPage: () => void
  onOpenIframeUrl: (url: string, options?: OpenInteractionPanelIframeUrlOptions) => void
  onOpenResource: () => void
  onPanelExpand: () => void
  onPanelClose: () => void
  onPanelAction: () => void
  projectUrlHistoryKey: string
  sessionId?: string
  sessionPages: InteractionPanelSessionPage[]
  sessionUrlHistoryKey: string
  terminalPanes: ReturnType<typeof useInteractionTerminalPanes>
  terminalSessionId: string
  workspaceDrawerCreateItems?: WorkspaceDrawerViewItem[]
  workspaceDrawerCreateSelectedKeys?: string[]
  workspaceDrawerState: InteractionPanelWorkspaceDrawerState
  workspaceFileFocusRequest?: WorkspaceFileFocusRequest | null
  workspaceRootPath?: string
  getTabHeaderActions?: (
    context: InteractionPanelDockTabHeaderActionContext
  ) => RouteContainerPanelDockActionItem[]
  onActivateTab: (tab: InteractionPanelTab) => void
  onCloseTab: (tab: InteractionPanelTab) => void
  onCloseTabGroup: (tab: InteractionPanelTab, scope: InteractionPanelTabCloseScope) => void
  onCloseWorkspaceFilePaths: (paths: string[]) => void
  onEditPinnedTab: (tab: InteractionPanelPinnedTab) => void
  onNewSession: () => void
  onNewMobileDebugPage: () => void
  onPinTab: (tab: InteractionPanelTab) => void
  onPluginTabStateChange: (tabId: string, state: unknown) => void
  onRunCommand: (command: InteractionPanelRunCommand) => void
  onReferenceAnnotations?: (annotations: PendingAnnotation[]) => void
  onReferenceFileComments?: (comments: PendingFileComment[]) => void
  onSelectWorkspaceFilePath: (path: string) => void
  onSessionPageChange: (
    pageId: string,
    updater: (page: InteractionPanelSessionPage) => InteractionPanelSessionPage
  ) => void
  onTogglePanelFullscreen: () => void
  onUnpinTab: (tab: InteractionPanelTab) => void
}) {
  const hasPanelContent = activeTab != null && tabs.length > 0

  if (!hasPanelContent) {
    return (
      <InteractionPanelEmptyDockWorkspace
        canCreateSessionTab={canCreateSessionTab}
        canFullscreenPanel={canFullscreenPanel}
        isPanelFullscreen={isPanelFullscreen}
        isPanelMinimized={isPanelMinimized}
        openResourceShortcut={openResourceShortcut}
        openResourceShortcutLabel={openResourceShortcutLabel}
        onAddMenuClick={onAddMenuClick}
        onNewSession={onNewSession}
        onNewMobileDebugPage={onNewMobileDebugPage}
        onNewTerminal={onNewTerminal}
        onNewWebPage={onNewWebPage}
        onOpenResource={onOpenResource}
        onPanelExpand={onPanelExpand}
        onPanelClose={onPanelClose}
        onPanelAction={onPanelAction}
        onTogglePanelFullscreen={onTogglePanelFullscreen}
        workspaceDrawerCreateItems={workspaceDrawerCreateItems}
        workspaceDrawerCreateSelectedKeys={workspaceDrawerCreateSelectedKeys}
      />
    )
  }

  return (
    <InteractionPanelDockWorkspace
      activeTab={activeTab}
      activeSessionFocusRequestId={activeSessionFocusRequestId}
      activeSessionFocusSessionId={activeSessionFocusSessionId}
      bottomPanel={bottomPanel}
      canCreateSessionTab={canCreateSessionTab}
      canFullscreenPanel={canFullscreenPanel}
      canPinMoreTabs={canPinMoreTabs}
      iframePages={iframePages}
      isPanelFullscreen={isPanelFullscreen}
      isPanelMinimized={isPanelMinimized}
      isVisible={isVisible}
      layout={layout}
      markdownPreviewMode={markdownPreviewMode}
      mobileDebugPages={mobileDebugPages}
      openResourceShortcut={openResourceShortcut}
      pinnedTabs={pinnedTabs}
      projectUrlHistoryKey={projectUrlHistoryKey}
      sessionId={sessionId}
      sessionPages={sessionPages}
      sessionUrlHistoryKey={sessionUrlHistoryKey}
      tabs={tabs}
      terminalPanes={terminalPanes}
      terminalSessionId={terminalSessionId}
      workspaceDrawerCreateItems={workspaceDrawerCreateItems}
      workspaceDrawerCreateSelectedKeys={workspaceDrawerCreateSelectedKeys}
      workspaceDrawerState={workspaceDrawerState}
      workspaceFileFocusRequest={workspaceFileFocusRequest}
      workspaceRootPath={workspaceRootPath}
      getTabHeaderActions={getTabHeaderActions}
      onActivateTab={onActivateTab}
      onCloseTab={onCloseTab}
      onCloseTabGroup={onCloseTabGroup}
      onCloseWorkspaceFilePaths={onCloseWorkspaceFilePaths}
      onEditPinnedTab={onEditPinnedTab}
      onIframeMetadataChange={onIframeMetadataChange}
      onIframePageChange={onIframePageChange}
      onIframeNavigateHistory={onIframeNavigateHistory}
      onIframeSelectHistory={onIframeSelectHistory}
      onIframeUrlChange={onIframeUrlChange}
      onLayoutChange={onLayoutChange}
      onLocateWorkspacePath={onLocateWorkspacePath}
      onMarkdownPreviewModeChange={onMarkdownPreviewModeChange}
      onMobileDebugPageChange={onMobileDebugPageChange}
      onAddMenuClick={onAddMenuClick}
      onNewSession={onNewSession}
      onNewTerminal={onNewTerminal}
      onOpenIframeUrl={onOpenIframeUrl}
      onPanelExpand={onPanelExpand}
      onPanelClose={onPanelClose}
      onPanelAction={onPanelAction}
      onPinTab={onPinTab}
      onPluginTabStateChange={onPluginTabStateChange}
      onRunCommand={onRunCommand}
      onReferenceAnnotations={onReferenceAnnotations}
      onReferenceFileComments={onReferenceFileComments}
      hasPendingAnnotationReferences={hasPendingAnnotationReferences}
      pendingAnnotationPreview={pendingAnnotationPreview}
      pendingAnnotations={pendingAnnotations}
      pendingFileComments={pendingFileComments}
      onSelectWorkspaceFilePath={onSelectWorkspaceFilePath}
      onSessionPageChange={onSessionPageChange}
      onTogglePanelFullscreen={onTogglePanelFullscreen}
      onUnpinTab={onUnpinTab}
    />
  )
}
