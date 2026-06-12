/* eslint-disable max-lines -- interaction panel content maps the shared dock contract to each tab family in one place. */
import type { MenuProps } from 'antd'

import type { TerminalShellKind } from '@oneworks/types'

import type { WorkspaceDrawerViewItem } from '#~/components/chat/workspace-drawer/workspace-drawer-view-items'
import type { WorkspaceMarkdownPreviewMode } from '#~/components/chat/workspace-file-editor/workspace-file-editor-language'
import type { RouteContainerPanelDockActionItem } from '#~/components/layout/RouteContainerPanelTabs'
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
  canCreateSessionTab,
  canFullscreenPanel,
  canPinMoreTabs,
  iframePages,
  isPanelFullscreen,
  isPanelMinimized,
  isVisible,
  markdownPreviewMode,
  mobileDebugPages,
  pinnedTabs,
  tabs,
  onActivateTab,
  onCloseTab,
  onCloseTabGroup,
  onIframeUrlChange,
  onIframeMetadataChange,
  onIframeNavigateHistory,
  onIframeSelectHistory,
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
  workspaceRootPath,
  getTabHeaderActions,
  onEditPinnedTab,
  onNewSession,
  onNewMobileDebugPage,
  onPinTab,
  onRunCommand,
  onSessionPageChange,
  onTogglePanelFullscreen,
  onUnpinTab
}: {
  activeTab: ActiveInteractionTab | null
  activeSessionFocusRequestId?: string
  activeSessionFocusSessionId?: string
  bottomPanel: ChatRouteBottomPanelState
  canCreateSessionTab: boolean
  canFullscreenPanel: boolean
  canPinMoreTabs: boolean
  iframePages: InteractionPanelIframePage[]
  isPanelFullscreen: boolean
  isPanelMinimized: boolean
  isVisible: boolean
  markdownPreviewMode: WorkspaceMarkdownPreviewMode
  mobileDebugPages: InteractionPanelMobileDebugPage[]
  pinnedTabs: InteractionPanelPinnedTab[]
  tabs: InteractionPanelTab[]
  onIframeUrlChange: (pageId: string, url: string) => void
  onIframeMetadataChange: (pageId: string, metadata: { faviconUrl?: string; title?: string }) => void
  onIframeNavigateHistory: (pageId: string, delta: -1 | 1) => void
  onIframeSelectHistory: (pageId: string, index: number) => void
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
  workspaceRootPath?: string
  getTabHeaderActions?: (
    context: InteractionPanelDockTabHeaderActionContext
  ) => RouteContainerPanelDockActionItem[]
  onActivateTab: (tab: InteractionPanelTab) => void
  onCloseTab: (tab: InteractionPanelTab) => void
  onCloseTabGroup: (tab: InteractionPanelTab, scope: InteractionPanelTabCloseScope) => void
  onEditPinnedTab: (tab: InteractionPanelPinnedTab) => void
  onNewSession: () => void
  onNewMobileDebugPage: () => void
  onPinTab: (tab: InteractionPanelTab) => void
  onRunCommand: (command: InteractionPanelRunCommand) => void
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
      markdownPreviewMode={markdownPreviewMode}
      mobileDebugPages={mobileDebugPages}
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
      workspaceRootPath={workspaceRootPath}
      getTabHeaderActions={getTabHeaderActions}
      onActivateTab={onActivateTab}
      onCloseTab={onCloseTab}
      onCloseTabGroup={onCloseTabGroup}
      onEditPinnedTab={onEditPinnedTab}
      onIframeMetadataChange={onIframeMetadataChange}
      onIframeNavigateHistory={onIframeNavigateHistory}
      onIframeSelectHistory={onIframeSelectHistory}
      onIframeUrlChange={onIframeUrlChange}
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
      onRunCommand={onRunCommand}
      onSessionPageChange={onSessionPageChange}
      onTogglePanelFullscreen={onTogglePanelFullscreen}
      onUnpinTab={onUnpinTab}
    />
  )
}
