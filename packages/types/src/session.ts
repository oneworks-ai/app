import type { EffortLevel } from './common'
import type { ChatMessageContent } from './message'

export type SessionStatus = 'running' | 'completed' | 'failed' | 'terminated' | 'waiting_input'

export type SessionPermissionMode = 'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions'
export type SessionPromptType = 'spec' | 'entity' | 'workspace'
export type SessionMessageBranchAction = 'fork' | 'recall' | 'edit'
export type SessionWorkspaceKind = 'managed_worktree' | 'shared_workspace' | 'external_workspace'
export type SessionWorkspaceState = 'provisioning' | 'ready' | 'deleting' | 'deleted' | 'broken'
export type SessionWorkspaceCleanupPolicy = 'delete_on_session_delete' | 'retain'

export type SessionQueuedMessageMode = 'steer' | 'next'

export type SessionCreationProgressStatus = 'running' | 'success' | 'error' | 'skipped'
export type SessionCreationProgressPhase = 'worktree' | 'environment' | 'workspace'
export type SessionCreationProgressStep =
  | 'worktree_preparing'
  | 'worktree_creating'
  | 'worktree_created'
  | 'environment_resolving'
  | 'environment_script_running'
  | 'environment_script_output'
  | 'environment_script_succeeded'
  | 'environment_script_failed'
  | 'environment_skipped'
  | 'workspace_ready'
  | 'workspace_failed'

export interface SessionCreationProgressEvent {
  phase: SessionCreationProgressPhase
  step: SessionCreationProgressStep
  status: SessionCreationProgressStatus
  message?: string
  worktreePath?: string
  environmentId?: string
  scriptPath?: string
  scriptFileName?: string
  stream?: 'stdout' | 'stderr'
  output?: string
}

export interface SessionQueuedMessage {
  id: string
  sessionId: string
  mode: SessionQueuedMessageMode
  content: ChatMessageContent[]
  createdAt: number
  updatedAt: number
  order: number
}

export interface SessionMessageQueueState {
  steer: SessionQueuedMessage[]
  next: SessionQueuedMessage[]
}

export interface SessionWorkspaceFileState {
  openPaths: string[]
  selectedPath?: string
  isOpen?: boolean
}

export interface Session {
  id: string
  parentSessionId?: string
  messageBranchGroupId?: string
  messageBranchSourceSessionId?: string
  messageBranchSourceMessageId?: string
  messageBranchBaseMessageIndex?: number
  messageBranchAction?: SessionMessageBranchAction
  title?: string
  createdAt: number
  messageCount?: number
  lastMessage?: string
  lastUserMessage?: string
  isStarred?: boolean
  isArchived?: boolean
  tags?: string[]
  status?: SessionStatus
  model?: string
  adapter?: string
  account?: string
  permissionMode?: SessionPermissionMode
  effort?: EffortLevel
  promptType?: SessionPromptType
  promptName?: string
  workspaceFileState?: SessionWorkspaceFileState
}

export interface SessionWorkspace {
  sessionId: string
  kind: SessionWorkspaceKind
  workspaceFolder: string
  repositoryRoot?: string
  worktreePath?: string
  baseRef?: string
  worktreeEnvironment?: string
  cleanupPolicy: SessionWorkspaceCleanupPolicy
  state: SessionWorkspaceState
  lastError?: string
  createdAt: number
  updatedAt: number
  deletedAt?: number
}
