import { afterEach, describe, expect, it } from 'vitest'

import { agentRoomsSchemaModule } from '../../src/db/agentRooms/schema'
import { automationSchemaModule } from '../../src/db/automation/schema'
import { channelChildRunsSchemaModule } from '../../src/db/channelChildRuns/schema'
import { channelCommandsSchemaModule } from '../../src/db/channelCommands/schema'
import { channelConversationsSchemaModule } from '../../src/db/channelConversations/schema'
import { channelIdentitiesSchemaModule } from '../../src/db/channelIdentities/schema'
import { channelPoliciesSchemaModule } from '../../src/db/channelPolicies/schema'
import { channelSessionsSchemaModule } from '../../src/db/channelSessions/schema'
import { initSchema } from '../../src/db/schema'
import type { SchemaModule } from '../../src/db/schema'
import { sessionsSchemaModule } from '../../src/db/sessions/schema'
import { createSqliteDatabase } from '../../src/db/sqlite'
import type { SqliteDatabase } from '../../src/db/sqlite'

describe('db schema modules', () => {
  let sqlite: SqliteDatabase | undefined

  afterEach(() => {
    sqlite?.close()
    sqlite = undefined
  })

  it('supports injected schema modules', () => {
    sqlite = createSqliteDatabase(':memory:')
    const customSchemaModule: SchemaModule = {
      name: 'custom',
      apply({ exec }) {
        exec('CREATE TABLE IF NOT EXISTS custom_records (id TEXT PRIMARY KEY, name TEXT NOT NULL);')
      }
    }

    initSchema(sqlite, [customSchemaModule])

    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").all(
      'custom_records'
    )
    expect(tables).toHaveLength(1)
  })

  it('migrates missing columns in domain schema modules', () => {
    sqlite = createSqliteDatabase(':memory:')
    sqlite.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        title TEXT,
        createdAt INTEGER NOT NULL
      );
      CREATE TABLE channel_sessions (
        channelType TEXT NOT NULL,
        sessionType TEXT NOT NULL,
        channelId TEXT NOT NULL,
        channelKey TEXT NOT NULL,
        sessionId TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        PRIMARY KEY (channelType, sessionType, channelId)
      );
      CREATE TABLE automation_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        prompt TEXT NOT NULL
      );
      CREATE TABLE automation_triggers (
        id TEXT PRIMARY KEY,
        ruleId TEXT NOT NULL,
        type TEXT NOT NULL
      );
      CREATE TABLE automation_tasks (
        id TEXT PRIMARY KEY,
        ruleId TEXT NOT NULL
      );
      CREATE TABLE automation_runs (
        id TEXT PRIMARY KEY,
        ruleId TEXT NOT NULL,
        sessionId TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      );
      CREATE TABLE agent_rooms (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        hostSessionId TEXT,
        status TEXT NOT NULL,
        lastMessage TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
    `)

    initSchema(sqlite, [
      sessionsSchemaModule,
      channelSessionsSchemaModule,
      channelConversationsSchemaModule,
      channelChildRunsSchemaModule,
      channelCommandsSchemaModule,
      channelIdentitiesSchemaModule,
      channelPoliciesSchemaModule,
      automationSchemaModule,
      agentRoomsSchemaModule
    ])

    const sessionColumns = sqlite.prepare('PRAGMA table_info(sessions)').all<{ name: string }>()
    const channelColumns = sqlite.prepare('PRAGMA table_info(channel_sessions)').all<{ name: string }>()
    const channelPreferenceColumns = sqlite.prepare('PRAGMA table_info(channel_preferences)').all<{ name: string }>()
    const conversationStateColumns = sqlite.prepare('PRAGMA table_info(channel_conversation_states)').all<
      { name: string }
    >()
    const conversationTurnColumns = sqlite.prepare('PRAGMA table_info(channel_conversation_turns)').all<
      { name: string }
    >()
    const pendingIntentColumns = sqlite.prepare('PRAGMA table_info(channel_pending_intents)').all<{ name: string }>()
    const childRunColumns = sqlite.prepare('PRAGMA table_info(channel_child_session_runs)').all<{ name: string }>()
    const commandRunColumns = sqlite.prepare('PRAGMA table_info(channel_command_runs)').all<{ name: string }>()
    const channelAccountColumns = sqlite.prepare('PRAGMA table_info(channel_accounts)').all<{ name: string }>()
    const identityLinkColumns = sqlite.prepare('PRAGMA table_info(channel_identity_links)').all<{ name: string }>()
    const credentialColumns = sqlite.prepare('PRAGMA table_info(channel_user_credentials)').all<{ name: string }>()
    const authorizationColumns = sqlite.prepare('PRAGMA table_info(channel_authorization_requests)').all<
      { name: string }
    >()
    const replyThrottleColumns = sqlite.prepare('PRAGMA table_info(channel_reply_throttles)').all<{ name: string }>()
    const offhourBacklogColumns = sqlite.prepare('PRAGMA table_info(channel_offhour_backlog)').all<{ name: string }>()
    const automationRuleColumns = sqlite.prepare('PRAGMA table_info(automation_rules)').all<{ name: string }>()
    const automationTaskColumns = sqlite.prepare('PRAGMA table_info(automation_tasks)').all<{ name: string }>()
    const automationRunColumns = sqlite.prepare('PRAGMA table_info(automation_runs)').all<{ name: string }>()
    const agentRoomColumns = sqlite.prepare('PRAGMA table_info(agent_rooms)').all<{ name: string }>()

    expect(sessionColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'parentSessionId',
      'messageBranchGroupId',
      'messageBranchSourceSessionId',
      'messageBranchSourceMessageId',
      'messageBranchBaseMessageIndex',
      'messageBranchAction',
      'lastMessage',
      'lastUserMessage',
      'runtimeKind',
      'channelActorSnapshot',
      'historySeed',
      'historySeedPending',
      'isStarred',
      'isArchived',
      'status',
      'model',
      'adapter',
      'fastMode',
      'permissionMode',
      'panelState',
      'historyImport'
    ]))
    expect(channelColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'senderId',
      'replyReceiveId',
      'replyReceiveIdType'
    ]))
    expect(channelPreferenceColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'channelType',
      'sessionType',
      'channelId',
      'channelKey',
      'adapter',
      'permissionMode',
      'createdAt',
      'updatedAt'
    ]))
    expect(conversationStateColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'id',
      'channelType',
      'channelKey',
      'channelId',
      'sessionType',
      'channelLinkName',
      'entity',
      'threadKey',
      'activeParticipantsJson',
      'recentTurnIdsJson',
      'pendingIntentIdsJson',
      'lastChildRunId',
      'lastMessageId',
      'updatedAt'
    ]))
    expect(conversationTurnColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'id',
      'conversationStateId',
      'threadKey',
      'channelType',
      'channelKey',
      'channelId',
      'sessionType',
      'childRunId',
      'actorUserId',
      'actorAccountId',
      'senderId',
      'messageId',
      'role',
      'text',
      'summary',
      'createdAt',
      'metadataJson'
    ]))
    expect(pendingIntentColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'id',
      'conversationStateId',
      'threadKey',
      'channelType',
      'channelKey',
      'channelId',
      'sessionType',
      'channelLinkName',
      'entity',
      'ownerUserId',
      'ownerAccountId',
      'approverUserIdsJson',
      'createdByChildRunId',
      'authorizationRequestId',
      'kind',
      'status',
      'requiredAction',
      'delivery',
      'payloadJson',
      'createdAt',
      'updatedAt',
      'expiresAt',
      'resolvedAt',
      'metadataJson'
    ]))
    expect(childRunColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'id',
      'channelType',
      'channelKey',
      'channelId',
      'sessionType',
      'channelLinkName',
      'entity',
      'actorUserId',
      'actorAccountId',
      'senderId',
      'messageId',
      'sessionId',
      'conversationStateId',
      'threadKey',
      'triggerType',
      'dispatchMode',
      'status',
      'startedAt',
      'completedAt',
      'error',
      'metadataJson'
    ]))
    expect(commandRunColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'id',
      'channelType',
      'channelKey',
      'channelId',
      'sessionType',
      'channelLinkName',
      'entity',
      'actorUserId',
      'actorAccountId',
      'senderId',
      'messageId',
      'source',
      'commandName',
      'commandPathJson',
      'rawArgsJson',
      'permission',
      'status',
      'startedAt',
      'completedAt',
      'error',
      'metadataJson'
    ]))
    expect(channelAccountColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'channelType',
      'accountId',
      'accountKey',
      'displayName',
      'metadataJson'
    ]))
    expect(identityLinkColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'channelType',
      'accountId',
      'userId',
      'status',
      'source'
    ]))
    expect(credentialColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'userId',
      'channelType',
      'credentialKey',
      'status',
      'scopesJson'
    ]))
    expect(authorizationColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'id',
      'channelType',
      'channelLinkName',
      'requesterUserId',
      'requesterAccountId',
      'credentialSubjectUserId',
      'credentialKey',
      'capability',
      'status',
      'resolvedAt'
    ]))
    expect(replyThrottleColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'throttleKey',
      'policyType',
      'channelType',
      'channelId',
      'channelLinkName',
      'lastSentAt',
      'expiresAt'
    ]))
    expect(offhourBacklogColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'id',
      'channelType',
      'channelKey',
      'channelId',
      'sessionType',
      'channelLinkName',
      'entity',
      'senderId',
      'actorUserId',
      'messageId',
      'text',
      'createdAt',
      'processedAt'
    ]))
    expect(automationRuleColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'description',
      'intervalMs',
      'webhookKey',
      'cronExpression',
      'enabled',
      'createdAt',
      'lastRunAt',
      'lastSessionId'
    ]))
    expect(automationTaskColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'title',
      'prompt',
      'model',
      'adapter',
      'effort',
      'permissionMode',
      'createWorktree',
      'branchName',
      'branchKind',
      'branchMode',
      'createdAt'
    ]))
    expect(automationRunColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'taskId',
      'taskTitle'
    ]))
    expect(agentRoomColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'archivedAt',
      'favoritedAt'
    ]))
  })

  it('backfills imported session provenance from the original message timeline', () => {
    sqlite = createSqliteDatabase(':memory:')
    sqlite.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        adapter TEXT,
        createdAt INTEGER NOT NULL
      );
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sessionId TEXT NOT NULL,
        data TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      );
      INSERT INTO sessions (id, adapter, createdAt)
      VALUES ('imported_codex_legacy', 'codex', 2000);
      INSERT INTO messages (sessionId, data, createdAt)
      VALUES (
        'imported_codex_legacy',
        '{"type":"message","message":{"createdAt":1000}}',
        2000
      );
    `)

    initSchema(sqlite, [sessionsSchemaModule])
    initSchema(sqlite, [sessionsSchemaModule])

    const row = sqlite.prepare('SELECT historyImport FROM sessions WHERE id = ?')
      .get<{ historyImport: string }>('imported_codex_legacy')
    expect(JSON.parse(row!.historyImport)).toEqual({
      adapter: 'codex',
      importedAt: 2000,
      sourceUpdatedAt: 1000
    })
  })
})
