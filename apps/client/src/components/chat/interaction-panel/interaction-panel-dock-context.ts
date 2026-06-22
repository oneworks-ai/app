import type { MenuProps } from 'antd'
import { createContext, useContext } from 'react'

import type { TerminalShellKind } from '@oneworks/types'

import type { PendingAnnotation, PendingAnnotationPreviewState } from '#~/components/chat/sender/@types/sender-composer'
import type { WorkspaceMarkdownPreviewMode } from '#~/components/chat/workspace-file-editor/workspace-file-editor-language'
import type { ChatRouteBottomPanelState } from '#~/hooks/chat/use-chat-route-bottom-panel'

import type { InteractionPanelWorkspaceDrawerState } from './InteractionPanelDockWorkspace.types'
import type { InteractionPanelIframePage } from './InteractionPanelIframeView'
import type { OpenInteractionPanelIframeUrlOptions } from './interaction-panel-iframe-pages'
import type { InteractionPanelMobileDebugPage } from './interaction-panel-mobile-debug-pages'
import type { InteractionPanelPinnedTab } from './interaction-panel-pinned-tabs'
import type { InteractionPanelRunCommand } from './interaction-panel-run-commands'
import type { InteractionPanelSessionPage } from './interaction-panel-session-pages'
import type { InteractionPanelTabCloseScope } from './interaction-panel-tab-groups'
import type { ActiveInteractionTab, InteractionPanelTab } from './interaction-panel-tabs'
import type { useInteractionTerminalPanes } from './use-interaction-terminal-panes'

export interface InteractionPanelDockContextValue {
  activeTab: ActiveInteractionTab
  activeSessionFocusRequestId?: string
  activeSessionFocusSessionId?: string
  bottomPanel: ChatRouteBottomPanelState
  canCreateSessionTab: boolean
  canFullscreenPanel: boolean
  canPinMoreTabs: boolean
  iframePages: InteractionPanelIframePage[]
  hasPendingAnnotationReferences?: boolean
  isPanelFullscreen: boolean
  isVisible: boolean
  markdownPreviewMode: WorkspaceMarkdownPreviewMode
  mobileDebugPages: InteractionPanelMobileDebugPage[]
  pinnedTabs: InteractionPanelPinnedTab[]
  pinnedTabById: Record<string, InteractionPanelPinnedTab>
  projectUrlHistoryKey: string
  sessionId?: string
  sessionPages: InteractionPanelSessionPage[]
  sessionUrlHistoryKey: string
  tabById: Record<string, InteractionPanelTab>
  terminalPanes: ReturnType<typeof useInteractionTerminalPanes>
  terminalSessionId: string
  workspaceDrawerState: InteractionPanelWorkspaceDrawerState
  workspaceRootPath?: string
  onAddMenuClick: NonNullable<MenuProps['onClick']>
  onCloseTab: (tab: InteractionPanelTab) => void
  onCloseTabGroup: (tab: InteractionPanelTab, scope: InteractionPanelTabCloseScope) => void
  onCloseWorkspaceFilePaths: (paths: string[]) => void
  onEditPinnedTab: (tab: InteractionPanelPinnedTab) => void
  onIframeMetadataChange: (pageId: string, metadata: { faviconUrl?: string; title?: string }) => void
  onIframeNavigateHistory: (pageId: string, delta: -1 | 1) => void
  onIframeSelectHistory: (pageId: string, index: number) => void
  onIframeUrlChange: (pageId: string, url: string) => void
  onLocateWorkspacePath: (path: string) => void
  onMarkdownPreviewModeChange: (mode: WorkspaceMarkdownPreviewMode) => void
  onMobileDebugPageChange: (
    pageId: string,
    updater: (page: InteractionPanelMobileDebugPage) => InteractionPanelMobileDebugPage
  ) => void
  onNewSession: () => void
  onNewTerminal: (shellKind?: TerminalShellKind) => void
  onOpenIframeUrl: (url: string, options?: OpenInteractionPanelIframeUrlOptions) => void
  onPanelAction: () => void
  onPinTab: (tab: InteractionPanelTab) => void
  onPluginTabStateChange: (tabId: string, state: unknown) => void
  onRunCommand: (command: InteractionPanelRunCommand) => void
  onReferenceAnnotations?: (annotations: PendingAnnotation[]) => void
  pendingAnnotationPreview?: PendingAnnotationPreviewState
  pendingAnnotations?: PendingAnnotation[]
  onSelectWorkspaceFilePath: (path: string) => void
  onSessionPageChange: (
    pageId: string,
    updater: (page: InteractionPanelSessionPage) => InteractionPanelSessionPage
  ) => void
  onTogglePanelFullscreen: () => void
  onUnpinTab: (tab: InteractionPanelTab) => void
}

export const InteractionPanelDockContext = createContext<InteractionPanelDockContextValue | null>(null)

export const useInteractionPanelDockContext = () => {
  const value = useContext(InteractionPanelDockContext)
  if (value == null) {
    throw new Error('InteractionPanelDockContext is missing')
  }

  return value
}
