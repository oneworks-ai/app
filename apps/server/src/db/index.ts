import { createAgentRoomsRepo } from './agentRooms/repo'
import { agentRoomsSchemaModule } from './agentRooms/schema'
import { createAutomationRepo } from './automation/repo'
import type {
  AutomationBranchMode,
  AutomationRule,
  AutomationRuleDetail,
  AutomationRun,
  AutomationTask,
  AutomationTrigger
} from './automation/repo'
import { automationSchemaModule } from './automation/schema'
import { createChannelActionTokensRepo } from './channelActionTokens/repo'
import { channelActionTokensSchemaModule } from './channelActionTokens/schema'
import { createChannelChildRunsRepo } from './channelChildRuns/repo'
import type {
  ChannelChildSessionRunDispatchMode,
  ChannelChildSessionRunRow,
  ChannelChildSessionRunStatus,
  ChannelChildSessionRunTriggerType
} from './channelChildRuns/repo'
import { channelChildRunsSchemaModule } from './channelChildRuns/schema'
import { createChannelCommandsRepo } from './channelCommands/repo'
import type {
  ChannelCommandRunPermission,
  ChannelCommandRunRow,
  ChannelCommandRunSource,
  ChannelCommandRunStatus
} from './channelCommands/repo'
import { channelCommandsSchemaModule } from './channelCommands/schema'
import { createChannelConversationsRepo } from './channelConversations/repo'
import type {
  ChannelConversationStateRow,
  ChannelConversationTurnRole,
  ChannelConversationTurnRow,
  ChannelPendingIntentDelivery,
  ChannelPendingIntentKind,
  ChannelPendingIntentRow,
  ChannelPendingIntentStatus
} from './channelConversations/repo'
import { channelConversationsSchemaModule } from './channelConversations/schema'
import { createChannelIdentitiesRepo } from './channelIdentities/repo'
import type {
  CanonicalUserRow,
  ChannelAccountRow,
  ChannelAuthorizationRequestRow,
  ChannelCredentialStatus,
  ChannelIdentityLinkCodeConsumeResult,
  ChannelIdentityLinkCodeRow,
  ChannelIdentityLinkCodeStatus,
  ChannelIdentityLinkRow,
  ChannelIdentityLinkStatus,
  ChannelUserCredentialRow
} from './channelIdentities/repo'
import { channelIdentitiesSchemaModule } from './channelIdentities/schema'
import { createChannelIngressRouterRunsRepo } from './channelIngressRouterRuns/repo'
import type { ChannelIngressRouterDecision, ChannelIngressRouterRunRow } from './channelIngressRouterRuns/repo'
import { channelIngressRouterRunsSchemaModule } from './channelIngressRouterRuns/schema'
import { createChannelMemoriesRepo } from './channelMemories/repo'
import type {
  ChannelMemoryRow,
  ChannelMemorySensitivity,
  ChannelMemorySubjectType,
  ChannelMemoryVisibility
} from './channelMemories/repo'
import { channelMemoriesSchemaModule } from './channelMemories/schema'
import { createChannelMessagesRepo } from './channelMessages/repo'
import { channelMessagesSchemaModule } from './channelMessages/schema'
import { createChannelOutboundDeliveriesRepo } from './channelOutboundDeliveries/repo'
import type { ChannelOutboundDeliveryRow } from './channelOutboundDeliveries/repo'
import { channelOutboundDeliveriesSchemaModule } from './channelOutboundDeliveries/schema'
import { createChannelPoliciesRepo } from './channelPolicies/repo'
import type {
  ChannelPolicyEventRow,
  ChannelPolicyScope,
  ChannelPolicyState,
  ChannelPolicyStateRow,
  ChannelPolicyType,
  ChannelReplyThrottleRow
} from './channelPolicies/repo'
import { channelPoliciesSchemaModule } from './channelPolicies/schema'
import type { ChannelScenarioRow } from './channelScenarios/record'
import { createChannelScenariosRepo } from './channelScenarios/repo'
import { channelScenariosSchemaModule } from './channelScenarios/schema'
import { channelSessionsSchemaModule } from './channelSessions/schema'

import { createChannelSessionsRepo } from './channelSessions/repo'
import { createConnection } from './connection'
import { initSchema } from './schema'
import { createSessionWorkspacesRepo } from './sessionWorkspaces/repo'
import type { SessionWorkspaceRow } from './sessionWorkspaces/repo'
import { sessionWorkspacesSchemaModule } from './sessionWorkspaces/schema'
import { createMessagesRepo } from './sessions/messages.repo'
import { createSessionQueueRepo } from './sessions/queue.repo'
import { createSessionsRepo } from './sessions/repo'
import type { SessionChannelActorSnapshot, SessionRuntimeState } from './sessions/repo'
import { sessionsSchemaModule } from './sessions/schema'
import { createTagsRepo } from './sessions/tags.repo'
import type { SqliteDatabase } from './sqlite'
import { createUsageRepo } from './usage/repo'
import { usageSchemaModule } from './usage/schema'

