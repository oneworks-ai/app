export { getAdapterAccountDetail, getAdapterAccounts, manageAdapterAccount } from './api/adapters'
export {
  getAgentRoom,
  listAgentRooms,
  listArchivedAgentRooms,
  respondAgentRoomInteraction,
  sendAgentRoomMessage,
  updateAgentRoomMetadata
} from './api/agent-rooms'
// 自动化规则与执行记录 API
export type { AutomationRule, AutomationRun, AutomationTask, AutomationTrigger } from './api/automation'

export {
  createAutomationRule,
  deleteAutomationRule,
  listAutomationRules,
  listAutomationRuns,
  runAutomationRule,
  updateAutomationRule
} from './api/automation'
export { ApiError, getApiErrorMessage } from './api/base'
export {
  getBenchmarkCase,
  getBenchmarkResult,
  getBenchmarkRun,
  listBenchmarkCases,
  listBenchmarkCategories,
  startBenchmarkRun
} from './api/benchmark'

// 配置读取与更新 API
export { getConfig, getConfigSchema, updateConfig } from './api/config'
export {
  checkoutSessionGitBranch,
  commitSessionGitChanges,
  createSessionGitBranch,
  getSessionGitState,
  getWorkspaceGitState,
  listSessionGitBranches,
  listSessionGitWorktrees,
  listWorkspaceGitBranches,
  listWorkspaceGitWorktrees,
  pushSessionGitBranch,
  syncSessionGitBranch
} from './api/git'

// 知识库与规则说明 API
export type {
  EntityDetail,
  EntitySummary,
  RuleDetail,
  RuleSummary,
  SkillDetail,
  SkillSummary,
  SpecDetail,
  SpecSummary,
  WorkspaceSummary
} from './api/knowledge'
export {
  createSkill,
  getEntityDetail,
  getRuleDetail,
  getSkillDetail,
  getSpecDetail,
  importSkillArchive,
  listEntities,
  listRules,
  listSkills,
  listSpecs,
  listWorkspaces
} from './api/knowledge'
export {
  checkModuleUpdates,
  getModuleUpdates,
  installModuleUpdate,
  updateModuleUpdateSettings
} from './api/module-updates'

// 项目与工程 API
export { createProject, listProjects } from './api/projects'

// 会话与消息 API
export {
  branchSessionFromMessage,
  createQueuedMessage,
  createSession,
  createSessionManagedWorktree,
  deleteQueuedMessage,
  deleteSession,
  forkSession,
  getSession,
  getSessionCacheKey,
  getSessionMessages,
  getSessionWorkspace,
  getSessionWorkspaceResourceUrl,
  listSessionWorkspaceTree,
  listSessions,
  moveQueuedMessage,
  openSessionWorkspaceFileInExternalOpener,
  readSessionWorkspaceFile,
  reorderQueuedMessages,
  respondSessionInteraction,
  revealSessionWorkspacePathInFileManager,
  sendSessionMessage,
  terminateSession,
  transferSessionWorkspaceToLocal,
  updateQueuedMessage,
  updateSession,
  updateSessionTitle,
  updateSessionWorkspaceFile
} from './api/sessions'
export type {
  SkillHubConfigSource,
  SkillHubInstallResult,
  SkillHubItem,
  SkillHubRegistrySummary,
  SkillHubSearchResult
} from './api/skill-hub'
export { installSkillHubItem, searchSkillHub } from './api/skill-hub'

// 基础响应类型与会话交互类型
export type { ApiOkResponse, ApiRemoveResponse, SessionInteraction, SessionMessagesResponse } from './api/types'
export { readWebpageMetadata } from './api/webpage'
export type { WebpageMetadataResponse } from './api/webpage'
export type { WorkspaceFileContent, WorkspaceTreeEntry } from './api/workspace'
export {
  getWorkspacePathActionCapabilities,
  getWorkspaceResourceUrl,
  listWorkspaceFileOpeners,
  listWorkspaceTree,
  openWorkspaceFileInExternalOpener,
  openWorkspaceInExternalOpener,
  readWorkspaceFile,
  revealWorkspacePathInFileManager,
  updateWorkspaceFile
} from './api/workspace'

// Worktree 环境脚本 API
export {
  deleteWorktreeEnvironment,
  getWorktreeEnvironment,
  listWorktreeEnvironments,
  saveWorktreeEnvironment
} from './api/worktree-environments'

export type {
  AgentRoomDetailResponse,
  AgentRoomListResponse,
  AgentRoomMessageWriteRequest,
  AgentRoomMessageWriteResponse,
  GitAvailabilityReason,
  GitBranchKind,
  GitBranchListResult,
  GitBranchSummary,
  GitChangeSummary,
  GitChangedFile,
  GitCommitPayload,
  GitHeadCommitSummary,
  GitMutationResult,
  GitPushPayload,
  GitRepositoryState,
  GitWorktreeListResult,
  GitWorktreeSummary,
  UpdateAgentRoomMetadataRequest,
  UpdateAgentRoomMetadataResponse
} from '@oneworks/types'
export type { BenchmarkCase, BenchmarkCategory, BenchmarkResult, BenchmarkRunSummary } from '@oneworks/types'
export type { SessionWorkspace } from '@oneworks/types'
export type {
  WorktreeEnvironmentDetail,
  WorktreeEnvironmentListResult,
  WorktreeEnvironmentMutationResult,
  WorktreeEnvironmentOperation,
  WorktreeEnvironmentPlatform,
  WorktreeEnvironmentSavePayload,
  WorktreeEnvironmentScript,
  WorktreeEnvironmentScriptKey,
  WorktreeEnvironmentSummary
} from '@oneworks/types'
