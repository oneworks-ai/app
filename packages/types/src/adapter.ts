/* eslint-disable max-lines -- adapter contracts and loader types stay colocated for shared exports. */
import type { Cache } from './cache'
import type { EffortLevel, TaskRuntime } from './common'
import type { Config } from './config'
import type { AskUserQuestionParams } from './interaction'
import type { Logger } from './logger'
import type { ChatMessage, ChatMessageContent } from './message'
import type { AdapterModelFallbackWarning } from './model-selection'
import type { UsageQuery, UsageSourceResult } from './usage'
import type { AdapterAssetPlan, AssetDiagnostic, WorkspaceAssetBundle } from './workspace'

export type AdapterMessageContent = ChatMessageContent

export interface AdapterErrorData {
  message: string
  code?: string
  details?: unknown
  fatal?: boolean
}

export interface AdapterInteractionRequest {
  id: string
  payload: AskUserQuestionParams
}

export interface AdapterContextCompactionData {
  id: string
  createdAt?: number
  tokenCount?: number
  trigger?: string
}

export interface AdapterSessionUpdateData {
  title?: string
}

export interface AdapterUsageData {
  account?: string
  aggregationMode?: 'cumulative' | 'delta'
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
  costUsd?: number
  id?: string
  inputTokens: number
  model?: string
  modelService?: string
  observedAt?: number
  outputTokens: number
  quality?: 'estimated' | 'provider_reported' | 'reported'
  reasoningOutputTokens?: number
}

export type AdapterOperationEventType =
  | 'operation_started'
  | 'operation_completed'
  | 'operation_failed'

export interface AdapterOperationData {
  adapter?: string
  error?: string
  message?: string
  operationId: string
  status?: string
  summary?: string
  title?: string
  type: AdapterOperationEventType
}

export type AdapterOutputEvent =
  | { type: 'init'; data: SessionInitInfo }
  | { type: 'context_compaction'; data: AdapterContextCompactionData }
  | { type: 'operation'; data: AdapterOperationData }
  | { type: 'session_update'; data: AdapterSessionUpdateData }
  | { type: 'summary'; data: SessionSummaryInfo }
  | { type: 'message'; data: ChatMessage }
  | { type: 'usage'; data: AdapterUsageData }
  | { type: 'interaction_request'; data: AdapterInteractionRequest }
  | { type: 'error'; data: AdapterErrorData }
  | { type: 'exit'; data: { exitCode?: number; stderr?: string } }
  | { type: 'stop'; data?: ChatMessage }

export type SessionInfo =
  | ({ type: 'init' } & SessionInitInfo)
  | ({ type: 'summary' } & SessionSummaryInfo)

export interface AdapterConfigState {
  effectiveProjectConfig?: Config
  /**
   * @deprecated Use `effectiveProjectConfig` for runtime reads.
   */
  projectConfig?: Config
  userConfig?: Config
  mergedConfig: Config
}

export interface SessionInitInfo {
  uuid: string
  model: string
  adapter?: string
  account?: string
  effort?: EffortLevel
  fastMode?: boolean
  version: string
  tools: string[]
  slashCommands: string[]
  cwd: string
  agents: string[]
  title?: string
  selectionWarnings?: AdapterModelFallbackWarning[]
  assetDiagnostics?: AssetDiagnostic[]
  /** A live-only session accepts follow-up turns only while its runtime process remains connected. */
  sessionRecovery?: 'native-resume' | 'live-only'
}

export interface SessionSummaryInfo {
  summary: string
  leafUuid: string
}

export type AdapterEvent =
  | { type: 'message'; content: AdapterMessageContent[]; parentUuid?: string }
  | { type: 'interrupt' }
  | { type: 'stop' }

export interface AdapterCtx {
  ctxId: string
  cwd: string
  env: Record<string, string | null | undefined>
  cache: {
    set: <K extends keyof Cache>(key: K, value: Cache[K]) => Promise<{
      cachePath: string
    }>
    get: <K extends keyof Cache>(key: K) => Promise<Cache[K] | undefined>
  }
  logger: Logger
  configs: [Config?, Config?]
  configState?: AdapterConfigState
  assets?: WorkspaceAssetBundle
}

export interface AdapterAccountQuotaMetric {
  id: string
  label: string
  value?: string
  description?: string
  primary?: boolean
}

export interface AdapterAccountRateLimitResetCredit {
  id: string
  resetType?: string
  status?: string
  title?: string
  description?: string
  grantedAt?: number
  expiresAt?: number
}

export interface AdapterAccountRateLimitResetCredits {
  availableCount: number
  canConsume?: boolean
  credits?: AdapterAccountRateLimitResetCredit[]
}

export interface AdapterAccountQuotaInfo {
  summary?: string
  metrics?: AdapterAccountQuotaMetric[]
  rateLimitResetCredits?: AdapterAccountRateLimitResetCredits
  updatedAt?: number
}

export interface AdapterAccountActionDescriptor {
  key: 'add' | 'reauthenticate' | 'refresh' | 'remove'
  label: string
  description?: string
  scope?: 'adapter' | 'account'
}

export interface AdapterAccountSourceInfo {
  id: string
  label: string
  description?: string
}

