/* eslint-disable max-lines -- Public SqliteDb integration coverage intentionally shares one in-memory fixture. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SqliteDb } from '#~/db/index.js'
import { createSqliteDatabase } from '#~/db/sqlite.js'
import type { SqliteDatabase } from '#~/db/sqlite.js'
import { encodeChannelRuntimeKey } from '#~/services/channel-runtime-key.js'

describe('sqliteDb', () => {
  let sqlite: SqliteDatabase
  let db: SqliteDb

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-18T00:00:00.000Z'))
    sqlite = createSqliteDatabase(':memory:')
    db = new SqliteDb({ db: sqlite })
  })

  afterEach(() => {
    db.close()
    vi.useRealTimers()
  })

  it('atomically persists policy hit state with an idempotent event and CAS revision', () => {
    const accountPrincipal = encodeChannelRuntimeKey('lark:main', 'account-1')
    const policyKey = encodeChannelRuntimeKey('support', 'account', accountPrincipal)
    const event = {
      actorAccountId: accountPrincipal,
      channelLinkName: 'support',
      eventKey: 'event-1',
      eventType: 'hit',
      policyKey
    }
    const state = {
      channelLinkName: 'support',
      hitWindowStartedAt: Date.now(),
      hits: 1,
      mutedUntil: null,
      policyKey: event.policyKey,
      reason: 'spam',
      scope: 'account' as const,
      state: 'warned' as const,
      subjectKey: accountPrincipal,
      updatedAt: Date.now(),
      updatedBy: 'test'
    }

    expect(db.applyChannelPolicyHit({ event, resolveState: () => state })).toMatchObject({
      applied: true,
      state: { revision: 1 }
    })
    expect(db.applyChannelPolicyHit({ event, resolveState: () => ({ ...state, hits: 99 }) })).toMatchObject({
      applied: false,
      state: { hits: 1 }
    })
    expect(db.compareAndSetChannelPolicyState({ ...state, expectedRevision: 1, hits: 2 })).toMatchObject({
      hits: 2,
      revision: 2
    })
    expect(db.compareAndSetChannelPolicyState({ ...state, expectedRevision: 1, hits: 3 })).toBeUndefined()
    expect(db.listChannelPolicyEvents(event.policyKey)).toHaveLength(1)
    expect(db.listRecentChannelPolicyEvents()).toEqual([
      expect.objectContaining({ channelLinkName: 'support', eventKey: 'event-1' })
    ])

    const secondAccountPrincipal = encodeChannelRuntimeKey('lark:main', 'account-2')
    const secondPolicyKey = encodeChannelRuntimeKey('support', 'account', secondAccountPrincipal)
    expect(db.applyChannelPolicyHit({
      event: {
        ...event,
        actorAccountId: secondAccountPrincipal,
        eventKey: 'event-2',
        policyKey: secondPolicyKey
      },
      resolveState: () => ({
        ...state,
        policyKey: secondPolicyKey,
        subjectKey: secondAccountPrincipal
      })
    })).toMatchObject({ applied: true, state: { revision: 1 } })
    expect(db.getChannelPolicyState(policyKey)).toEqual(expect.objectContaining({ subjectKey: accountPrincipal }))
    expect(db.getChannelPolicyState(secondPolicyKey)).toEqual(
      expect.objectContaining({ subjectKey: secondAccountPrincipal })
    )
  })

  it('lists every structured memory attributed to an entity', () => {
    const base = {
      confidence: .8,
      entity: 'reviewer',
      importance: .7,
      issuer: 'main',
      keywords: ['review'],
      orgId: 'workspace-local',
      pinned: false,
      sensitivity: 'normal' as const,
      source: {
        channelId: 'chat-1',
        channelKey: 'main',
        channelType: 'lark',
        issuer: 'main',
        org: 'workspace-local',
        sessionType: 'group'
      }
    }
    db.upsertChannelMemory({
      ...base,
      content: 'entity memory',
      id: 'entity-memory',
      subjectId: 'reviewer',
      subjectType: 'entity'
    })
    db.upsertChannelMemory({
      ...base,
      accountId: 'account-1',
      content: 'account memory',
      id: 'account-memory',
      subjectId: 'account-1',
      subjectType: 'account'
    })
    db.upsertChannelMemory({
      ...base,
      content: 'unrelated memory',
      entity: 'other',
      id: 'other-memory',
      subjectId: 'other',
      subjectType: 'entity'
    })

    expect(db.listChannelMemoriesByEntity('reviewer').map(memory => memory.id).sort()).toEqual([
      'account-memory',
      'entity-memory'
    ])
  })

  it('leases, retries, and completes off-hours backlog rows with owner-scoped CAS', () => {
    db.appendChannelOffhourBacklog({
      channelId: 'oc_1',
      channelKey: 'lark-main',
      channelLinkName: 'support',
      channelType: 'lark',
      entity: 'assistant',
      id: 'backlog-1',
      sessionType: 'group',
      text: 'first'
    })
    db.appendChannelOffhourBacklog({
      channelId: 'oc_2',
      channelKey: 'lark-main',
      channelLinkName: 'support',
      channelType: 'lark',
      entity: 'assistant',
      id: 'backlog-2',
      sessionType: 'group',
      text: 'separate target'
    })

    const firstClaim = db.claimChannelOffhourBacklog({ leaseMs: 100, leaseOwner: 'worker-a' })
    expect(firstClaim).toHaveLength(1)
    expect(firstClaim[0]).toMatchObject({ attempts: 1, id: 'backlog-1', status: 'leased' })
    expect(db.completeChannelOffhourBacklogClaim({ ids: ['backlog-1'], leaseOwner: 'worker-b' })).toBe(0)
    expect(db.retryChannelOffhourBacklogClaim({ error: 'dispatch failed', ids: ['backlog-1'], leaseOwner: 'worker-a' }))
      .toBe(1)
    expect(db.getChannelOffhourBacklogItem('backlog-1')).toMatchObject({
      lastError: 'dispatch failed',
      status: 'pending'
    })

    const secondClaim = db.claimChannelOffhourBacklog({ leaseMs: 100, leaseOwner: 'worker-b' })
    expect(secondClaim).toHaveLength(1)
    expect(secondClaim[0]).toMatchObject({ attempts: 2, id: 'backlog-1', status: 'leased' })
    expect(db.attachChannelOffhourBacklogDigestChildRun({
      digestChildRunId: 'digest-1',
      ids: ['backlog-1'],
      leaseOwner: 'worker-b'
    })).toBe(1)
    expect(db.completeChannelOffhourBacklogClaim({ ids: ['backlog-1'], leaseOwner: 'worker-b' })).toBe(1)
    expect(db.getChannelOffhourBacklogItem('backlog-1')).toMatchObject({
      digestChildRunId: 'digest-1',
      processedAt: expect.any(Number),
      status: 'processed'
    })

    db.appendChannelOffhourBacklog({
      channelId: 'oc_3',
      channelKey: 'lark-main',
      channelLinkName: 'support',
      channelType: 'lark',
      entity: 'assistant',
      id: 'backlog-stale',
      sessionType: 'group'
    })
    const staleFilter = { channelId: 'oc_3' }
    expect(db.claimChannelOffhourBacklog({ filter: staleFilter, leaseMs: 100, leaseOwner: 'worker-c', now: 1_000 }))
      .toHaveLength(1)
    expect(db.claimChannelOffhourBacklog({ filter: staleFilter, leaseMs: 100, leaseOwner: 'worker-d', now: 1_099 }))
      .toHaveLength(0)
    expect(db.claimChannelOffhourBacklog({ filter: staleFilter, leaseMs: 100, leaseOwner: 'worker-d', now: 1_100 }))
      .toMatchObject([
        { attempts: 2, id: 'backlog-stale', leaseOwner: 'worker-d' }
      ])
  })

  it('keeps session, message and tag persistence compatible through the public API', () => {
    const root = db.createSession('Root session', 'session-root', 'running')

    db.saveMessage(root.id, { role: 'user', content: 'hello' })
    db.updateSession(root.id, {
      lastMessage: 'assistant reply',
      lastUserMessage: 'hello',
      isStarred: true,
      model: 'gpt-test',
      adapter: 'adapter-test',
      fastMode: true,
      permissionMode: 'plan',
      promptType: 'workspace',
      promptName: 'client'
    })
    db.updateSessionTags(root.id, ['alpha', 'beta', 'alpha'])

    const stored = db.getSession(root.id)
    expect(db.getSessionStatus(root.id)).toBe('running')
    expect(db.getSessionStatus('missing-session')).toBeUndefined()
    expect(stored).toEqual({
      id: 'session-root',
      title: 'Root session',
      createdAt: Date.now(),
      messageCount: 1,
      lastMessage: 'assistant reply',
      lastUserMessage: 'hello',
      isStarred: true,
      isArchived: false,
      tags: expect.any(Array),
      status: 'running',
      model: 'gpt-test',
      adapter: 'adapter-test',
      fastMode: true,
      permissionMode: 'plan',
      promptType: 'workspace',
      promptName: 'client'
    })
    expect(stored?.tags?.slice().sort()).toEqual(['alpha', 'beta'])
    expect(db.getMessages(root.id)).toEqual([{ role: 'user', content: 'hello' }])

    const child = db.createSession('Child session', 'session-child', 'completed', root.id, {
      runtimeKind: 'interactive',
      historySeed: 'seed prompt',
      historySeedPending: true
    })
    db.copyMessages(root.id, child.id)

    expect(db.getMessages(child.id)).toEqual([{ role: 'user', content: 'hello' }])
    expect(db.getSession(child.id)).toEqual(expect.objectContaining({
      id: 'session-child',
      parentSessionId: 'session-root',
      status: 'completed',
      messageCount: 1
    }))
    expect(db.getSessionRuntimeState(child.id)).toEqual({
      runtimeKind: 'interactive',
      historySeed: 'seed prompt',
      historySeedPending: true,
      permissionState: {
        allow: [],
        deny: [],
        onceAllow: [],
        onceDeny: []
      }
    })
  })

  it('persists imported session provenance through create and update', () => {
    const historyImport = { adapter: 'codex', importedAt: 2_000, sourceUpdatedAt: 1_000 }
    const session = db.createSession('Imported session', 'imported_codex_test', 'completed', undefined, {
      historyImport
    })
    expect(db.getSession(session.id)?.historyImport).toEqual(historyImport)

    db.updateSession(session.id, {
      historyImport: {
        ...historyImport,
        sourceUpdatedAt: 1_500
      }
    })
    expect(db.getSession(session.id)?.historyImport?.sourceUpdatedAt).toBe(1_500)

    sqlite.prepare('UPDATE sessions SET historyImport = ? WHERE id = ?').run('{invalid', session.id)
    expect(db.getSession(session.id)?.historyImport).toBeUndefined()
    expect(db.getSessions('all').some(({ id }) => id === session.id)).toBe(true)
  })

  it('persists channel actor snapshots in session runtime state', () => {
    const session = db.createSession('Channel child', 'session-channel', 'running', undefined, {
      channelActorSnapshot: {
        actorAccountId: 'ou_1',
        actorUserId: 'user-1',
        capturedAt: Date.now(),
        channelId: 'oc_1',
        channelKey: 'lark-main',
        channelType: 'lark',
        childRunId: 'child-run-1',
        conversationStateId: 'conversation-1',
        messageId: 'om_1',
        senderId: 'ou_1',
        sessionId: 'session-channel',
        sessionType: 'group',
        threadKey: 'group:owo-demo:actor:user-1'
      }
    })

    expect(db.getSessionRuntimeState(session.id)).toEqual(expect.objectContaining({
      channelActorSnapshot: expect.objectContaining({
        actorAccountId: 'ou_1',
        actorUserId: 'user-1',
        channelId: 'oc_1',
        channelKey: 'lark-main',
        channelType: 'lark',
        childRunId: 'child-run-1',
        conversationStateId: 'conversation-1',
        messageId: 'om_1',
        senderId: 'ou_1',
        sessionId: 'session-channel',
        sessionType: 'group',
        threadKey: 'group:owo-demo:actor:user-1'
      })
    }))

    db.updateSessionRuntimeState(session.id, {
      channelActorSnapshot: {
        actorAccountId: 'ou_2',
        channelId: 'oc_1',
        channelKey: 'lark-main',
        channelType: 'lark',
        messageId: 'om_2',
        senderId: 'ou_2',
        sessionId: 'session-channel',
        sessionType: 'group'
      }
    })

    expect(db.getSessionRuntimeState(session.id)?.channelActorSnapshot).toEqual(expect.objectContaining({
      actorAccountId: 'ou_2',
      messageId: 'om_2',
      senderId: 'ou_2'
    }))
  })

  it('consumes a one-shot session permission exactly once', () => {
    db.createSession('Permission child', 'session-permission', 'running', undefined, {
      permissionState: {
        allow: [],
        deny: [],
        onceAllow: ['Write'],
        onceDeny: []
      }
    })

    expect(db.consumeSessionPermissionOnce('session-permission', ['Write'])).toEqual(expect.objectContaining({
      decision: 'allow',
      key: 'Write'
    }))
    expect(db.consumeSessionPermissionOnce('session-permission', ['Write'])).toBeUndefined()
  })

  it('moves one-shot permissions to exactly one child session', () => {
    db.createSession('Permission parent', 'permission-parent', 'running', undefined, {
      permissionState: {
        allow: ['Read'],
        deny: [],
        onceAllow: ['Write'],
        onceDeny: []
      }
    })
    db.createSession('Permission child A', 'permission-child-a', 'running', 'permission-parent')
    db.createSession('Permission child B', 'permission-child-b', 'running', 'permission-parent')

    expect(db.transferSessionPermissionState('permission-parent', 'permission-child-a')).toEqual({
      allow: ['Read'],
      deny: [],
      onceAllow: ['Write'],
      onceDeny: []
    })
    expect(db.transferSessionPermissionState('permission-parent', 'permission-child-b')).toEqual({
      allow: ['Read'],
      deny: [],
      onceAllow: [],
      onceDeny: []
    })
  })

  it('persists channel child session run audit records', () => {
    const run = db.createChannelChildSessionRun({
      id: 'child-run-1',
      actorAccountId: 'ou_1',
      actorUserId: 'user-yijie',
      channelId: 'oc_1',
      channelKey: 'lark-main',
      channelLinkName: 'wan-ke-chat',
      channelType: 'lark',
      dispatchMode: 'create_session',
      entity: 'owo-demo',
      messageId: 'om_1',
      metadata: {
        contentKind: 'text',
        model: 'gpt-test'
      },
      conversationStateId: 'conversation-1',
      senderId: 'ou_1',
      sessionType: 'group',
      threadKey: 'group:owo-demo:actor:user-yijie',
      triggerType: 'message'
    })

    expect(run).toEqual(expect.objectContaining({
      id: 'child-run-1',
      actorAccountId: 'ou_1',
      actorUserId: 'user-yijie',
      channelId: 'oc_1',
      channelKey: 'lark-main',
      channelLinkName: 'wan-ke-chat',
      dispatchMode: 'create_session',
      entity: 'owo-demo',
      messageId: 'om_1',
      metadata: {
        contentKind: 'text',
        model: 'gpt-test'
      },
      conversationStateId: 'conversation-1',
      status: 'started',
      threadKey: 'group:owo-demo:actor:user-yijie',
      triggerType: 'message'
    }))

    db.markChannelChildSessionRunDispatched('child-run-1', { sessionId: 'sess-channel-1' })

    expect(db.getChannelChildSessionRun('child-run-1')).toEqual(expect.objectContaining({
      completedAt: null,
      sessionId: 'sess-channel-1',
      status: 'dispatched'
    }))
    expect(db.listRecentChannelChildSessionRuns(1)).toEqual([
      expect.objectContaining({ id: 'child-run-1' })
    ])
  })

  it('maintains channel conversation state and recent turns', () => {
    const state = db.ensureChannelConversationState({
      channelId: 'oc_1',
      channelKey: 'lark-main',
      channelLinkName: 'wan-ke-chat',
      channelType: 'lark',
      entity: 'owo-demo',
      metadata: {
        resolver: 'deterministic-v1'
      },
      sessionType: 'group',
      threadKey: 'group:owo-demo:actor:user-yijie'
    })

    expect(state).toEqual(expect.objectContaining({
      channelId: 'oc_1',
      channelKey: 'lark-main',
      entity: 'owo-demo',
      threadKey: 'group:owo-demo:actor:user-yijie',
      activeParticipants: [],
      recentTurnIds: []
    }))

    const turn = db.appendChannelConversationTurn({
      actorAccountId: 'ou_1',
      actorUserId: 'user-yijie',
      channelId: 'oc_1',
      channelKey: 'lark-main',
      channelLinkName: 'wan-ke-chat',
      channelType: 'lark',
      childRunId: 'child-run-1',
      conversationStateId: state.id,
      entity: 'owo-demo',
      messageId: 'om_1',
      role: 'inbound',
      senderId: 'ou_1',
      sessionType: 'group',
      summary: '@OWO 看看发布计划',
      text: '@OWO 看看发布计划',
      threadKey: state.threadKey
    })

    expect(turn).toEqual(expect.objectContaining({
      actorUserId: 'user-yijie',
      childRunId: 'child-run-1',
      conversationStateId: state.id,
      messageId: 'om_1',
      role: 'inbound',
      text: '@OWO 看看发布计划'
    }))
    expect(db.getChannelConversationState(state.id)).toEqual(expect.objectContaining({
      activeParticipants: ['user-yijie', 'ou_1'],
      lastChildRunId: 'child-run-1',
      lastMessageId: 'om_1',
      recentTurnIds: [turn.id]
    }))
    expect(db.listRecentChannelConversationTurns(state.id)).toEqual([
      expect.objectContaining({ id: turn.id })
    ])
    expect(db.listRecentChannelConversationTurnsByType('lark')).toEqual([
      expect.objectContaining({ id: turn.id })
    ])
    expect(db.listRecentChannelConversationTurnsByType('oneworks')).toEqual([])
  })

  it('isolates conversation state for the same external chat across channel issuers', () => {
    const first = db.ensureChannelConversationState({
      channelId: 'oc_shared',
      channelKey: 'lark-app-a',
      channelType: 'lark',
      entity: 'owo-demo',
      sessionType: 'group',
      threadKey: 'group:owo-demo:actor:user-yijie'
    })
    const second = db.ensureChannelConversationState({
      channelId: 'oc_shared',
      channelKey: 'lark-app-b',
      channelType: 'lark',
      entity: 'owo-demo',
      sessionType: 'group',
      threadKey: 'group:owo-demo:actor:user-yijie'
    })

    expect(first.id).not.toBe(second.id)
    expect(first.channelKey).toBe('lark-app-a')
    expect(second.channelKey).toBe('lark-app-b')
  })

  it('atomically reuses one conversation state for concurrent equivalent initialization', async () => {
    const input = {
      channelId: 'oc_shared',
      channelKey: 'lark-main',
      channelType: 'lark',
      entity: undefined,
      sessionType: 'group',
      threadKey: 'group:default:actor:user-yijie'
    }

    const [first, second] = await Promise.all([
      Promise.resolve().then(() => db.ensureChannelConversationState(input)),
      Promise.resolve().then(() => db.ensureChannelConversationState(input))
    ])

    expect(first.id).toBe(second.id)
    expect(db.getChannelConversationStateByThread(input)?.id).toBe(first.id)
  })

  it('maintains channel pending intents under conversation state', () => {
    const state = db.ensureChannelConversationState({
      channelId: 'oc_1',
      channelKey: 'lark-main',
      channelLinkName: 'wan-ke-chat',
      channelType: 'lark',
      entity: 'owo-demo',
      sessionType: 'group',
      threadKey: 'group:owo-demo:actor:user-yijie'
    })

    const intent = db.upsertChannelPendingIntent({
      id: 'pending-auth-1',
      authorizationRequestId: 'auth-1',
      channelId: 'oc_1',
      channelKey: 'lark-main',
      channelLinkName: 'wan-ke-chat',
      channelType: 'lark',
      conversationStateId: state.id,
      createdByChildRunId: 'child-run-1',
      entity: 'owo-demo',
      kind: 'need_approval',
      ownerAccountId: 'ou_1',
      ownerUserId: 'user-yijie',
      payload: {
        authorizationRequestId: 'auth-1',
        capability: 'im.chat.member.add'
      },
      requiredAction: 'grant_authorization',
      sessionType: 'group',
      threadKey: state.threadKey
    })

    expect(intent).toEqual(expect.objectContaining({
      id: 'pending-auth-1',
      authorizationRequestId: 'auth-1',
      conversationStateId: state.id,
      createdByChildRunId: 'child-run-1',
      kind: 'need_approval',
      ownerAccountId: 'ou_1',
      ownerUserId: 'user-yijie',
      payload: {
        authorizationRequestId: 'auth-1',
        capability: 'im.chat.member.add'
      },
      requiredAction: 'grant_authorization',
      status: 'open',
      threadKey: state.threadKey
    }))
    expect(db.getChannelConversationState(state.id)).toEqual(expect.objectContaining({
      pendingIntentIds: ['pending-auth-1']
    }))
    expect(db.listOpenChannelPendingIntents({
      channelType: 'lark',
      ownerUserId: 'user-yijie'
    })).toEqual([
      expect.objectContaining({ id: 'pending-auth-1' })
    ])

    db.updateChannelPendingIntent('pending-auth-1', {
      resolvedAt: Date.now() + 1000,
      status: 'resolved'
    })
    expect(db.getChannelPendingIntent('pending-auth-1')).toEqual(expect.objectContaining({
      resolvedAt: Date.now() + 1000,
      status: 'resolved'
    }))
    expect(db.listOpenChannelPendingIntents({
      channelType: 'lark',
      ownerUserId: 'user-yijie'
    })).toEqual([])
    expect(db.listResolvedChannelPendingIntents({
      authorizationRequestId: 'auth-1',
      channelType: 'lark',
      ownerUserId: 'user-yijie'
    })).toEqual([
      expect.objectContaining({
        id: 'pending-auth-1',
        resolvedAt: Date.now() + 1000,
        status: 'resolved'
      })
    ])
  })

  it('deduplicates persisted session events by stable event key', () => {
    const session = db.createSession('Runtime session', 'session-runtime', 'running')
    const messageEvent = {
      type: 'message',
      message: {
        id: 'evt-runtime-message',
        role: 'assistant',
        content: 'hello',
        createdAt: Date.now()
      }
    }
    const requestEvent = {
      type: 'interaction_request',
      id: 'codex-approval:0',
      payload: {
        sessionId: session.id,
        kind: 'permission',
        question: 'Allow command?'
      }
    }
    const nextRequestEvent = {
      ...requestEvent,
      payload: {
        ...requestEvent.payload,
        question: 'Allow another command?'
      }
    }

    expect(db.saveMessage(session.id, messageEvent)).toBe(true)
    expect(db.saveMessage(session.id, messageEvent)).toBe(false)
    expect(db.saveMessage(session.id, requestEvent)).toBe(true)
    expect(db.saveMessage(session.id, requestEvent)).toBe(false)
    expect(db.saveMessage(session.id, nextRequestEvent)).toBe(true)

    expect(db.getMessages(session.id)).toEqual([
      messageEvent,
      requestEvent,
      nextRequestEvent
    ])
    expect(db.getSession(session.id)?.messageCount).toBe(1)
  })

  it('counts only actual chat messages in session messageCount', () => {
    const session = db.createSession('Runtime session', 'session-message-count', 'running')
    const messageEvent = {
      type: 'message',
      message: {
        id: 'evt-user-message',
        role: 'user',
        content: 'hello',
        createdAt: Date.now()
      }
    }

    expect(db.saveMessage(session.id, {
      type: 'adapter_event',
      data: {
        runtimeEvent: {
          id: 'operation-prepare-started',
          sessionId: session.id,
          type: 'operation_started',
          operationId: 'adapter-cli-prepare'
        }
      }
    })).toBe(true)
    expect(db.saveMessage(session.id, messageEvent)).toBe(true)
    expect(db.saveMessage(session.id, {
      type: 'interaction_request',
      id: 'approval-1',
      payload: {
        sessionId: session.id,
        kind: 'permission',
        question: 'Allow command?'
      }
    })).toBe(true)

    expect(db.getSession(session.id)?.messageCount).toBe(1)
  })

  it('persists only the latest monotonic assistant text projection for one streaming message id', () => {
    const session = db.createSession('Cline stream', 'cline-stream', 'running')
    const base = { id: 'cline-turn-1', role: 'assistant', createdAt: 100 }
    const chunks = [
      { type: 'message', message: { ...base, content: 'first **' } },
      { type: 'message', message: { ...base, content: 'first **bold**\n```ts\n' } },
      { type: 'message', message: { ...base, content: 'first **bold**\n```ts\nconst ok = true\n```' } }
    ]
    expect(chunks.map(event => db.saveMessage(session.id, event))).toEqual([true, true, true])
    expect(db.getMessages(session.id)).toEqual([chunks[2]])
    expect(db.getSession(session.id)?.messageCount).toBe(1)
    expect(db.saveMessage(session.id, chunks[2])).toBe(false)
  })

  it('persists cumulative text-tool-text segments in their original chronology', () => {
    const session = db.createSession('Cline chronology', 'cline-chronology', 'running')
    const first = { id: 'cline-segment-1', role: 'assistant', createdAt: 100 }
    const second = { id: 'cline-segment-2', role: 'assistant', createdAt: 300 }
    const events = [
      { type: 'message', message: { ...first, content: 'before **' } },
      { type: 'message', message: { ...first, content: 'before **tool**' } },
      {
        type: 'message',
        message: {
          id: 'cline-tool-1',
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'cline-tool-1', name: 'adapter:cline:read', input: {} }],
          createdAt: 200
        }
      },
      { type: 'message', message: { ...second, content: 'after `co' } },
      { type: 'message', message: { ...second, content: 'after `code`' } }
    ]
    expect(events.map(event => db.saveMessage(session.id, event))).toEqual([true, true, true, true, true])
    expect(db.getMessages(session.id)).toEqual([
      events[1],
      events[2],
      events[4]
    ])
    expect(db.getSession(session.id)?.messageCount).toBe(3)
  })

  it('persists channel message deduplication keys', () => {
    expect(db.rememberChannelMessage('wechat:group:room:msg-1')).toBe(true)
    expect(db.rememberChannelMessage('wechat:group:room:msg-1')).toBe(false)
    expect(db.rememberChannelMessage('wechat:group:room:msg-2')).toBe(true)

    expect(db.forgetChannelMessage('wechat:group:room:msg-2')).toBe(1)
    expect(db.rememberChannelMessage('wechat:group:room:msg-2')).toBe(true)

    expect(db.deleteChannelMessagesSeenBefore(Date.now() + 1)).toBe(2)
    expect(db.rememberChannelMessage('wechat:group:room:msg-1')).toBe(true)
  })

  it('deduplicates runtime command backed user messages across provisional and projected events', () => {
    const session = db.createSession('Runtime session')
    const provisionalEvent = {
      type: 'message',
      message: {
        id: 'session-message-1',
        role: 'user',
        content: 'continue',
        agentRoom: {
          source: 'user',
          commandId: 'session-message-1',
          causedByCommandId: 'cmd-send-1'
        },
        createdAt: 100
      }
    }
    const projectedEvent = {
      type: 'message',
      message: {
        id: 'evt-7',
        role: 'user',
        content: 'continue',
        agentRoom: {
          source: 'user',
          commandId: 'session-message-1',
          causedByCommandId: 'cmd-send-1'
        },
        createdAt: 200
      }
    }

    expect(db.saveMessage(session.id, provisionalEvent)).toBe(true)
    expect(db.saveMessage(session.id, projectedEvent)).toBe(false)
    expect(db.getMessages(session.id)).toEqual([provisionalEvent])
    expect(db.getSession(session.id)?.messageCount).toBe(1)
  })

  it('archives a session tree without affecting unrelated sessions', () => {
    db.createSession('Parent', 'parent')
    db.createSession('Child', 'child', undefined, 'parent')
    db.createSession('Grandchild', 'grandchild', undefined, 'child')
    db.createSession('Sibling', 'sibling')

    const updatedIds = db.updateSessionArchivedWithChildren('parent', true)

    expect(updatedIds.slice().sort()).toEqual(['child', 'grandchild', 'parent'])
    expect(db.getSession('parent')).toEqual(expect.objectContaining({ isArchived: true }))
    expect(db.getSession('child')).toEqual(expect.objectContaining({ isArchived: true }))
    expect(db.getSession('grandchild')).toEqual(expect.objectContaining({ isArchived: true }))
    expect(db.getSession('sibling')).toEqual(expect.objectContaining({ isArchived: false }))
  })

  it('keeps the first delivery binding immutable for a session id', () => {
    db.createSession('Mapped session', 'session-mapped')

    vi.setSystemTime(new Date('2026-03-18T00:00:00.000Z'))
    db.upsertChannelSession({
      channelType: 'lark',
      sessionType: 'thread',
      channelId: 'channel-1',
      channelKey: 'key-1',
      senderId: 'sender-1',
      sessionId: 'session-mapped',
      replyReceiveId: 'reply-1',
      replyReceiveIdType: 'message'
    })

    vi.setSystemTime(new Date('2026-03-18T00:00:05.000Z'))
    db.upsertChannelSession({
      channelType: 'lark',
      sessionType: 'thread',
      channelId: 'channel-2',
      channelKey: 'key-2',
      senderId: 'sender-2',
      sessionId: 'session-mapped',
      replyReceiveId: 'reply-2',
      replyReceiveIdType: 'message'
    })

    expect(db.getChannelSession('key-1', 'lark', 'thread', 'channel-1')).toEqual(expect.objectContaining({
      channelKey: 'key-1',
      sessionId: 'session-mapped'
    }))
    expect(db.getChannelSessionBySessionId('session-mapped')).toEqual(expect.objectContaining({
      channelId: 'channel-1',
      channelKey: 'key-1',
      senderId: 'sender-1',
      updatedAt: new Date('2026-03-18T00:00:00.000Z').getTime()
    }))
  })

  it('isolates session bindings for threads in the same group', () => {
    db.createSession('First thread', 'session-thread-1')
    db.createSession('Second thread', 'session-thread-2')
    db.upsertChannelSession({
      channelType: 'lark',
      sessionType: 'group',
      channelId: 'group-1',
      threadId: 'thread-1',
      channelKey: 'lark-main',
      sessionId: 'session-thread-1'
    })
    db.upsertChannelSession({
      channelType: 'lark',
      sessionType: 'group',
      channelId: 'group-1',
      threadId: 'thread-2',
      channelKey: 'lark-main',
      sessionId: 'session-thread-2'
    })

    expect(db.getChannelSession('lark-main', 'lark', 'group', 'group-1', 'thread-1')?.sessionId)
      .toBe('session-thread-1')
    expect(db.getChannelSession('lark-main', 'lark', 'group', 'group-1', 'thread-2')?.sessionId)
      .toBe('session-thread-2')
    expect(db.getChannelSession('lark-main', 'lark', 'group', 'group-1')).toBeUndefined()
  })

  it('persists channel adapter preferences independently of the current session binding', () => {
    db.upsertChannelPreference({
      channelType: 'lark',
      sessionType: 'direct',
      channelId: 'channel-1',
      channelKey: 'key-1',
      adapter: 'codex',
      permissionMode: 'bypassPermissions',
      effort: 'high'
    })

    expect(db.getChannelPreference('key-1', 'lark', 'direct', 'channel-1')).toEqual(expect.objectContaining({
      channelKey: 'key-1',
      adapter: 'codex',
      permissionMode: 'bypassPermissions',
      effort: 'high'
    }))
  })

  it('persists channel command run audit records', () => {
    const run = db.createChannelCommandRun({
      id: 'cmd-run-1',
      actorAccountId: 'ou_1',
      actorUserId: 'user-yijie',
      channelId: 'oc_1',
      channelKey: 'lark-main',
      channelLinkName: 'wan-ke-chat',
      channelType: 'lark',
      commandName: 'grant',
      commandPath: ['/auth', 'grant'],
      entity: 'owo-demo',
      messageId: 'om_1',
      metadata: { usage: '/auth grant <id>' },
      permission: 'admin',
      rawArgs: ['auth-1'],
      senderId: 'ou_1',
      sessionType: 'group',
      source: 'slash',
      startedAt: Date.now()
    })

    expect(run).toEqual(expect.objectContaining({
      id: 'cmd-run-1',
      actorAccountId: 'ou_1',
      actorUserId: 'user-yijie',
      channelId: 'oc_1',
      channelKey: 'lark-main',
      channelLinkName: 'wan-ke-chat',
      commandName: 'grant',
      commandPath: ['/auth', 'grant'],
      metadata: { usage: '/auth grant <id>' },
      permission: 'admin',
      rawArgs: ['auth-1'],
      status: 'started'
    }))

    db.finishChannelCommandRun('cmd-run-1', {
      completedAt: Date.now() + 10,
      status: 'success'
    })

    expect(db.getChannelCommandRun('cmd-run-1')).toEqual(expect.objectContaining({
      completedAt: Date.now() + 10,
      status: 'success'
    }))
    expect(db.listRecentChannelCommandRuns(1)).toEqual([
      expect.objectContaining({ id: 'cmd-run-1' })
    ])
  })

  it('binds multiple channel accounts to the same canonical user', () => {
    const user = db.ensureCanonicalUser({
      id: 'user-yijie',
      displayName: '一介'
    })
    expect(user).toEqual({
      id: 'user-yijie',
      displayName: '一介',
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    db.upsertChannelAccount({
      issuerKey: 'lark-main',
      channelType: 'lark',
      accountId: 'ou_lark_yijie',
      accountKey: 'lark:open_id:ou_lark_yijie',
      displayName: '一介[字节]',
      metadata: { tenant: 'oneworks' }
    })
    db.upsertChannelAccount({
      issuerKey: 'wechat-main',
      channelType: 'wechat',
      accountId: 'wx_yijie',
      displayName: '一介'
    })
    db.linkChannelAccountToUser({
      issuerKey: 'lark-main',
      channelType: 'lark',
      accountId: 'ou_lark_yijie',
      userId: 'user-yijie',
      source: 'manual'
    })
    db.linkChannelAccountToUser({
      issuerKey: 'wechat-main',
      channelType: 'wechat',
      accountId: 'wx_yijie',
      userId: 'user-yijie',
      source: 'claim'
    })

    expect(db.resolveCanonicalUserByChannelAccount('lark-main', 'ou_lark_yijie')).toEqual(expect.objectContaining({
      id: 'user-yijie',
      displayName: '一介'
    }))
    expect(db.listChannelAccountsForUser('user-yijie')).toEqual([
      expect.objectContaining({
        channelType: 'lark',
        issuerKey: 'lark-main',
        accountId: 'ou_lark_yijie',
        accountKey: 'lark:open_id:ou_lark_yijie',
        displayName: '一介[字节]',
        metadata: { tenant: 'oneworks' }
      }),
      expect.objectContaining({
        channelType: 'wechat',
        issuerKey: 'wechat-main',
        accountId: 'wx_yijie',
        accountKey: 'wechat-main:wx_yijie',
        displayName: '一介'
      })
    ])
  })

  it('isolates identical platform account ids across channel issuers', () => {
    db.ensureCanonicalUser({ id: 'user-a' })
    db.ensureCanonicalUser({ id: 'user-b' })
    for (const issuerKey of ['lark-app-a', 'lark-app-b']) {
      db.upsertChannelAccount({
        accountId: 'ou_shared',
        channelType: 'lark',
        issuerKey
      })
    }
    db.linkChannelAccountToUser({
      accountId: 'ou_shared',
      channelType: 'lark',
      issuerKey: 'lark-app-a',
      userId: 'user-a'
    })
    db.linkChannelAccountToUser({
      accountId: 'ou_shared',
      channelType: 'lark',
      issuerKey: 'lark-app-b',
      userId: 'user-b'
    })

    expect(db.resolveCanonicalUserByChannelAccount('lark-app-a', 'ou_shared')?.id).toBe('user-a')
    expect(db.resolveCanonicalUserByChannelAccount('lark-app-b', 'ou_shared')?.id).toBe('user-b')
  })

  it('links another channel account through a short-lived identity code', () => {
    db.ensureCanonicalUser({
      id: 'user-yijie',
      displayName: '一介'
    })
    db.upsertChannelAccount({
      issuerKey: 'lark-team',
      channelType: 'lark',
      accountId: 'ou_lark_yijie'
    })
    db.upsertChannelAccount({
      issuerKey: 'telegram-main',
      channelType: 'telegram',
      accountId: 'tg_yijie'
    })
    db.linkChannelAccountToUser({
      issuerKey: 'lark-team',
      channelType: 'lark',
      accountId: 'ou_lark_yijie',
      userId: 'user-yijie',
      source: 'self_claim'
    })

    const code = db.createChannelIdentityLinkCode({
      code: 'ABCD1234',
      userId: 'user-yijie',
      sourceChannelType: 'lark',
      sourceIssuerKey: 'lark-team',
      sourceAccountId: 'ou_lark_yijie',
      expiresAt: Date.now() + 600_000,
      metadata: { channelKey: 'lark:team' }
    })

    expect(code).toEqual(expect.objectContaining({
      code: 'ABCD1234',
      userId: 'user-yijie',
      sourceChannelType: 'lark',
      sourceAccountId: 'ou_lark_yijie',
      status: 'active',
      metadata: { channelKey: 'lark:team' }
    }))

    const result = db.consumeChannelIdentityLinkCode({
      code: 'ABCD1234',
      targetChannelType: 'telegram',
      targetIssuerKey: 'telegram-main',
      targetAccountId: 'tg_yijie'
    })

    expect(result).toEqual(expect.objectContaining({
      status: 'consumed',
      link: expect.objectContaining({
        channelType: 'telegram',
        issuerKey: 'telegram-main',
        accountId: 'tg_yijie',
        userId: 'user-yijie',
        source: 'link_code',
        status: 'verified'
      }),
      code: expect.objectContaining({
        status: 'consumed',
        consumedChannelType: 'telegram',
        consumedIssuerKey: 'telegram-main',
        consumedAccountId: 'tg_yijie'
      })
    }))
    expect(db.resolveCanonicalUserByChannelAccount('telegram-main', 'tg_yijie')).toEqual(expect.objectContaining({
      id: 'user-yijie'
    }))
  })

  it('does not consume expired or conflicting identity link codes', () => {
    db.ensureCanonicalUser({ id: 'user-a' })
    db.ensureCanonicalUser({ id: 'user-b' })
    db.upsertChannelAccount({ issuerKey: 'lark-main', channelType: 'lark', accountId: 'ou_a' })
    db.upsertChannelAccount({ issuerKey: 'wechat-main', channelType: 'wechat', accountId: 'wx_b' })
    db.linkChannelAccountToUser({
      issuerKey: 'wechat-main',
      channelType: 'wechat',
      accountId: 'wx_b',
      userId: 'user-b',
      source: 'self_claim'
    })

    db.createChannelIdentityLinkCode({
      code: 'EXPIRED',
      userId: 'user-a',
      sourceChannelType: 'lark',
      sourceIssuerKey: 'lark-main',
      sourceAccountId: 'ou_a',
      expiresAt: Date.now() - 1
    })
    expect(db.consumeChannelIdentityLinkCode({
      code: 'EXPIRED',
      targetChannelType: 'wechat',
      targetIssuerKey: 'wechat-main',
      targetAccountId: 'wx_new'
    })).toEqual(expect.objectContaining({
      status: 'expired',
      code: expect.objectContaining({ status: 'expired' })
    }))

    db.createChannelIdentityLinkCode({
      code: 'CONFLICT',
      userId: 'user-a',
      sourceChannelType: 'lark',
      sourceIssuerKey: 'lark-main',
      sourceAccountId: 'ou_a',
      expiresAt: Date.now() + 600_000
    })
    expect(db.consumeChannelIdentityLinkCode({
      code: 'CONFLICT',
      targetChannelType: 'wechat',
      targetIssuerKey: 'wechat-main',
      targetAccountId: 'wx_b'
    })).toEqual(expect.objectContaining({
      existingLink: expect.objectContaining({ userId: 'user-b' }),
      status: 'conflict'
    }))
    expect(db.getChannelIdentityLinkCode('CONFLICT')).toEqual(expect.objectContaining({
      status: 'active'
    }))
  })

  it('tracks channel credentials separately from channel identity links', () => {
    db.ensureCanonicalUser({
      id: 'user-operator',
      displayName: 'Operator'
    })

    db.upsertChannelUserCredential({
      issuerKey: 'lark-main',
      userId: 'user-operator',
      channelType: 'lark',
      credentialKey: 'lark-cli:user-operator',
      label: 'Lark CLI user token',
      status: 'needs_auth',
      scopes: ['im:message:send_as_user'],
      metadata: { credentialRef: 'keychain://oneworks/lark/user-operator' }
    })

    expect(db.getChannelUserCredential('lark-main', 'user-operator', 'lark-cli:user-operator')).toEqual(
      expect.objectContaining({
        issuerKey: 'lark-main',
        userId: 'user-operator',
        channelType: 'lark',
        credentialKey: 'lark-cli:user-operator',
        status: 'needs_auth',
        scopes: ['im:message:send_as_user'],
        metadata: { credentialRef: 'keychain://oneworks/lark/user-operator' }
      })
    )

    db.upsertChannelUserCredential({
      issuerKey: 'lark-main',
      userId: 'user-operator',
      channelType: 'lark',
      credentialKey: 'lark-cli:user-operator',
      label: 'Lark CLI user token',
      status: 'active',
      scopes: ['im:message:send_as_user', 'contact:user.base:readonly'],
      expiresAt: Date.now() + 3600_000
    })

    db.upsertChannelUserCredential({
      issuerKey: 'lark-support',
      userId: 'user-operator',
      channelType: 'lark',
      credentialKey: 'lark-cli:user-operator',
      status: 'revoked'
    })

    expect(db.listChannelUserCredentials('lark-main', 'user-operator')).toEqual([
      expect.objectContaining({
        issuerKey: 'lark-main',
        credentialKey: 'lark-cli:user-operator',
        status: 'active',
        scopes: ['im:message:send_as_user', 'contact:user.base:readonly'],
        expiresAt: Date.now() + 3600_000
      })
    ])
    expect(db.getChannelUserCredential('lark-support', 'user-operator', 'lark-cli:user-operator')).toEqual(
      expect.objectContaining({
        issuerKey: 'lark-support',
        status: 'revoked'
      })
    )
  })

  it('migrates a legacy identity namespace into one explicit issuer', () => {
    const now = Date.now()
    db.ensureCanonicalUser({ id: 'user-legacy', displayName: 'Legacy User' })
    sqlite.prepare(`
      INSERT INTO channel_accounts (
        channelType, accountId, accountKey, displayName, avatarUrl, metadataJson, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('lark', 'ou_legacy', 'lark:ou_legacy', 'Legacy User', null, null, now, now)
    sqlite.prepare(`
      INSERT INTO channel_identity_links (
        channelType, accountId, userId, status, source, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('lark', 'ou_legacy', 'user-legacy', 'verified', 'legacy', now, now)
    sqlite.prepare(`
      INSERT INTO channel_user_credentials (
        userId, channelType, credentialKey, label, status, scopesJson, expiresAt, metadataJson, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('user-legacy', 'lark', 'legacy-token', 'Legacy token', 'active', '["im:read"]', null, null, now, now)

    expect(db.migrateLegacyChannelIdentityNamespace({
      channelType: 'lark',
      issuerKey: 'lark-main'
    })).toEqual({
      accounts: 1,
      credentials: 1,
      identityLinks: 1,
      linkCodes: 0
    })
    expect(db.getChannelAccount('lark-main', 'ou_legacy')).toEqual(expect.objectContaining({
      issuerKey: 'lark-main',
      displayName: 'Legacy User'
    }))
    expect(db.resolveCanonicalUserByChannelAccount('lark-main', 'ou_legacy')).toEqual(expect.objectContaining({
      id: 'user-legacy'
    }))
    expect(db.getChannelUserCredential('lark-main', 'user-legacy', 'legacy-token')).toEqual(
      expect.objectContaining({ issuerKey: 'lark-main', scopes: ['im:read'] })
    )
  })

  it('atomically reserves, commits, releases, and reclaims webhook nonces', () => {
    expect(db.reserveChannelWebhookNonce({
      channelKey: 'oneworks-main',
      expiresAt: Date.now() + 60_000,
      nonce: 'nonce-1',
      reservationExpiresAt: Date.now() + 10_000,
      reservationId: 'reservation-1'
    })).toBe(true)
    expect(db.reserveChannelWebhookNonce({
      channelKey: 'oneworks-main',
      expiresAt: Date.now() + 60_000,
      nonce: 'nonce-1',
      reservationExpiresAt: Date.now() + 20_000,
      reservationId: 'reservation-2'
    })).toBe(false)
    expect(db.releaseChannelWebhookNonce({
      channelKey: 'oneworks-main',
      nonce: 'nonce-1',
      reservationId: 'wrong-reservation'
    })).toBe(false)

    vi.advanceTimersByTime(10_001)
    expect(db.reserveChannelWebhookNonce({
      channelKey: 'oneworks-main',
      expiresAt: Date.now() + 60_000,
      nonce: 'nonce-1',
      reservationExpiresAt: Date.now() + 10_000,
      reservationId: 'reservation-2'
    })).toBe(true)
    expect(db.releaseChannelWebhookNonce({
      channelKey: 'oneworks-main',
      nonce: 'nonce-1',
      reservationId: 'reservation-1'
    })).toBe(false)
    expect(db.commitChannelWebhookNonce({
      channelKey: 'oneworks-main',
      expiresAt: Date.now() + 60_000,
      nonce: 'nonce-1',
      reservationId: 'reservation-2'
    })).toBe(true)

    expect(db.reserveChannelWebhookNonce({
      channelKey: 'oneworks-main',
      expiresAt: Date.now() + 60_000,
      nonce: 'nonce-1',
      reservationExpiresAt: Date.now() + 10_000,
      reservationId: 'reservation-3'
    })).toBe(false)
  })

  it('records channel authorization requests until they are resolved', () => {
    db.ensureCanonicalUser({
      id: 'user-yijie',
      displayName: '一介'
    })

    const request = db.createChannelAuthorizationRequest({
      id: 'auth-1',
      channelType: 'lark',
      issuerKey: 'lark:product-team',
      channelKey: 'lark:product-team',
      channelId: 'oc_demo',
      channelLinkName: 'wanke-demo',
      requesterUserId: 'user-yijie',
      requesterAccountId: 'ou_lark_yijie',
      credentialSubjectUserId: 'user-owner',
      credentialKey: 'lark-cli:user-yijie',
      allowedApprovers: ['user:user-yijie', 'account:lark:product-team:ou_lark_yijie'],
      capability: 'im.chat.member.add',
      message: '需要授权拉机器人进群',
      metadata: { targetChatId: 'oc_demo' },
      expiresAt: Date.now() + 600_000
    })

    expect(request).toEqual(expect.objectContaining({
      id: 'auth-1',
      channelType: 'lark',
      issuerKey: 'lark:product-team',
      channelKey: 'lark:product-team',
      channelId: 'oc_demo',
      channelLinkName: 'wanke-demo',
      requesterUserId: 'user-yijie',
      requesterAccountId: 'ou_lark_yijie',
      credentialSubjectUserId: 'user-owner',
      credentialKey: 'lark-cli:user-yijie',
      allowedApprovers: ['user:user-yijie', 'account:lark:product-team:ou_lark_yijie'],
      capability: 'im.chat.member.add',
      status: 'pending',
      message: '需要授权拉机器人进群',
      metadata: { targetChatId: 'oc_demo' },
      resolvedAt: null
    }))
    expect(db.listPendingChannelAuthorizationRequestsForUser('user-yijie', 'lark')).toEqual([
      expect.objectContaining({ id: 'auth-1' })
    ])
    expect(db.listPendingChannelAuthorizationRequestsForUser('user-owner', 'lark')).toEqual([
      expect.objectContaining({ id: 'auth-1' })
    ])
    expect(db.listPendingChannelAuthorizationRequestsForAccount('ou_lark_yijie', 'lark')).toEqual([
      expect.objectContaining({ id: 'auth-1' })
    ])
    expect(db.listPendingChannelAuthorizationRequests('lark')).toEqual([
      expect.objectContaining({ id: 'auth-1' })
    ])

    expect(db.resolveChannelAuthorizationRequest({
      id: 'auth-1',
      status: 'granted',
      resolvedAt: Date.now()
    })).toEqual(expect.objectContaining({ status: 'granted' }))
    expect(db.resolveChannelAuthorizationRequest({
      id: 'auth-1',
      status: 'denied',
      resolvedAt: Date.now() + 1
    })).toBeUndefined()

    expect(db.getChannelAuthorizationRequest('auth-1')).toEqual(expect.objectContaining({
      status: 'granted',
      resolvedAt: Date.now()
    }))
    expect(db.listPendingChannelAuthorizationRequestsForUser('user-yijie', 'lark')).toEqual([])
    expect(db.listPendingChannelAuthorizationRequests('lark')).toEqual([])
  })

  it('persists reusable OneWorks channel scenarios with stable synthetic users', () => {
    const scenario = db.createChannelScenario({
      actorRole: 'participant',
      name: 'Release check',
      roomRef: '0123456789abcdef',
      sessionType: 'group',
      text: 'Verify the release state.',
      userLabel: 'release-manager'
    })

    expect(db.listChannelScenarios()).toEqual([
      expect.objectContaining({ actorRole: 'participant', id: scenario.id, userLabel: 'release-manager' })
    ])
    expect(db.updateChannelScenario(scenario.id, { userLabel: 'release-owner' })).toEqual(
      expect.objectContaining({ userLabel: 'release-owner' })
    )
    expect(db.deleteChannelScenario(scenario.id)).toBe(true)
    expect(db.getChannelScenario(scenario.id)).toBeUndefined()
  })

  it('rejects inline secrets from credential metadata and provider handles', () => {
    const base = {
      channelType: 'lark',
      credentialKey: 'lark-user',
      issuerKey: 'lark:product-team',
      providerHandle: 'keychain:credential-42',
      userId: 'user-1'
    }

    expect(() =>
      db.upsertChannelUserCredential({
        ...base,
        metadata: { accessToken: 'sk-not-allowed' }
      })
    ).toThrow('secret-like keys')
    expect(() =>
      db.upsertChannelUserCredential({
        ...base,
        providerHandle: 'inline:sk-not-allowed'
      })
    ).toThrow('bounded opaque provider reference')
    expect(() =>
      db.upsertChannelUserCredential({
        ...base,
        providerHandle: 'keychain:Bearer-token'
      })
    ).toThrow('bounded opaque provider reference')
    expect(db.upsertChannelUserCredential(base)).toEqual(expect.objectContaining({
      providerHandle: 'keychain:credential-42',
      status: 'needs_auth'
    }))
  })

  it('persists channel reply throttle consumption windows', () => {
    const throttleKey = encodeChannelRuntimeKey('off-hours', 'wan-ke-chat', 'lark', 'group', 'oc_1')
    expect(db.consumeChannelReplyThrottle({
      throttleKey,
      policyType: 'off_hours_notice',
      channelType: 'lark',
      channelId: 'oc_1',
      channelLinkName: 'wan-ke-chat',
      actorUserId: 'user-yijie',
      actorAccountId: 'ou_1',
      windowMs: 20 * 60 * 1000,
      now: Date.now()
    })).toBe(true)
    expect(db.consumeChannelReplyThrottle({
      throttleKey,
      policyType: 'off_hours_notice',
      channelType: 'lark',
      channelId: 'oc_1',
      channelLinkName: 'wan-ke-chat',
      actorUserId: 'user-yijie',
      actorAccountId: 'ou_1',
      windowMs: 20 * 60 * 1000,
      now: Date.now() + 1000
    })).toBe(false)
    expect(db.consumeChannelReplyThrottle({
      throttleKey,
      policyType: 'off_hours_notice',
      channelType: 'lark',
      channelId: 'oc_1',
      channelLinkName: 'wan-ke-chat',
      actorUserId: 'user-yijie',
      actorAccountId: 'ou_1',
      windowMs: 20 * 60 * 1000,
      now: Date.now() + 20 * 60 * 1000 + 1
    })).toBe(true)

    expect(db.getChannelReplyThrottle(throttleKey)).toEqual(
      expect.objectContaining({
        policyType: 'off_hours_notice',
        channelType: 'lark',
        channelId: 'oc_1',
        channelLinkName: 'wan-ke-chat',
        actorUserId: 'user-yijie',
        actorAccountId: 'ou_1',
        lastSentAt: Date.now() + 20 * 60 * 1000 + 1
      })
    )
  })

  it('persists off-hours backlog until it is processed', () => {
    const item = db.appendChannelOffhourBacklog({
      id: 'offhour-1',
      channelType: 'lark',
      channelKey: 'lark-main',
      channelId: 'oc_1',
      sessionType: 'group',
      channelLinkName: 'wan-ke-chat',
      entity: 'owo-demo',
      senderId: 'ou_1',
      actorUserId: 'user-yijie',
      messageId: 'om_1',
      text: '@OWO 下班了也帮我看看',
      raw: { message_id: 'om_1' },
      createdAt: Date.now()
    })

    expect(item).toEqual(expect.objectContaining({
      id: 'offhour-1',
      channelType: 'lark',
      channelKey: 'lark-main',
      channelId: 'oc_1',
      channelLinkName: 'wan-ke-chat',
      entity: 'owo-demo',
      senderId: 'ou_1',
      actorUserId: 'user-yijie',
      text: '@OWO 下班了也帮我看看',
      raw: { message_id: 'om_1' },
      processedAt: null
    }))
    expect(db.listPendingChannelOffhourBacklog({ channelLinkName: 'wan-ke-chat' })).toEqual([
      expect.objectContaining({ id: 'offhour-1' })
    ])

    expect(db.markChannelOffhourBacklogProcessed(['offhour-1'], Date.now() + 1000)).toBe(1)
    expect(db.getChannelOffhourBacklogItem('offhour-1')).toEqual(expect.objectContaining({
      id: 'offhour-1',
      processedAt: Date.now() + 1000
    }))
    expect(db.listPendingChannelOffhourBacklog({ channelLinkName: 'wan-ke-chat' })).toEqual([])
  })

  it('updates automation rules with nullable fields through the same API surface', () => {
    db.createAutomationRule({
      id: 'rule-1',
      name: 'Nightly run',
      description: 'original',
      type: 'interval',
      intervalMs: 3000,
      webhookKey: null,
      cronExpression: null,
      prompt: 'do work',
      enabled: true,
      createdAt: Date.now(),
      lastRunAt: null,
      lastSessionId: null
    })

    db.updateAutomationRule('rule-1', {
      description: null,
      intervalMs: null,
      webhookKey: 'hook-1',
      enabled: false,
      lastRunAt: 123,
      lastSessionId: 'session-root'
    })

    expect(db.getAutomationRule('rule-1')).toEqual({
      id: 'rule-1',
      name: 'Nightly run',
      description: null,
      type: 'interval',
      intervalMs: null,
      webhookKey: 'hook-1',
      cronExpression: null,
      prompt: 'do work',
      enabled: false,
      createdAt: Date.now(),
      lastRunAt: 123,
      lastSessionId: 'session-root'
    })
  })

  it('replaces automation triggers and tasks atomically and exposes rule details with runs', () => {
    db.createAutomationRule({
      id: 'rule-1',
      name: 'Nightly run',
      description: null,
      type: 'cron',
      intervalMs: null,
      webhookKey: null,
      cronExpression: '0 0 * * *',
      prompt: 'do work',
      enabled: true,
      createdAt: Date.now(),
      lastRunAt: null,
      lastSessionId: null
    })

    db.replaceAutomationTriggers('rule-1', [
      {
        id: 'trigger-1',
        type: 'cron',
        cronExpression: '0 0 * * *'
      }
    ])
    db.replaceAutomationTasks('rule-1', [
      {
        id: 'task-1',
        title: 'Task A',
        prompt: 'Summarize activity',
        model: 'gpt-responses,gpt-5.4',
        adapter: 'codex',
        effort: 'high',
        permissionMode: 'bypassPermissions',
        createWorktree: true,
        branchName: 'codex/nightly',
        branchKind: null,
        branchMode: 'create'
      }
    ])

    db.createSession('Automation run', 'session-run', 'completed')
    db.updateSessionLastMessages('session-run', 'assistant summary', 'user request')
    db.createAutomationRun('rule-1', 'session-run', 'task-1', 'Task A')

    expect(db.getAutomationRuleDetail('rule-1')).toEqual({
      id: 'rule-1',
      name: 'Nightly run',
      description: null,
      type: 'cron',
      intervalMs: null,
      webhookKey: null,
      cronExpression: '0 0 * * *',
      prompt: 'do work',
      enabled: true,
      createdAt: Date.now(),
      lastRunAt: null,
      lastSessionId: null,
      triggers: [
        {
          id: 'trigger-1',
          ruleId: 'rule-1',
          type: 'cron',
          intervalMs: null,
          cronExpression: '0 0 * * *',
          webhookKey: null,
          createdAt: Date.now()
        }
      ],
      tasks: [
        {
          id: 'task-1',
          ruleId: 'rule-1',
          title: 'Task A',
          prompt: 'Summarize activity',
          model: 'gpt-responses,gpt-5.4',
          adapter: 'codex',
          effort: 'high',
          permissionMode: 'bypassPermissions',
          createWorktree: true,
          branchName: 'codex/nightly',
          branchKind: null,
          branchMode: 'create',
          createdAt: Date.now()
        }
      ]
    })
    expect(db.listAutomationRuns('rule-1')).toEqual([
      {
        id: expect.any(String),
        ruleId: 'rule-1',
        sessionId: 'session-run',
        runAt: Date.now(),
        taskId: 'task-1',
        taskTitle: 'Task A',
        status: 'completed',
        title: 'Automation run',
        lastMessage: 'assistant summary',
        lastUserMessage: 'user request'
      }
    ])
  })

  it('rolls back trigger replacement when a later insert fails', () => {
    db.createAutomationRule({
      id: 'rule-1',
      name: 'Nightly run',
      description: null,
      type: 'interval',
      intervalMs: 3000,
      webhookKey: null,
      cronExpression: null,
      prompt: 'do work',
      enabled: true,
      createdAt: Date.now(),
      lastRunAt: null,
      lastSessionId: null
    })

    db.replaceAutomationTriggers('rule-1', [
      {
        id: 'trigger-existing',
        type: 'interval',
        intervalMs: 3000
      }
    ])

    expect(() =>
      db.replaceAutomationTriggers('rule-1', [
        {
          id: 'trigger-duplicate',
          type: 'interval',
          intervalMs: 1000
        },
        {
          id: 'trigger-duplicate',
          type: 'cron',
          cronExpression: '* * * * *'
        }
      ])
    ).toThrowError()

    expect(db.listAutomationTriggers('rule-1')).toEqual([
      {
        id: 'trigger-existing',
        ruleId: 'rule-1',
        type: 'interval',
        intervalMs: 3000,
        cronExpression: null,
        webhookKey: null,
        createdAt: Date.now()
      }
    ])
  })
})