const dbSchemaModules = [
  sessionsSchemaModule,
  sessionWorkspacesSchemaModule,
  channelSessionsSchemaModule,
  channelMessagesSchemaModule,
  channelOutboundDeliveriesSchemaModule,
  channelActionTokensSchemaModule,
  channelConversationsSchemaModule,
  channelMemoriesSchemaModule,
  channelChildRunsSchemaModule,
  channelIngressRouterRunsSchemaModule,
  channelCommandsSchemaModule,
  channelIdentitiesSchemaModule,
  channelPoliciesSchemaModule,
  channelScenariosSchemaModule,
  agentRoomsSchemaModule,
  automationSchemaModule,
  usageSchemaModule
] as const

export type { SessionChannelActorSnapshot, SessionRuntimeState }
export type { ChannelPolicyEventRow, ChannelPolicyScope, ChannelPolicyState, ChannelPolicyStateRow }
export type { ChannelOffhourBacklogRow, ChannelOffhourBacklogStatus } from './channelPolicies/backlog-record'
export type {
  ChannelChildSessionRunDispatchMode,
  ChannelChildSessionRunRow,
  ChannelChildSessionRunStatus,
  ChannelChildSessionRunTriggerType
}
export type { ChannelIngressRouterDecision, ChannelIngressRouterRunRow }
export type { ChannelMemoryRow, ChannelMemorySensitivity, ChannelMemorySubjectType, ChannelMemoryVisibility }
export type { ChannelScenarioRow }
export type { ChannelOutboundDeliveryRow }
export type {
  ChannelConversationStateRow,
  ChannelConversationTurnRole,
  ChannelConversationTurnRow,
  ChannelPendingIntentDelivery,
  ChannelPendingIntentKind,
  ChannelPendingIntentRow,
  ChannelPendingIntentStatus
}

export interface SqliteDbOptions {
  db?: SqliteDatabase
}

export class SqliteDb {
  private db: SqliteDatabase
  private sessions: ReturnType<typeof createSessionsRepo>
  private messages: ReturnType<typeof createMessagesRepo>
  private sessionWorkspaces: ReturnType<typeof createSessionWorkspacesRepo>
  private sessionQueue: ReturnType<typeof createSessionQueueRepo>
  private channelSessions: ReturnType<typeof createChannelSessionsRepo>
  private channelMessages: ReturnType<typeof createChannelMessagesRepo>
  private channelOutboundDeliveries: ReturnType<typeof createChannelOutboundDeliveriesRepo>
  private channelActionTokens: ReturnType<typeof createChannelActionTokensRepo>
  private channelConversations: ReturnType<typeof createChannelConversationsRepo>
  private channelMemories: ReturnType<typeof createChannelMemoriesRepo>
  private channelChildRuns: ReturnType<typeof createChannelChildRunsRepo>
  private channelIngressRouterRuns: ReturnType<typeof createChannelIngressRouterRunsRepo>
  private channelCommands: ReturnType<typeof createChannelCommandsRepo>
  private channelIdentities: ReturnType<typeof createChannelIdentitiesRepo>
  private channelPolicies: ReturnType<typeof createChannelPoliciesRepo>
  private channelScenarios: ReturnType<typeof createChannelScenariosRepo>
  private agentRooms: ReturnType<typeof createAgentRoomsRepo>
  private tags: ReturnType<typeof createTagsRepo>
  private automation: ReturnType<typeof createAutomationRepo>
  private usage: ReturnType<typeof createUsageRepo>

  constructor(options: SqliteDbOptions = {}) {
    this.db = options.db ?? createConnection().db
    initSchema(this.db, dbSchemaModules)
    this.sessions = createSessionsRepo(this.db)
    this.messages = createMessagesRepo(this.db)
    this.sessionWorkspaces = createSessionWorkspacesRepo(this.db)
    this.sessionQueue = createSessionQueueRepo(this.db)
    this.channelSessions = createChannelSessionsRepo(this.db)
    this.channelMessages = createChannelMessagesRepo(this.db)
    this.channelOutboundDeliveries = createChannelOutboundDeliveriesRepo(this.db)
    this.channelActionTokens = createChannelActionTokensRepo(this.db)
    this.channelConversations = createChannelConversationsRepo(this.db)
    this.channelMemories = createChannelMemoriesRepo(this.db)
    this.channelChildRuns = createChannelChildRunsRepo(this.db)
    this.channelIngressRouterRuns = createChannelIngressRouterRunsRepo(this.db)
    this.channelCommands = createChannelCommandsRepo(this.db)
    this.channelIdentities = createChannelIdentitiesRepo(this.db)
    this.channelPolicies = createChannelPoliciesRepo(this.db)
    this.channelScenarios = createChannelScenariosRepo(this.db)
    this.agentRooms = createAgentRoomsRepo(this.db)
    this.tags = createTagsRepo(this.db)
    this.automation = createAutomationRepo(this.db)
    this.usage = createUsageRepo(this.db)
  }

  getSessions(filter: 'active' | 'archived' | 'all' = 'active') {
    return this.sessions.list(filter)
  }

  getSession(id: string) {
    return this.sessions.get(id)
  }

  getSessionRuntimeState(id: string) {
    return this.sessions.getRuntimeState(id)
  }

  getSessionWorkspace(sessionId: string) {
    return this.sessionWorkspaces.get(sessionId)
  }