export interface AdapterAccountInfo {
  key: string
  title: string
  description?: string
  displayName?: string
  email?: string
  avatarUrl?: string
  status?: 'ready' | 'missing' | 'error'
  isDefault?: boolean
  priority?: number
  disabled?: boolean
  retryAt?: number
  quota?: AdapterAccountQuotaInfo
}

export interface AdapterAccountDetail extends AdapterAccountInfo {
  planType?: string
  accountType?: string
  source?: AdapterAccountSourceInfo
  actions?: AdapterAccountActionDescriptor[]
}

export interface AdapterAccountsQueryOptions {
  model?: string
  account?: string
  refresh?: boolean
}

export interface AdapterAccountsResult {
  defaultAccount?: string
  accounts: AdapterAccountInfo[]
  automaticSelection?: {
    enabled: boolean
    strategy: 'sticky-priority'
  }
  actions?: AdapterAccountActionDescriptor[]
}

export interface AdapterAccountDetailQueryOptions {
  model?: string
  account: string
  refresh?: boolean
}

export interface AdapterAccountDetailResult {
  account: AdapterAccountDetail
}

export interface AdapterAccountCredentialArtifact {
  path: string
  content: string
}

export interface AdapterManageAccountProgressEvent {
  stream: 'stdout' | 'stderr' | 'status'
  message: string
}

export interface AdapterManageAccountOptions {
  action: 'add' | 'reauthenticate' | 'refresh' | 'remove' | 'consume-reset-credit'
  operationId?: string
  model?: string
  account?: string
  creditId?: string
  refresh?: boolean
  onProgress?: (event: AdapterManageAccountProgressEvent) => void
  signal?: AbortSignal
}

export interface AdapterManageAccountResult {
  accountKey?: string
  message?: string
  outcome?: string
  account?: AdapterAccountDetail
  artifacts?: AdapterAccountCredentialArtifact[]
  removeStoredAccount?: boolean
}

export interface AdapterQueryOptions {
  description?: string
  type: 'create' | 'resume'
  runtime: TaskRuntime
  sessionId: string
  model?: string
  account?: string
  effort?: EffortLevel
  fastMode?: boolean
  mode?: 'stream' | 'direct'
  systemPrompt?: string
  appendSystemPrompt?: boolean
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions'
  mcpServers?: {
    include?: string[]
    exclude?: string[]
  }
  runtimeMcpServers?: Config['mcpServers']
  useDefaultOneworksMcpServer?: boolean
  tools?: {
    include?: string[]
    exclude?: string[]
  }
  skills?: {
    include?: string[]
    exclude?: string[]
  }
  extraOptions?: string[]
  promptAssetIds?: string[]
  assetBundle?: WorkspaceAssetBundle
  assetPlan?: AdapterAssetPlan
  /** A restricted runtime profile for structured, model-only classification. */
  executionProfile?: 'structured_no_tools'
  onEvent: (event: AdapterOutputEvent) => void
}

export interface AdapterSession {
  kill: () => void
  stop?: () => void
  emit: (event: AdapterEvent) => void
  respondInteraction?: (interactionId: string, data: string | string[]) => void | Promise<void>
  flushHooks?: () => Promise<void>
  pid?: number
}

export interface AdapterModelSharingBridgeOptions {
  sessionId: string
  account?: string
  signal?: AbortSignal
  onMessage: (message: string) => void
  onError?: (error: Error) => void
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void
}

export interface AdapterModelSharingBridge {
  accountKey?: string
  send: (message: string | Uint8Array) => Promise<void>
  close: () => void
}

export interface AdapterSharedModelExecuteOptions {
  request: Record<string, unknown>
  sessionId: string
  account?: string
  signal?: AbortSignal
}

export interface AdapterSharedModelExecuteResult {
  response: Record<string, unknown>
  accountKey?: string
}

export interface Adapter {
  sanitizeRuntimeArtifact?: <T>(
    ctx: AdapterCtx,
    value: T
  ) => T
  init?: (
    ctx: AdapterCtx
  ) => Promise<void>
  getUsage?: (
    ctx: AdapterCtx,
    query: UsageQuery
  ) => Promise<UsageSourceResult>
  getAccounts?: (
    ctx: AdapterCtx,
    options: AdapterAccountsQueryOptions
  ) => Promise<AdapterAccountsResult>
  getAccountDetail?: (
    ctx: AdapterCtx,
    options: AdapterAccountDetailQueryOptions
  ) => Promise<AdapterAccountDetailResult>
  manageAccount?: (
    ctx: AdapterCtx,
    options: AdapterManageAccountOptions
  ) => Promise<AdapterManageAccountResult>
  createModelSharingBridge?: (
    ctx: AdapterCtx,
    options: AdapterModelSharingBridgeOptions
  ) => Promise<AdapterModelSharingBridge>
  executeSharedModel?: (
    ctx: AdapterCtx,
    options: AdapterSharedModelExecuteOptions
  ) => Promise<AdapterSharedModelExecuteResult>
  query: (
    ctx: AdapterCtx,
    options: AdapterQueryOptions
  ) => Promise<AdapterSession>
}

export const defineAdapter = <T extends Adapter>(adapter: T): Adapter => adapter
