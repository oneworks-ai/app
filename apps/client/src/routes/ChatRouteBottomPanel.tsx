import { ChatInteractionPanel } from '#~/components/chat/interaction-panel/ChatInteractionPanel'
import type { InteractionPanelRunCommandTaskStatus } from '#~/components/chat/interaction-panel/interaction-panel-run-commands'
import type { InteractionPanelShortcutRequest } from '#~/components/chat/interaction-panel/interaction-panel-shortcut-request'
import type { InteractionTerminalPanesController } from '#~/components/chat/interaction-panel/use-interaction-terminal-panes'
import type {
  ChatWorkspaceDrawerAgentApprovals,
  ChatWorkspaceDrawerAgentRoster
} from '#~/components/chat/workspace-drawer/ChatWorkspaceDrawer'
import type { WorkspaceDrawerViewItem } from '#~/components/chat/workspace-drawer/workspace-drawer-view-items'
import type { ContextPickerFile } from '#~/components/workspace/context-file-types'
import type { ChatRouteBottomPanelState } from '#~/hooks/chat/use-chat-route-bottom-panel'

import type { MenuProps } from 'antd'
import type { ReactNode } from 'react'

export function ChatRouteBottomPanel({
  agentApprovals,
  agentRoster,
  bottomPanel,
  isFolded,
  isRendered,
  isVisible,
  openResourceKeyboardShortcut,
  openResourceShortcut,
  openResourceShortcutLabel,
  shortcutRequest,
  onShortcutRequestHandled,
  onRunCommandTaskStatusesChange,
  onFoldChange,
  onLocateWorkspacePath,
  onOpenResource,
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
  isRendered: boolean
  isVisible: boolean
  openResourceKeyboardShortcut?: string | null
  openResourceShortcut?: string
  openResourceShortcutLabel?: string
  shortcutRequest?: InteractionPanelShortcutRequest | null
  onShortcutRequestHandled?: (id: number) => void
  onRunCommandTaskStatusesChange?: (statuses: InteractionPanelRunCommandTaskStatus[]) => void
  onFoldChange: (isFolded: boolean) => void
  onLocateWorkspacePath: (path: string) => void
  onOpenResource: () => void
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
  if (!isRendered) {
    return null
  }

  return (
    <ChatInteractionPanel
      agentApprovals={agentApprovals}
      agentRoster={agentRoster}
      bottomPanel={bottomPanel}
      isFolded={isFolded}
      isVisible={isVisible}
      openResourceKeyboardShortcut={openResourceKeyboardShortcut}
      openResourceShortcut={openResourceShortcut}
      openResourceShortcutLabel={openResourceShortcutLabel}
      shortcutRequest={shortcutRequest}
      onShortcutRequestHandled={onShortcutRequestHandled}
      onRunCommandTaskStatusesChange={onRunCommandTaskStatusesChange}
      onFoldChange={onFoldChange}
      onLocateWorkspacePath={onLocateWorkspacePath}
      onOpenResource={onOpenResource}
      onReferenceWorkspacePaths={onReferenceWorkspacePaths}
      onWorkspaceDrawerCreateMenuClick={onWorkspaceDrawerCreateMenuClick}
      settingsView={settingsView}
      sessionId={sessionId}
      terminalSessionId={terminalSessionId}
      terminalPanes={terminalPanes}
      workspaceDrawerCreateItems={workspaceDrawerCreateItems}
      workspaceDrawerCreateSelectedKeys={workspaceDrawerCreateSelectedKeys}
      workspaceRootPath={workspaceRootPath}
    />
  )
}