  listSessionWorkspaces(filter?: Parameters<typeof this.sessionWorkspaces.list>[0]) {
    return this.sessionWorkspaces.list(filter)
  }

  upsertSessionWorkspace(
    row: Parameters<typeof this.sessionWorkspaces.upsert>[0]
  ) {
    return this.sessionWorkspaces.upsert(row)
  }

  updateSessionWorkspace(
    sessionId: string,
    updates: Parameters<typeof this.sessionWorkspaces.update>[1]
  ) {
    return this.sessionWorkspaces.update(sessionId, updates)
  }

  deleteSessionWorkspace(sessionId: string) {
    return this.sessionWorkspaces.remove(sessionId)
  }

  updateSession(id: string, updates: Parameters<typeof this.sessions.update>[1]) {
    return this.sessions.update(id, updates)
  }

  updateSessionRuntimeState(id: string, updates: Partial<SessionRuntimeState>) {
    return this.sessions.updateRuntimeState(id, updates)
  }

  consumeSessionPermissionOnce(id: string, keys: string[]) {
    return this.sessions.consumePermissionOnce(id, keys)
  }

  transferSessionPermissionState(parentId: string, childId: string) {
    return this.sessions.transferPermissionState(parentId, childId)
  }

  updateSessionStarred(id: string, isStarred: boolean) {
    return this.sessions.setStarred(id, isStarred)
  }

  updateSessionArchived(id: string, isArchived: boolean) {
    return this.sessions.setArchived(id, isArchived)
  }

  updateSessionArchivedWithChildren(id: string, isArchived: boolean) {
    return this.sessions.archiveTree(id, isArchived)
  }

  updateSessionTags(sessionId: string, tags: string[]) {
    return this.tags.replace(sessionId, tags)
  }

  saveMessage(sessionId: string, data: unknown) {
    const didSave = this.messages.save(sessionId, data)
    if (didSave) {
      this.usage.recordSessionEvent(sessionId, data)
    }
    return didSave
  }

  getUsageReport(query?: Parameters<typeof this.usage.report>[0]) {
    return this.usage.report(query)
  }

  listUsageObservations() {
    return this.usage.list()
  }

  recordUsageObservation(observation: Parameters<typeof this.usage.recordObservation>[0]) {
    return this.usage.recordObservation(observation)
  }

  recordSessionUsageEvent(sessionId: string, event: unknown) {
    return this.usage.recordSessionEvent(sessionId, event)
  }

  getMessages(sessionId: string) {
    return this.messages.list(sessionId)
  }

  getMessageWindow(sessionId: string, options: Parameters<typeof this.messages.listWindow>[1]) {
    return this.messages.listWindow(sessionId, options)
  }

  getMessageWindowWithCursor(
    sessionId: string,
    options: Parameters<typeof this.messages.listWindowWithCursor>[1]
  ) {
    return this.messages.listWindowWithCursor(sessionId, options)
  }

  getLatestSessionInfoMessage(sessionId: string) {
    return this.messages.findLatestSessionInfo(sessionId)
  }

  listSessionQueuedMessages(sessionId: string) {
    return this.sessionQueue.list(sessionId)
  }

  getSessionQueuedMessage(sessionId: string, id: string) {
    return this.sessionQueue.get(sessionId, id)
  }

  createSessionQueuedMessage(
    sessionId: string,
    mode: Parameters<typeof this.sessionQueue.create>[1],
    content: Parameters<typeof this.sessionQueue.create>[2]
  ) {
    return this.sessionQueue.create(sessionId, mode, content)
  }

  updateSessionQueuedMessage(
    sessionId: string,
    id: string,
    content: Parameters<typeof this.sessionQueue.update>[2]
  ) {
    return this.sessionQueue.update(sessionId, id, content)
  }

  moveSessionQueuedMessage(
    sessionId: string,
    id: string,
    mode: Parameters<typeof this.sessionQueue.move>[2]
  ) {
    return this.sessionQueue.move(sessionId, id, mode)
  }

  deleteSessionQueuedMessage(sessionId: string, id: string) {
    return this.sessionQueue.remove(sessionId, id)
  }

  reorderSessionQueuedMessages(
    sessionId: string,
    mode: Parameters<typeof this.sessionQueue.reorder>[1],
    ids: Parameters<typeof this.sessionQueue.reorder>[2]
  ) {
    return this.sessionQueue.reorder(sessionId, mode, ids)
  }

  getChannelSession(
    channelKey: string,
    channelType: string,
    sessionType: string,
    channelId: string,
    threadId?: string
  ) {
    return this.channelSessions.get(channelKey, channelType, sessionType, channelId, threadId)
  }

  getChannelPreference(channelKey: string, channelType: string, sessionType: string, channelId: string) {
    return this.channelSessions.getPreference(channelKey, channelType, sessionType, channelId)
  }

  getChannelSessionBySessionId(sessionId: string) {
    return this.channelSessions.getBySessionId(sessionId)
  }

  upsertChannelSession(row: Parameters<typeof this.channelSessions.upsert>[0]) {
    return this.channelSessions.upsert(row)
  }

