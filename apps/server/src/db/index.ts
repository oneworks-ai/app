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
import { createChannelMessagesRepo } from './channelMessages/repo'
import { channelMessagesSchemaModule } from './channelMessages/schema'
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
import type { SessionRuntimeState } from './sessions/repo'
import { sessionsSchemaModule } from './sessions/schema'
import { createTagsRepo } from './sessions/tags.repo'
import type { SqliteDatabase } from './sqlite'

const dbSchemaModules = [
  sessionsSchemaModule,
  sessionWorkspacesSchemaModule,
  channelSessionsSchemaModule,
  channelMessagesSchemaModule,
  channelActionTokensSchemaModule,
  agentRoomsSchemaModule,
  automationSchemaModule
] as const

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
  private channelActionTokens: ReturnType<typeof createChannelActionTokensRepo>
  private agentRooms: ReturnType<typeof createAgentRoomsRepo>
  private tags: ReturnType<typeof createTagsRepo>
  private automation: ReturnType<typeof createAutomationRepo>

  constructor(options: SqliteDbOptions = {}) {
    this.db = options.db ?? createConnection().db
    initSchema(this.db, dbSchemaModules)
    this.sessions = createSessionsRepo(this.db)
    this.messages = createMessagesRepo(this.db)
    this.sessionWorkspaces = createSessionWorkspacesRepo(this.db)
    this.sessionQueue = createSessionQueueRepo(this.db)
    this.channelSessions = createChannelSessionsRepo(this.db)
    this.channelMessages = createChannelMessagesRepo(this.db)
    this.channelActionTokens = createChannelActionTokensRepo(this.db)
    this.agentRooms = createAgentRoomsRepo(this.db)
    this.tags = createTagsRepo(this.db)
    this.automation = createAutomationRepo(this.db)
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
    return this.messages.save(sessionId, data)
  }

  getMessages(sessionId: string) {
    return this.messages.list(sessionId)
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

  getChannelSession(channelType: string, sessionType: string, channelId: string) {
    return this.channelSessions.get(channelType, sessionType, channelId)
  }

  getChannelPreference(channelType: string, sessionType: string, channelId: string) {
    return this.channelSessions.getPreference(channelType, sessionType, channelId)
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

  deleteChannelSession(channelType: string, sessionType: string, channelId: string) {
    return this.channelSessions.remove(channelType, sessionType, channelId)
  }

  rememberChannelMessage(messageKey: string, seenAt = Date.now()) {
    return this.channelMessages.rememberSeen(messageKey, seenAt)
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

  getAgentRoomMember(roomId: string, memberKey: string) {
    return this.agentRooms.getMember(roomId, memberKey)
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
export type { SessionWorkspaceRow }
