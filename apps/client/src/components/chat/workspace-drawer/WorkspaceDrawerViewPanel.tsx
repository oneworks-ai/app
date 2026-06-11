import type { ReactNode } from 'react'

import type { GitRepositoryState } from '@oneworks/types'

import { AgentRoomRoster } from '#~/components/agent-room/@components/AgentRoomRoster'
import type {
  AgentRoomMemberView,
  AgentRoomMessageView,
  AgentRoomRunView
} from '#~/components/agent-room/@types/agent-room-view'
import type { ContextPickerFile } from '#~/components/workspace/context-file-types'
import type { ProjectFileTreeCommand } from '#~/components/workspace/project-file-tree/project-file-tree-types'
import { PluginViewHost } from '#~/plugins/PluginHost'
import type { PluginContributionWorkbenchTab } from '#~/plugins/plugin-manifest'

import type { ChatWorkspaceDrawerAgentApprovals } from './ChatWorkspaceDrawer'
import { WorkspaceDrawerApprovals } from './WorkspaceDrawerApprovals'
import { WorkspaceDrawerChangedFiles } from './WorkspaceDrawerChangedFiles'
import { WorkspaceDrawerTree } from './WorkspaceDrawerTree'
import type { ChangedFilesLayout, ChangedTreeCommand } from './changed-files-model'
import type { WorkspaceDrawerView } from './workspace-drawer-types'

export function WorkspaceDrawerViewPanel({
  activeView,
  agentApprovals,
  agentRoster,
  approvalMessages,
  changedLayout,
  changedTreeCommand,
  isGitLoading,
  onOpenFile,
  onReferencePaths,
  pluginTabs,
  repoState,
  selectedFilePath,
  settingsView,
  sessionId,
  treeRefreshKey,
  workspaceTreeCommand
}: {
  activeView: WorkspaceDrawerView
  agentApprovals?: ChatWorkspaceDrawerAgentApprovals
  agentRoster?: {
    members: AgentRoomMemberView[]
    onOpenRun?: (run: AgentRoomRunView) => void
  }
  approvalMessages: AgentRoomMessageView[]
  changedLayout: ChangedFilesLayout
  changedTreeCommand: ChangedTreeCommand | null
  isGitLoading: boolean
  onOpenFile?: (path: string) => void
  onReferencePaths?: (files: ContextPickerFile[]) => void
  pluginTabs?: Array<PluginContributionWorkbenchTab & { pluginScope: string }>
  repoState?: GitRepositoryState
  selectedFilePath?: string | null
  settingsView?: ReactNode
  sessionId?: string
  treeRefreshKey: number
  workspaceTreeCommand: ProjectFileTreeCommand | null
}) {
  if (activeView.startsWith('plugin:')) {
    const tab = pluginTabs?.find(item => `plugin:${item.pluginScope}:${item.id}` === activeView)
    if (tab?.clientView != null) {
      return (
        <div className='chat-workspace-drawer__plugin-panel'>
          <PluginViewHost scope={tab.pluginScope} surface='drawer' viewId={tab.clientView} />
        </div>
      )
    }
  }

  if (activeView === 'approvals' && agentApprovals != null) {
    return (
      <WorkspaceDrawerApprovals
        approvals={approvalMessages}
        onOpenRun={agentApprovals.onOpenRun}
      />
    )
  }

  if (activeView === 'agents' && agentRoster != null) {
    return (
      <div className='chat-workspace-drawer__agents-panel'>
        <AgentRoomRoster
          layout='desktop'
          members={agentRoster.members}
          showHeader={false}
          onOpenRun={agentRoster.onOpenRun}
        />
      </div>
    )
  }

  if (activeView === 'settings' && settingsView != null) {
    return (
      <div className='chat-workspace-drawer__settings-panel'>
        {settingsView}
      </div>
    )
  }

  if (activeView === 'tree') {
    return (
      <WorkspaceDrawerTree
        command={workspaceTreeCommand}
        refreshKey={treeRefreshKey}
        selectedFilePath={selectedFilePath}
        sessionId={sessionId}
        onOpenFile={onOpenFile}
        onReferencePaths={onReferencePaths}
      />
    )
  }

  return (
    <WorkspaceDrawerChangedFiles
      command={changedTreeCommand}
      isLoading={isGitLoading}
      layout={changedLayout}
      repoState={repoState}
      selectedFilePath={selectedFilePath}
      onOpenFile={onOpenFile}
    />
  )
}