  upsertChannelPreference(row: Parameters<typeof this.channelSessions.upsertPreference>[0]) {
    return this.channelSessions.upsertPreference(row)
  }

  deleteChannelSessionBySessionId(sessionId: string) {
    return this.channelSessions.removeBySessionId(sessionId)
  }

  deleteChannelSession(
    channelKey: string,
    channelType: string,
    sessionType: string,
    channelId: string,
    threadId?: string
  ) {
    return this.channelSessions.remove(channelKey, channelType, sessionType, channelId, threadId)
  }

  upsertChannelOutboundDelivery(row: Parameters<typeof this.channelOutboundDeliveries.upsert>[0]) {
    return this.channelOutboundDeliveries.upsert(row)
  }

  claimChannelOutboundOperation(row: Parameters<typeof this.channelOutboundDeliveries.claimOperation>[0]) {
    return this.channelOutboundDeliveries.claimOperation(row)
  }

  finishChannelOutboundOperation(
    operationId: string,
    updates: Parameters<typeof this.channelOutboundDeliveries.finishOperation>[1]
  ) {
    return this.channelOutboundDeliveries.finishOperation(operationId, updates)
  }

  getChannelOutboundOperation(operationId: string) {
    return this.channelOutboundDeliveries.getOperation(operationId)
  }

  listRecentChannelOutboundDeliveries(channelType: string, limit?: number) {
    return this.channelOutboundDeliveries.listRecent(channelType, limit)
  }

  rememberChannelMessage(messageKey: string, seenAt = Date.now()) {
    return this.channelMessages.rememberSeen(messageKey, seenAt)
  }

  forgetChannelMessage(messageKey: string) {
    return this.channelMessages.removeSeen(messageKey)
  }

  deleteChannelMessagesSeenBefore(cutoff: number) {
    return this.channelMessages.removeSeenBefore(cutoff)
  }

  consumeChannelActionTokenNonce(nonce: string, action: string, expiresAt: number, consumedAt = Date.now()) {
    return this.channelActionTokens.consume({
      nonce,
      action,
      expiresAt,
      consumedAt
    })
  }

  clearChannelActionTokenNonces() {
    this.channelActionTokens.clear()
  }

  ensureChannelConversationState(row: Parameters<typeof this.channelConversations.ensureState>[0]) {
    return this.channelConversations.ensureState(row)
  }

  getChannelConversationState(id: string) {
    return this.channelConversations.getState(id)
  }

  getChannelConversationStateByThread(row: Parameters<typeof this.channelConversations.getStateByThread>[0]) {
    return this.channelConversations.getStateByThread(row)
  }

  getChannelConversationStateByLastBotReply(
    row: Parameters<typeof this.channelConversations.getStateByLastBotReply>[0]
  ) {
    return this.channelConversations.getStateByLastBotReply(row)
  }

  appendChannelConversationTurn(row: Parameters<typeof this.channelConversations.appendTurn>[0]) {
    return this.channelConversations.appendTurn(row)
  }

  getChannelConversationTurn(id: string) {
    return this.channelConversations.getTurn(id)
  }

  listRecentChannelConversationTurns(conversationStateId: string, limit?: number) {
    return this.channelConversations.listRecentTurns(conversationStateId, limit)
  }

  listRecentChannelConversationTurnsByType(channelType: string, limit?: number) {
    return this.channelConversations.listRecentTurnsByChannelType(channelType, limit)
  }

  upsertChannelPendingIntent(row: Parameters<typeof this.channelConversations.upsertPendingIntent>[0]) {
    return this.channelConversations.upsertPendingIntent(row)
  }

  getChannelPendingIntent(id: string) {
    return this.channelConversations.getPendingIntent(id)
  }

  updateChannelPendingIntent(
    id: string,
    updates: Parameters<typeof this.channelConversations.updatePendingIntent>[1]
  ) {
    return this.channelConversations.updatePendingIntent(id, updates)
  }

  claimChannelPendingIntentResume(
    input: Parameters<typeof this.channelConversations.claimPendingIntentResume>[0]
  ) {
    return this.channelConversations.claimPendingIntentResume(input)
  }

  finishChannelPendingIntentResumeClaim(
    input: Parameters<typeof this.channelConversations.finishPendingIntentResumeClaim>[0]
  ) {
    return this.channelConversations.finishPendingIntentResumeClaim(input)
  }

  listOpenChannelPendingIntents(filter?: Parameters<typeof this.channelConversations.listOpenPendingIntents>[0]) {
    return this.channelConversations.listOpenPendingIntents(filter)
  }

  listResolvedChannelPendingIntents(
    filter?: Parameters<typeof this.channelConversations.listResolvedPendingIntents>[0]
  ) {
    return this.channelConversations.listResolvedPendingIntents(filter)
  }

  upsertChannelMemory(row: Parameters<typeof this.channelMemories.upsert>[0]) {
    return this.channelMemories.upsert(row)
  }

  getChannelMemory(id: string) {
    return this.channelMemories.get(id)
  }

  listChannelMemoryCandidates(filter: Parameters<typeof this.channelMemories.listCandidates>[0]) {
    return this.channelMemories.listCandidates(filter)
  }

