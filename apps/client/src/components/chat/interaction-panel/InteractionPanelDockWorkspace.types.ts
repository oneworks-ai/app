import type { MenuProps } from 'antd'
import type { ReactNode } from 'react'

import type { GitRepositoryState, TerminalShellKind } from '@oneworks/types'

import type { AgentRoomMessageView } from '#~/components/agent-room/@types/agent-room-view'
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
import type { ContextPickerFile } from '#~/components/workspace/context-file-types'
import type { ProjectFileTreeCommand } from '#~/components/workspace/project-file-tree/project-file-tree-types'
import type { ChatRouteBottomPanelState } from '#~/hooks/chat/use-chat-route-bottom-panel'
import type { PluginContributionWorkbenchTab } from '#~/plugins/plugin-manifest'

import type {
  ChatWorkspaceDrawerAgentApprovals,
  ChatWorkspaceDrawerAgentRoster
} from '../workspace-drawer/ChatWorkspaceDrawer'
import type { ChangedFilesLayout, ChangedTreeCommand } from '../workspace-drawer/changed-files-model'
import type { InteractionPanelIframePage } from './InteractionPanelIframeView'
import type { OpenInteractionPanelIframeUrlOptions } from './interaction-panel-iframe-pages'
import type { InteractionPanelMobileDebugPage } from './interaction-panel-mobile-debug-pages'
import type { InteractionPanelPinnedTab } from './interaction-panel-pinned-tabs'
import type { InteractionPanelRunCommand } from './interaction-panel-run-commands'
import type { InteractionPanelSessionPage } from './interaction-panel-session-pages'
import type { InteractionPanelTabCloseScope } from './interaction-panel-tab-groups'
import type { ActiveInteractionTab, InteractionPanelTab } from './interaction-panel-tabs'
import type { useInteractionTerminalPanes } from './use-interaction-terminal-panes'

export interface InteractionPanelWorkspaceDrawerState {
  agentApprovals?: ChatWorkspaceDrawerAgentApprovals
  agentRoster?: ChatWorkspaceDrawerAgentRoster
  approvalMessages: AgentRoomMessageView[]
  changedLayout: ChangedFilesLayout
  changedTreeCommand: ChangedTreeCommand | null
  isGitLoading: boolean
  pluginTabs?: Array<PluginContributionWorkbenchTab & { pluginScope: string }>
  repoState?: GitRepositoryState
  settingsView?: ReactNode
  treeRefreshKey: number
  workspaceTreeCommand: ProjectFileTreeCommand | null
  onOpenFile?: (path: string) => void
  onReferencePaths?: (files: ContextPickerFile[]) => void
}

export interface InteractionPanelDockTabHeaderActionContext {
  activeTab: ActiveInteractionTab
  groupActiveTab?: InteractionPanelTab
  groupActiveTabKey: string | null
  isTopRightGroup: boolean
}

export interface InteractionPanelDockWorkspaceProps {
  activeTab: ActiveInteractionTab
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
  layout?: RouteContainerPanelDockLayout | null
  hasPendingAnnotationReferences?: boolean
  markdownPreviewMode: WorkspaceMarkdownPreviewMode
  mobileDebugPages: InteractionPanelMobileDebugPage[]
  pinnedTabs: InteractionPanelPinnedTab[]
  projectUrlHistoryKey: string
  sessionId?: string
  sessionPages: InteractionPanelSessionPage[]
  sessionUrlHistoryKey: string
  tabs: InteractionPanelTab[]
  terminalPanes: ReturnType<typeof useInteractionTerminalPanes>
  terminalSessionId: string
  workspaceDrawerCreateItems?: WorkspaceDrawerViewItem[]
  workspaceDrawerCreateSelectedKeys?: string[]
  workspaceDrawerState: InteractionPanelWorkspaceDrawerState
  workspaceFileFocusRequest?: WorkspaceFileFocusRequest | null
  workspaceRootPath?: string
  openResourceShortcut?: string
  /**
   * Route-owned extension point for tab-specific group header actions.
   *
   * The dock resolves this for the active tab of each Dockview group, so actions
   * follow a tab when it moves between bottom and side workspaces. Use this
   * instead of placing tab actions in a fixed parent header. When multiple
   * feature families need actions, aggregate them as resolvers in the route
   * owner and keep this component unaware of business-specific tab kinds.
   */
  getTabHeaderActions?: (
    context: InteractionPanelDockTabHeaderActionContext
  ) => RouteContainerPanelDockActionItem[]
  onActivateTab: (tab: InteractionPanelTab) => void
  onAddMenuClick: NonNullable<MenuProps['onClick']>
  onCloseTab: (tab: InteractionPanelTab) => void
  onCloseTabGroup: (tab: InteractionPanelTab, scope: InteractionPanelTabCloseScope) => void
  onCloseWorkspaceFilePaths: (paths: string[]) => void
  onEditPinnedTab: (tab: InteractionPanelPinnedTab) => void
  onIframeMetadataChange: (pageId: string, metadata: { faviconUrl?: string; title?: string }) => void
  onIframePageChange: (
    pageId: string,
    updater: (page: InteractionPanelIframePage) => InteractionPanelIframePage
  ) => void
  onIframeNavigateHistory: (pageId: string, delta: -1 | 1) => void
  onIframeSelectHistory: (pageId: string, index: number) => void
  onIframeUrlChange: (pageId: string, url: string) => void
  onLayoutChange?: (layout: RouteContainerPanelDockLayout) => void
  onLocateWorkspacePath: (path: string) => void
  onMarkdownPreviewModeChange: (mode: WorkspaceMarkdownPreviewMode) => void
  onMobileDebugPageChange: (
    pageId: string,
    updater: (page: InteractionPanelMobileDebugPage) => InteractionPanelMobileDebugPage
  ) => void
  onNewSession: () => void
  onNewTerminal: (shellKind?: TerminalShellKind) => void
  onOpenIframeUrl: (url: string, options?: OpenInteractionPanelIframeUrlOptions) => void
  onPanelExpand: () => void
  onPanelClose: () => void
  onPanelAction: () => void
  onPinTab: (tab: InteractionPanelTab) => void
  onPluginTabStateChange: (tabId: string, state: unknown) => void
  onRunCommand: (command: InteractionPanelRunCommand) => void
  onReferenceAnnotations?: (annotations: PendingAnnotation[]) => void
  onReferenceFileComments?: (comments: PendingFileComment[]) => void
  pendingAnnotationPreview?: PendingAnnotationPreviewState
  pendingAnnotations?: PendingAnnotation[]
  pendingFileComments?: PendingFileComment[]
  onSelectWorkspaceFilePath: (path: string) => void
  onSessionPageChange: (
    pageId: string,
    updater: (page: InteractionPanelSessionPage) => InteractionPanelSessionPage
  ) => void
  onTogglePanelFullscreen: () => void
  onUnpinTab: (tab: InteractionPanelTab) => void
}