  listChannelMemoriesByEntity(entity: string) {
    return this.channelMemories.listByEntity(entity)
  }

  saveChannelMemorySnapshot(row: Parameters<typeof this.channelMemories.saveSnapshot>[0]) {
    return this.channelMemories.saveSnapshot(row)
  }

  attachChannelMemorySnapshotToChildRun(snapshotId: string, childRunId: string) {
    return this.channelMemories.attachSnapshotToChildRun(snapshotId, childRunId)
  }

  createPendingChannelMemoryWriteback(row: Parameters<typeof this.channelMemories.createPendingWriteback>[0]) {
    return this.channelMemories.createPendingWriteback(row)
  }

  getChannelMemoryWritebackByPatchKey(childRunId: string, patchKey: string) {
    return this.channelMemories.getWritebackByPatchKey(childRunId, patchKey)
  }

  commitChannelMemoryWriteback(id: string) {
    return this.channelMemories.commitWriteback(id)
  }

  rejectChannelMemoryWriteback(id: string, error: string) {
    return this.channelMemories.rejectWriteback(id, error)
  }

  createChannelChildSessionRun(row: Parameters<typeof this.channelChildRuns.create>[0]) {
    return this.channelChildRuns.create(row)
  }

  finishChannelChildSessionRun(id: string, updates: Parameters<typeof this.channelChildRuns.finish>[1]) {
    return this.channelChildRuns.finish(id, updates)
  }

  markChannelChildSessionRunDispatched(id: string, input: Parameters<typeof this.channelChildRuns.markDispatched>[1]) {
    return this.channelChildRuns.markDispatched(id, input)
  }

  markChannelChildSessionRunRunning(id: string) {
    return this.channelChildRuns.markRunning(id)
  }

  getChannelChildSessionRun(id: string) {
    return this.channelChildRuns.get(id)
  }

  getChannelChildSessionRunBySessionId(sessionId: string) {
    return this.channelChildRuns.getBySessionId(sessionId)
  }

  listRecentChannelChildSessionRuns(limit = 50) {
    return this.channelChildRuns.listRecent(limit)
  }

  createChannelIngressRouterRun(row: Parameters<typeof this.channelIngressRouterRuns.create>[0]) {
    return this.channelIngressRouterRuns.create(row)
  }

  attachChannelIngressRouterRunChild(id: string, childRunId: string) {
    return this.channelIngressRouterRuns.attachChildRun(id, childRunId)
  }

  getChannelIngressRouterRun(id: string) {
    return this.channelIngressRouterRuns.get(id)
  }

  listRecentChannelIngressRouterRuns(limit = 50) {
    return this.channelIngressRouterRuns.listRecent(limit)
  }

  createChannelCommandRun(row: Parameters<typeof this.channelCommands.create>[0]) {
    return this.channelCommands.create(row)
  }

  finishChannelCommandRun(id: string, updates: Parameters<typeof this.channelCommands.finish>[1]) {
    return this.channelCommands.finish(id, updates)
  }

  updateChannelCommandRunMetadata(id: string, metadata: Record<string, unknown>) {
    return this.channelCommands.updateMetadata(id, metadata)
  }

  getChannelCommandRun(id: string) {
    return this.channelCommands.get(id)
  }

  listRecentChannelCommandRuns(limit = 50) {
    return this.channelCommands.listRecent(limit)
  }

  upsertChannelAccount(row: Parameters<typeof this.channelIdentities.upsertAccount>[0]) {
    return this.channelIdentities.upsertAccount(row)
  }

  getChannelAccount(issuerKey: string, accountId: string) {
    return this.channelIdentities.getAccount(issuerKey, accountId)
  }

  ensureCanonicalUser(row?: Parameters<typeof this.channelIdentities.ensureCanonicalUser>[0]) {
    return this.channelIdentities.ensureCanonicalUser(row)
  }

  getCanonicalUser(id: string) {
    return this.channelIdentities.getCanonicalUser(id)
  }

  linkChannelAccountToUser(row: Parameters<typeof this.channelIdentities.linkAccountToUser>[0]) {
    return this.channelIdentities.linkAccountToUser(row)
  }

  createChannelIdentityLinkCode(row: Parameters<typeof this.channelIdentities.createIdentityLinkCode>[0]) {
    return this.channelIdentities.createIdentityLinkCode(row)
  }

  getChannelIdentityLinkCode(code: string) {
    return this.channelIdentities.getIdentityLinkCode(code)
  }

  consumeChannelIdentityLinkCode(row: Parameters<typeof this.channelIdentities.consumeIdentityLinkCode>[0]) {
    return this.channelIdentities.consumeIdentityLinkCode(row)
  }

  getChannelIdentityLink(issuerKey: string, accountId: string) {
    return this.channelIdentities.getIdentityLink(issuerKey, accountId)
  }

  resolveCanonicalUserByChannelAccount(issuerKey: string, accountId: string) {
    return this.channelIdentities.resolveUserByAccount(issuerKey, accountId)
  }

  listChannelAccountsForUser(userId: string) {
    return this.channelIdentities.listAccountsForUser(userId)
  }

  upsertChannelUserCredential(row: Parameters<typeof this.channelIdentities.upsertCredential>[0]) {
    return this.channelIdentities.upsertCredential(row)
  }

  getChannelUserCredential(issuerKey: string, userId: string, credentialKey: string) {
    return this.channelIdentities.getCredential(issuerKey, userId, credentialKey)
  }

  listChannelUserCredentials(issuerKey: string, userId: string) {
    return this.channelIdentities.listCredentialsForUser(issuerKey, userId)
  }

  reserveChannelWebhookNonce(input: Parameters<typeof this.channelPolicies.reserveWebhookNonce>[0]) {
    return this.channelPolicies.reserveWebhookNonce(input)
  }

  commitChannelWebhookNonce(input: Parameters<typeof this.channelPolicies.commitWebhookNonce>[0]) {
    return this.channelPolicies.commitWebhookNonce(input)
  }

  releaseChannelWebhookNonce(input: Parameters<typeof this.channelPolicies.releaseWebhookNonce>[0]) {
    return this.channelPolicies.releaseWebhookNonce(input)
  }

  migrateLegacyChannelIdentityNamespace(
    input: Parameters<typeof this.channelIdentities.migrateLegacyNamespace>[0]
  ) {
    return this.channelIdentities.migrateLegacyNamespace(input)
  }

  createChannelAuthorizationRequest(row: Parameters<typeof this.channelIdentities.createAuthorizationRequest>[0]) {
    return this.channelIdentities.createAuthorizationRequest(row)
  }

  getChannelAuthorizationRequest(id: string) {
    return this.channelIdentities.getAuthorizationRequest(id)
  }

  updateChannelAuthorizationRequest(
    id: string,
    updates: Parameters<typeof this.channelIdentities.updateAuthorizationRequest>[1]
  ) {
    return this.channelIdentities.updateAuthorizationRequest(id, updates)
  }

  resolveChannelAuthorizationRequest(
    input: Parameters<typeof this.channelIdentities.resolveAuthorizationRequest>[0]
  ) {
    return this.channelIdentities.resolveAuthorizationRequest(input)
  }

  listPendingChannelAuthorizationRequestsForUser(userId: string, channelType?: string) {
    return this.channelIdentities.listPendingAuthorizationRequestsForUser(userId, channelType)
  }

  listPendingChannelAuthorizationRequestsForAccount(accountId: string, channelType?: string) {
    return this.channelIdentities.listPendingAuthorizationRequestsForAccount(accountId, channelType)
  }

  listPendingChannelAuthorizationRequests(channelType?: string, limit?: number) {
    return this.channelIdentities.listPendingAuthorizationRequests(channelType, limit)
  }

  consumeChannelReplyThrottle(row: Parameters<typeof this.channelPolicies.consumeReplyThrottle>[0]) {
    return this.channelPolicies.consumeReplyThrottle(row)
  }

  releaseChannelReplyThrottle(row: Parameters<typeof this.channelPolicies.releaseReplyThrottle>[0]) {
    return this.channelPolicies.releaseReplyThrottle(row)
  }

  getChannelReplyThrottle(throttleKey: string) {
    return this.channelPolicies.getReplyThrottle(throttleKey)
  }

  pruneChannelReplyThrottles(now = Date.now()) {
    return this.channelPolicies.pruneReplyThrottles(now)
  }

  appendChannelOffhourBacklog(row: Parameters<typeof this.channelPolicies.appendOffhourBacklog>[0]) {
    return this.channelPolicies.appendOffhourBacklog(row)
  }

  claimChannelOffhourBacklog(input: Parameters<typeof this.channelPolicies.claimOffhourBacklog>[0]) {
    return this.channelPolicies.claimOffhourBacklog(input)
  }

  attachChannelOffhourBacklogDigestChildRun(
    input: Parameters<typeof this.channelPolicies.attachOffhourBacklogDigestChildRun>[0]
  ) {
    return this.channelPolicies.attachOffhourBacklogDigestChildRun(input)
  }

  completeChannelOffhourBacklogClaim(input: Parameters<typeof this.channelPolicies.completeOffhourBacklogClaim>[0]) {
    return this.channelPolicies.completeOffhourBacklogClaim(input)
  }

  retryChannelOffhourBacklogClaim(input: Parameters<typeof this.channelPolicies.retryOffhourBacklogClaim>[0]) {
    return this.channelPolicies.retryOffhourBacklogClaim(input)
  }

  getChannelAvailabilityOverride(channelLinkName: string) {
    return this.channelPolicies.getChannelAvailabilityOverride(channelLinkName)
  }

  setChannelAvailabilityOverride(input: Parameters<typeof this.channelPolicies.setChannelAvailabilityOverride>[0]) {
    return this.channelPolicies.setChannelAvailabilityOverride(input)
  }

  getChannelPolicyState(policyKey: string) {
    return this.channelPolicies.getChannelPolicyState(policyKey)
  }

  getChannelPolicyEventByEventKey(eventKey: string) {
    return this.channelPolicies.getChannelPolicyEventByEventKey(eventKey)
  }

  compareAndSetChannelPolicyState(row: Parameters<typeof this.channelPolicies.compareAndSetChannelPolicyState>[0]) {
    return this.channelPolicies.compareAndSetChannelPolicyState(row)
  }

  applyChannelPolicyHit(row: Parameters<typeof this.channelPolicies.applyChannelPolicyHit>[0]) {
    return this.channelPolicies.applyChannelPolicyHit(row)
  }

  appendChannelPolicyEvent(row: Parameters<typeof this.channelPolicies.appendChannelPolicyEvent>[0]) {
    return this.channelPolicies.appendChannelPolicyEvent(row)
  }

  listChannelPolicyEvents(policyKey: string, limit?: number) {
    return this.channelPolicies.listChannelPolicyEvents(policyKey, limit)
  }

  listRecentChannelPolicyEvents(limit?: number) {
    return this.channelPolicies.listRecentChannelPolicyEvents(limit)
  }

  getChannelOffhourBacklogItem(id: string) {
    return this.channelPolicies.getOffhourBacklogItem(id)
  }

  listPendingChannelOffhourBacklog(filter?: Parameters<typeof this.channelPolicies.listPendingOffhourBacklog>[0]) {
    return this.channelPolicies.listPendingOffhourBacklog(filter)
  }

  createChannelScenario(row: Parameters<typeof this.channelScenarios.create>[0]) {
    return this.channelScenarios.create(row)
  }

  getChannelScenario(id: string) {
    return this.channelScenarios.get(id)
  }

  listChannelScenarios() {
    return this.channelScenarios.list()
  }

  updateChannelScenario(id: string, row: Parameters<typeof this.channelScenarios.update>[1]) {
    return this.channelScenarios.update(id, row)
  }

  deleteChannelScenario(id: string) {
    return this.channelScenarios.remove(id)
  }

  markChannelOffhourBacklogProcessed(ids: string[], processedAt = Date.now()) {
    return this.channelPolicies.markOffhourBacklogProcessed(ids, processedAt)
  }

  listAgentRooms(filter: Parameters<typeof this.agentRooms.list>[0] = 'active') {
    return this.agentRooms.list(filter)
  }

  getAgentRoom(id: string) {
    return this.agentRooms.get(id)
  }

  getAgentRoomByHostSessionId(hostSessionId: string) {
    return this.agentRooms.getByHostSessionId(hostSessionId)
  }

  getAgentRoomDetail(id: string) {
    return this.agentRooms.getDetail(id)
  }

  createAgentRoom(params: Parameters<typeof this.agentRooms.create>[0]) {
    return this.agentRooms.create(params)
  }

  claimAgentRoomMessage(params: Parameters<typeof this.agentRooms.claimMessage>[0]) {
    return this.agentRooms.claimMessage(params)
  }

  ensureAgentRoomForHostSession(params: {
    hostSessionId: string
    title?: string
  }) {
    const existing = this.agentRooms.getByHostSessionId(params.hostSessionId)
    if (existing != null) {
      return existing
    }

    return this.agentRooms.create({
      hostSessionId: params.hostSessionId,
      title: params.title?.trim() || 'Agent room'
    })
  }

  updateAgentRoom(id: string, params: Parameters<typeof this.agentRooms.update>[1]) {
    return this.agentRooms.update(id, params)
  }

  updateAgentRoomMessagePayload(
    id: string,
    payload: Parameters<typeof this.agentRooms.updateMessagePayload>[1]
  ) {
    return this.agentRooms.updateMessagePayload(id, payload)
  }

  getAgentRoomMember(roomId: string, memberKey: string) {
    return this.agentRooms.getMember(roomId, memberKey)
  }

  listAgentRoomMembers(roomId: string) {
    return this.agentRooms.listMembers(roomId)
  }

  getAgentRoomRun(roomId: string, runKey: string) {
    return this.agentRooms.getRun(roomId, runKey)
  }

  listAgentRoomRunsForMember(roomId: string, memberKey: string) {
    return this.agentRooms.listRunsForMember(roomId, memberKey)
  }

  listAgentRoomRuns(roomId: string) {
    return this.agentRooms.listRuns(roomId)
  }

  saveAgentRoomMember(member: Parameters<typeof this.agentRooms.saveMember>[0]) {
    return this.agentRooms.saveMember(member)
  }

  saveAgentRoomRun(run: Parameters<typeof this.agentRooms.saveRun>[0]) {
    return this.agentRooms.saveRun(run)
  }

  appendAgentRoomMessage(message: Parameters<typeof this.agentRooms.appendMessage>[0]) {
    return this.agentRooms.appendMessage(message)
  }

  appendAgentRoomEvent(event: Parameters<typeof this.agentRooms.appendEvent>[0]) {
    return this.agentRooms.appendEvent(event)
  }

  getAgentRoomEventByIdempotencyKey(roomId: string, idempotencyKey: string) {
    return this.agentRooms.getEventByIdempotencyKey(roomId, idempotencyKey)
  }

  getAgentRoomMessageByIdempotencyKey(roomId: string, idempotencyKey: string) {
    return this.agentRooms.getMessageByIdempotencyKey(roomId, idempotencyKey)
  }

  getAgentRoomMessage(id: string) {
    return this.agentRooms.getMessage(id)
  }

  saveAgentRoomMessageDelivery(delivery: Parameters<typeof this.agentRooms.saveDelivery>[0]) {
    return this.agentRooms.saveDelivery(delivery)
  }

  saveAgentRoomChannelConnection(link: Parameters<typeof this.agentRooms.saveChannelConnection>[0]) {
    return this.agentRooms.saveChannelConnection(link)
  }

  findAgentRoomChannelConnections(input: Parameters<typeof this.agentRooms.findRoomChannelConnections>[0]) {
    return this.agentRooms.findRoomChannelConnections(input)
  }

  listAgentRoomChannelConnections(roomId: string) {
    return this.agentRooms.listChannelConnections(roomId)
  }

  listAgentRoomChannelConnectionsForMember(roomId: string, memberKey: string) {
    return this.agentRooms.listChannelConnectionsForMember(roomId, memberKey)
  }

  createAgentRoomShare(input: Parameters<typeof this.agentRooms.createShare>[0]) {
    return this.agentRooms.createShare(input)
  }

  createAgentRoomShareWithOwner(input: Parameters<typeof this.agentRooms.createShareWithOwner>[0]) {
    return this.agentRooms.createShareWithOwner(input)
  }

  listAgentRoomShares(roomId: string) {
    return this.agentRooms.listShares(roomId)
  }

  getAgentRoomShare(shareId: string) {
    return this.agentRooms.getShare(shareId)
  }

  revokeAgentRoomShare(roomId: string, shareId: string) {
    return this.agentRooms.revokeShare(roomId, shareId)
  }

  deleteAgentRoom(id: string) {
    return this.agentRooms.remove(id)
  }

  copyMessages(fromSessionId: string, toSessionId: string) {
    return this.messages.copy(fromSessionId, toSessionId)
  }

  createSession(
    title?: string,
    id?: string,
    status?: string,
    parentSessionId?: string,
    options: Parameters<typeof this.sessions.create>[4] = {}
  ) {
    return this.sessions.create(title, id, status, parentSessionId, options)
  }

  updateSessionTitle(id: string, title: string) {
    return this.sessions.setTitle(id, title)
  }

  updateSessionLastMessages(id: string, lastMessage?: string, lastUserMessage?: string) {
    return this.sessions.setLastMessages(id, lastMessage, lastUserMessage)
  }

  deleteSession(id: string) {
    return this.sessions.remove(id)
  }

  close() {
    this.db.close()
  }

  listAutomationRules() {
    return this.automation.listRules()
  }

  listAutomationRuleDetails() {
    return this.automation.listRuleDetails()
  }

  getAutomationRuleDetail(id: string) {
    return this.automation.getRuleDetail(id)
  }

  getAutomationRule(id: string) {
    return this.automation.getRule(id)
  }

  createAutomationRule(rule: AutomationRule) {
    return this.automation.createRule(rule)
  }

  updateAutomationRule(id: string, updates: Partial<Omit<AutomationRule, 'id' | 'createdAt'>>) {
    return this.automation.updateRule(id, updates)
  }

  deleteAutomationRule(id: string) {
    return this.automation.removeRule(id)
  }

  listAutomationTriggers(ruleId: string) {
    return this.automation.listTriggers(ruleId)
  }

  getAutomationTrigger(id: string) {
    return this.automation.getTrigger(id)
  }

  replaceAutomationTriggers(
    ruleId: string,
    triggers: Array<Omit<AutomationTrigger, 'id' | 'ruleId' | 'createdAt'> & { id?: string }>
  ) {
    return this.automation.replaceTriggers(ruleId, triggers)
  }

  listAutomationTasks(ruleId: string) {
    return this.automation.listTasks(ruleId)
  }

  replaceAutomationTasks(
    ruleId: string,
    tasks: Array<Omit<AutomationTask, 'id' | 'ruleId' | 'createdAt'> & { id?: string }>
  ) {
    return this.automation.replaceTasks(ruleId, tasks)
  }

  createAutomationRun(ruleId: string, sessionId: string, taskId?: string | null, taskTitle?: string | null) {
    return this.automation.createRun(ruleId, sessionId, taskId, taskTitle)
  }

  listAutomationRuns(ruleId: string, limit = 50) {
    return this.automation.listRuns(ruleId, limit)
  }
}

let dbInstance: SqliteDb | null = null

export function getDb() {
  if (!dbInstance) {
    dbInstance = new SqliteDb()
  }
  return dbInstance
}

export type {
  AutomationBranchMode,
  AutomationRule,
  AutomationRuleDetail,
  AutomationRun,
  AutomationTask,
  AutomationTrigger
}
export type { ChannelCommandRunPermission, ChannelCommandRunRow, ChannelCommandRunSource, ChannelCommandRunStatus }
export type {
  CanonicalUserRow,
  ChannelAccountRow,
  ChannelAuthorizationRequestRow,
  ChannelCredentialStatus,
  ChannelIdentityLinkCodeConsumeResult,
  ChannelIdentityLinkCodeRow,
  ChannelIdentityLinkCodeStatus,
  ChannelIdentityLinkRow,
  ChannelIdentityLinkStatus,
  ChannelUserCredentialRow
}
export type { ChannelPolicyType, ChannelReplyThrottleRow }
export type { SessionWorkspaceRow }
