/* eslint-disable max-lines */

import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentRoomEvent, AgentRoomEventMember, AgentRoomEventRun } from '@oneworks/core'
import { resolveProjectHomePath } from '@oneworks/utils'

import { SqliteDb } from '#~/db/index.js'
import { createSqliteDatabase } from '#~/db/sqlite.js'
import { createAgentRoomService } from '#~/services/agent-room/index.js'
import type { AgentRoomSessionDelivery } from '#~/services/agent-room/index.js'

const member: AgentRoomEventMember = {
  key: 'architect',
  kind: 'entity',
  label: 'Architect'
}

const run = (key: string): AgentRoomEventRun => ({
  key,
  sessionId: `session-${key}`,
  title: `Run ${key}`
})

describe('agent room service', () => {
  let db: SqliteDb
  let delivery: AgentRoomSessionDelivery
  let notifySessionUpdated: ReturnType<typeof vi.fn>
  let previousProjectHomeProjectsDir: string | undefined
  let previousProjectOoBaseDir: string | undefined
  let service: ReturnType<typeof createAgentRoomService>
  let tempProjectHomeProjectsDir: string | undefined
  let tempRuntimeRoot: string | undefined

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-24T00:00:00.000Z'))
    previousProjectHomeProjectsDir = process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__
    previousProjectOoBaseDir = process.env.__ONEWORKS_PROJECT_BASE_DIR__
    tempProjectHomeProjectsDir = await mkdtemp(path.join(os.tmpdir(), 'ow-agent-room-home-'))
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = tempProjectHomeProjectsDir
    db = new SqliteDb({ db: createSqliteDatabase(':memory:') })
    notifySessionUpdated = vi.fn()
    delivery = {
      processUserMessage: vi.fn(async () => undefined),
      handleInteractionResponse: vi.fn(() => true),
      getSessionInteraction: vi.fn(() => undefined),
      notifySessionUpdated
    }
    service = createAgentRoomService(db, delivery)
  })

  afterEach(async () => {
    if (previousProjectHomeProjectsDir == null) {
      delete process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__
    } else {
      process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = previousProjectHomeProjectsDir
    }
    if (previousProjectOoBaseDir == null) {
      delete process.env.__ONEWORKS_PROJECT_BASE_DIR__
    } else {
      process.env.__ONEWORKS_PROJECT_BASE_DIR__ = previousProjectOoBaseDir
    }
    if (tempRuntimeRoot != null) {
      await rm(tempRuntimeRoot, { force: true, recursive: true })
      tempRuntimeRoot = undefined
    }
    if (tempProjectHomeProjectsDir != null) {
      await rm(tempProjectHomeProjectsDir, { force: true, recursive: true })
      tempProjectHomeProjectsDir = undefined
    }
    db.close()
    vi.useRealTimers()
  })

  const pathExists = async (targetPath: string) => {
    try {
      await access(targetPath)
      return true
    } catch {
      return false
    }
  }

  it('applies room events into persisted members, runs and public messages', () => {
    const room = service.createRoom({
      id: 'room-1',
      title: 'Build room',
      hostSessionId: 'host-session'
    })

    service.applyEvent(room.id, {
      type: 'assignment_sent',
      member,
      run: run('schema-plan'),
      summary: 'Architect is planning the schema.'
    }, {
      now: Date.parse('2026-04-24T00:00:00.400Z')
    })

    const detail = service.getDetail(room.id)

    expect(detail?.room).toEqual(expect.objectContaining({
      id: 'room-1',
      status: 'active',
      lastMessage: 'Architect is planning the schema.'
    }))
    expect(detail?.members).toEqual([
      expect.objectContaining({
        key: 'architect',
        status: 'active',
        activeRunCount: 1,
        pendingCount: 0,
        latestSummary: 'Architect is planning the schema.'
      })
    ])
    expect(detail?.runs).toEqual([
      expect.objectContaining({
        key: 'schema-plan',
        status: 'running',
        latestSummary: 'Architect is planning the schema.'
      })
    ])
    expect(detail?.messages).toEqual([
      expect.objectContaining({
        role: 'agent',
        memberKey: 'host:host-session',
        runKey: 'schema-plan',
        eventType: 'assignment_sent',
        content: 'Architect is planning the schema.'
      })
    ])
  })

  it('computes aggregate status, pending count and active run count across runs', () => {
    const room = service.createRoom({ id: 'room-1', title: 'Build room' })

    service.applyEvent(room.id, {
      type: 'assignment_sent',
      member,
      run: run('schema-plan'),
      summary: 'Schema work started.'
    })
    service.applyEvent(room.id, {
      type: 'attention_requested',
      member,
      run: run('schema-plan'),
      interactionId: 'interaction-1',
      requestKind: 'confirmation',
      summary: 'Need approval to edit schema.',
      options: [{ label: 'Approve', value: 'approve' }]
    })
    service.applyEvent(room.id, {
      type: 'assignment_sent',
      member,
      run: run('api-plan'),
      summary: 'API work started.'
    })

    expect(service.getDetail(room.id)?.members[0]).toEqual(expect.objectContaining({
      status: 'waiting',
      pendingCount: 1,
      activeRunCount: 2,
      latestSummary: 'API work started.'
    }))

    service.applyEvent(room.id, {
      type: 'run_completed',
      member,
      run: run('schema-plan'),
      summary: 'Schema work completed.'
    })
    service.applyEvent(room.id, {
      type: 'run_failed',
      member,
      run: run('api-plan'),
      summary: 'API work failed.'
    })

    const detail = service.getDetail(room.id)
    expect(detail?.room).toEqual(expect.objectContaining({
      status: 'failed',
      lastMessage: 'API work failed.'
    }))
    expect(detail?.members[0]).toEqual(expect.objectContaining({
      status: 'failed',
      pendingCount: 0,
      activeRunCount: 0,
      latestSummary: 'API work failed.'
    }))
  })

  it('keeps duplicate event ids idempotent while preserving run state', () => {
    const room = service.createRoom({ id: 'room-1', title: 'Build room' })
    const event: AgentRoomEvent = {
      id: 'event-1',
      type: 'assignment_sent',
      member,
      run: run('schema-plan'),
      summary: 'Schema work started.'
    }

    service.applyEvent(room.id, event)
    service.applyEvent(room.id, event)

    const detail = service.getDetail(room.id)
    expect(detail?.messages).toHaveLength(1)
    expect(detail?.runs).toHaveLength(1)
    expect(detail?.members[0]).toEqual(expect.objectContaining({
      activeRunCount: 1,
      latestSummary: 'Schema work started.'
    }))
  })

  it('hides stale lower-priority terminal messages from room detail', () => {
    const room = service.createRoom({ id: 'room-1', title: 'Build room' })

    service.applyEvent(room.id, {
      id: 'event-failed',
      type: 'run_failed',
      member,
      run: run('schema-plan'),
      summary: 'Schema work failed.'
    })
    service.applyEvent(room.id, {
      id: 'event-completed',
      type: 'run_completed',
      member,
      run: run('schema-plan'),
      summary: 'Schema work completed.'
    })

    expect(service.getDetail(room.id)?.runs).toEqual([
      expect.objectContaining({
        key: 'schema-plan',
        status: 'failed',
        latestSummary: 'Schema work failed.'
      })
    ])
    expect(service.getDetail(room.id)?.messages).toEqual([
      expect.objectContaining({
        id: 'event-failed',
        eventType: 'run_failed',
        content: 'Schema work failed.'
      })
    ])
  })

  it('keeps previous completed messages visible while the same run is active again', () => {
    const room = service.createRoom({ id: 'room-1', title: 'Build room' })

    service.applyEvent(room.id, {
      id: 'event-completed',
      type: 'run_completed',
      member,
      run: run('schema-plan'),
      summary: 'Schema work completed.'
    })
    service.applyEvent(room.id, {
      id: 'event-resumed',
      type: 'run_resumed',
      member,
      run: run('schema-plan'),
      resumeKind: 'message',
      summary: 'Checking a follow-up.'
    })

    expect(service.getDetail(room.id)?.runs).toEqual([
      expect.objectContaining({
        key: 'schema-plan',
        status: 'running',
        latestSummary: 'Checking a follow-up.'
      })
    ])
    expect(service.getDetail(room.id)?.messages).toEqual([
      expect.objectContaining({
        id: 'event-completed',
        eventType: 'run_completed',
        content: 'Schema work completed.'
      }),
      expect.objectContaining({
        id: 'event-resumed',
        eventType: 'run_resumed',
        content: 'Checking a follow-up.'
      })
    ])
  })

  it('orders messages by creation order and exposes user authored room messages', async () => {
    db.createSession('Host', 'host-session', 'running')
    const room = service.createRoom({
      id: 'room-1',
      title: 'Build room',
      hostSessionId: 'host-session'
    })

    vi.setSystemTime(new Date('2026-04-24T00:00:01.000Z'))
    service.applyEvent(room.id, {
      type: 'member_joined',
      member
    })
    vi.setSystemTime(new Date('2026-04-24T00:00:02.000Z'))
    await service.appendUserMessage(room.id, 'Please continue.')
    vi.setSystemTime(new Date('2026-04-24T00:00:03.000Z'))
    service.applyEvent(room.id, {
      type: 'run_completed',
      member,
      run: run('schema-plan'),
      summary: 'Finished.'
    })

    expect(
      service.getDetail(room.id)?.messages.map(message => ({
        role: message.role,
        content: message.content,
        eventType: message.eventType
      }))
    ).toEqual([
      { role: 'system', content: 'Architect joined the room', eventType: 'member_joined' },
      { role: 'user', content: 'Please continue.', eventType: undefined },
      { role: 'agent', content: 'Finished.', eventType: 'run_completed' }
    ])
    expect(delivery.processUserMessage).toHaveBeenCalledWith('host-session', 'Please continue.')
  })

  it('includes the host initial user message and final assistant summaries in room detail', () => {
    db.createSession('Host', 'host-session', 'running')
    db.saveMessage('host-session', {
      type: 'message',
      message: {
        id: 'host-user-1',
        role: 'user',
        content: 'Coordinate dev and qa through the room.',
        createdAt: Date.parse('2026-04-23T23:59:59.000Z')
      }
    })
    db.saveMessage('host-session', {
      type: 'message',
      message: {
        id: 'host-assistant-progress',
        role: 'assistant',
        content: 'I will inspect the repo first.',
        createdAt: Date.parse('2026-04-24T00:00:00.250Z')
      }
    })
    db.saveMessage('host-session', {
      type: 'message',
      message: {
        id: 'host-assistant-final',
        role: 'assistant',
        content: 'I have scheduled the architect and will report back here.',
        createdAt: Date.parse('2026-04-24T00:00:00.500Z')
      }
    })
    db.saveMessage('host-session', {
      type: 'message',
      message: {
        id: 'host-user-2',
        role: 'user',
        content: 'hello leader',
        createdAt: Date.parse('2026-04-24T00:00:02.000Z')
      }
    })
    db.saveMessage('host-session', {
      type: 'message',
      message: {
        id: 'host-assistant-casual',
        role: 'assistant',
        content: 'hi',
        createdAt: Date.parse('2026-04-24T00:00:03.000Z')
      }
    })
    const room = service.createRoom({
      id: 'room-1',
      title: 'Build room',
      hostSessionId: 'host-session'
    })

    service.applyEvent(room.id, {
      type: 'assignment_sent',
      member,
      run: run('schema-plan'),
      summary: 'Architect is planning the schema.'
    })

    expect(
      service.getDetail(room.id)?.messages.map(message => ({
        id: message.id,
        role: message.role,
        content: message.content,
        eventType: message.eventType
      }))
    ).toEqual([
      {
        id: 'host-initial:host-session:host-user-1',
        role: 'user',
        content: 'Coordinate dev and qa through the room.',
        eventType: undefined
      },
      expect.objectContaining({
        role: 'agent',
        content: 'Architect is planning the schema.',
        eventType: 'assignment_sent'
      }),
      {
        id: 'host-message:host-session:host-assistant-final',
        role: 'agent',
        content: 'I have scheduled the architect and will report back here.',
        eventType: undefined
      }
    ])
  })

  it('projects host permission requests into room detail as leader attention', () => {
    db.createSession('Host', 'host-session', 'waiting_input')
    db.saveMessage('host-session', {
      type: 'message',
      message: {
        id: 'host-user-1',
        role: 'user',
        content: 'Start the room agents.',
        createdAt: Date.parse('2026-04-24T00:00:00.000Z')
      }
    })
    db.saveMessage('host-session', {
      type: 'interaction_request',
      id: 'codex-approval:2',
      payload: {
        sessionId: 'host-session',
        kind: 'permission',
        question: 'Allow Bash to poll child runs?',
        options: [
          { label: 'Allow once', value: 'allow_once' },
          { label: 'Deny once', value: 'deny_once', description: 'Cancel this command.' }
        ],
        permissionContext: {
          adapter: 'codex',
          subjectKey: 'Bash',
          subjectLabel: 'Bash',
          scope: 'tool'
        }
      }
    })
    const room = service.createRoom({
      id: 'room-1',
      title: 'Build room',
      hostSessionId: 'host-session'
    })

    expect(
      service.getDetail(room.id)?.messages.map(message => ({
        id: message.id,
        role: message.role,
        memberKey: message.memberKey,
        content: message.content,
        eventType: message.eventType,
        payload: message.payload
      }))
    ).toEqual([
      expect.objectContaining({
        id: 'host-initial:host-session:host-user-1',
        role: 'user',
        content: 'Start the room agents.'
      }),
      {
        id: 'host-interaction:host-session:codex-approval:2',
        role: 'agent',
        memberKey: 'host:host-session',
        content: 'Allow Bash to poll child runs?',
        eventType: 'attention_requested',
        payload: {
          source: 'host_session_interaction_request',
          type: 'attention_requested',
          sessionId: 'host-session',
          interactionId: 'codex-approval:2',
          requestKind: 'confirmation',
          status: 'pending',
          options: [
            { label: 'Allow once', value: 'allow_once' },
            { label: 'Deny once', value: 'deny_once', description: 'Cancel this command.' }
          ],
          permissionContext: {
            adapter: 'codex',
            subjectKey: 'Bash',
            subjectLabel: 'Bash',
            scope: 'tool'
          }
        }
      }
    ])
  })

  it('marks projected host interaction requests as pending, handled or expired', () => {
    db.createSession('Host pending', 'host-pending', 'waiting_input')
    db.saveMessage('host-pending', {
      type: 'interaction_request',
      id: 'approval-pending',
      payload: {
        sessionId: 'host-pending',
        kind: 'permission',
        question: 'Pending request?',
        options: [{ label: 'Allow once', value: 'allow_once' }]
      }
    })
    const pendingRoom = service.createRoom({
      id: 'room-pending',
      title: 'Pending room',
      hostSessionId: 'host-pending'
    })

    db.createSession('Host handled', 'host-handled', 'running')
    db.saveMessage('host-handled', {
      type: 'interaction_request',
      id: 'approval-handled',
      payload: {
        sessionId: 'host-handled',
        kind: 'permission',
        question: 'Handled request?',
        options: [{ label: 'Allow once', value: 'allow_once' }]
      }
    })
    db.saveMessage('host-handled', {
      type: 'interaction_response',
      id: 'approval-handled',
      data: 'allow_once'
    })
    const handledRoom = service.createRoom({
      id: 'room-handled',
      title: 'Handled room',
      hostSessionId: 'host-handled'
    })

    db.createSession('Host expired', 'host-expired', 'failed')
    db.saveMessage('host-expired', {
      type: 'interaction_request',
      id: 'approval-expired',
      payload: {
        sessionId: 'host-expired',
        kind: 'permission',
        question: 'Expired request?',
        options: [{ label: 'Allow once', value: 'allow_once' }]
      }
    })
    db.saveMessage('host-expired', {
      type: 'error',
      data: {
        message: 'Host failed',
        fatal: true
      },
      message: 'Host failed'
    })
    const expiredRoom = service.createRoom({
      id: 'room-expired',
      title: 'Expired room',
      hostSessionId: 'host-expired'
    })

    expect(service.getDetail(pendingRoom.id)?.messages[0]?.payload).toEqual(expect.objectContaining({
      interactionId: 'approval-pending',
      status: 'pending'
    }))
    expect(service.getDetail(handledRoom.id)?.messages[0]?.payload).toEqual(expect.objectContaining({
      interactionId: 'approval-handled',
      status: 'handled',
      response: 'allow_once'
    }))
    expect(service.getDetail(expiredRoom.id)?.messages[0]?.payload).toEqual(expect.objectContaining({
      interactionId: 'approval-expired',
      status: 'expired'
    }))
  })

  it('includes host user messages that trigger room activity', () => {
    db.createSession('Host', 'host-session', 'running')
    db.saveMessage('host-session', {
      type: 'message',
      message: {
        id: 'host-user-1',
        role: 'user',
        content: 'hello leader',
        createdAt: Date.parse('2026-04-24T00:00:00.000Z')
      }
    })
    db.saveMessage('host-session', {
      type: 'message',
      message: {
        id: 'host-assistant-casual-1',
        role: 'assistant',
        content: 'hi',
        createdAt: Date.parse('2026-04-24T00:00:00.500Z')
      }
    })
    db.saveMessage('host-session', {
      type: 'message',
      message: {
        id: 'host-user-2',
        role: 'user',
        content: 'Start the architect in the room.',
        createdAt: Date.parse('2026-04-24T00:00:01.000Z')
      }
    })
    db.saveMessage('host-session', {
      type: 'message',
      message: {
        id: 'host-assistant-progress',
        role: 'assistant',
        content: 'Starting the architect now.',
        createdAt: Date.parse('2026-04-24T00:00:01.100Z')
      }
    })
    db.saveMessage('host-session', {
      type: 'message',
      message: {
        id: 'host-assistant-final',
        role: 'assistant',
        content: 'The architect is now in the room.',
        createdAt: Date.parse('2026-04-24T00:00:01.500Z')
      }
    })
    db.saveMessage('host-session', {
      type: 'message',
      message: {
        id: 'host-user-3',
        role: 'user',
        content: 'casual follow-up',
        createdAt: Date.parse('2026-04-24T00:00:02.000Z')
      }
    })
    db.saveMessage('host-session', {
      type: 'message',
      message: {
        id: 'host-assistant-casual-2',
        role: 'assistant',
        content: 'casual answer',
        createdAt: Date.parse('2026-04-24T00:00:03.000Z')
      }
    })
    const room = service.createRoom({
      id: 'room-1',
      title: 'Build room',
      hostSessionId: 'host-session'
    })

    service.applyEvent(room.id, {
      type: 'assignment_sent',
      member,
      run: run('schema-plan'),
      summary: 'Architect is planning the schema.'
    }, {
      now: Date.parse('2026-04-24T00:00:01.250Z')
    })

    expect(
      service.getDetail(room.id)?.messages.map(message => ({
        id: message.id,
        role: message.role,
        content: message.content,
        eventType: message.eventType,
        payload: message.payload
      }))
    ).toEqual([
      expect.objectContaining({
        id: 'host-initial:host-session:host-user-1',
        role: 'user',
        content: 'hello leader'
      }),
      expect.objectContaining({
        id: 'host-user:host-session:host-user-2',
        role: 'user',
        content: 'Start the architect in the room.',
        payload: expect.objectContaining({
          source: 'host_user_message'
        })
      }),
      expect.objectContaining({
        role: 'agent',
        content: 'Architect is planning the schema.',
        eventType: 'assignment_sent'
      }),
      expect.objectContaining({
        id: 'host-message:host-session:host-assistant-final',
        role: 'agent',
        content: 'The architect is now in the room.'
      })
    ])
  })

  it('includes leader replies triggered by child room requests in room detail', () => {
    db.createSession('Host', 'host-session', 'waiting_input')
    db.saveMessage('host-session', {
      type: 'message',
      message: {
        id: 'host-user-1',
        role: 'user',
        content: 'Coordinate dev and qa through the room.',
        createdAt: Date.parse('2026-04-23T23:59:59.000Z')
      }
    })
    const room = service.createRoom({
      id: 'room-1',
      title: 'Build room',
      hostSessionId: 'host-session'
    })

    service.applyEvent(room.id, {
      type: 'assignment_sent',
      member,
      run: run('schema-plan'),
      summary: 'Architect is planning the schema.'
    }, {
      now: Date.parse('2026-04-24T00:00:00.400Z')
    })
    db.saveMessage('host-session', {
      type: 'message',
      message: {
        id: 'host-child-request',
        role: 'user',
        content: [
          '[Agent room child request] Architect / Run schema-plan is waiting for your handling.',
          '',
          'Context:',
          '- memberKey: architect',
          '- runKey: schema-plan',
          '- childSessionId: session-schema-plan'
        ].join('\n'),
        createdAt: Date.parse('2026-04-24T00:00:01.000Z')
      }
    })
    db.saveMessage('host-session', {
      type: 'message',
      message: {
        id: 'host-child-prompt',
        role: 'assistant',
        content: 'Should I ask the user to approve the child request?',
        createdAt: Date.parse('2026-04-24T00:00:02.000Z')
      }
    })

    expect(service.getDetail(room.id)?.messages).toEqual([
      expect.objectContaining({
        id: 'host-initial:host-session:host-user-1'
      }),
      expect.objectContaining({
        content: 'Architect is planning the schema.',
        eventType: 'assignment_sent'
      }),
      expect.objectContaining({
        id: 'host-message:host-session:host-child-prompt',
        content: 'Should I ask the user to approve the child request?',
        memberKey: 'host:host-session',
        runKey: 'schema-plan',
        payload: expect.objectContaining({
          target: {
            memberKey: 'architect',
            runKey: 'schema-plan'
          }
        })
      })
    ])
  })

  it('delivers targeted room messages through the session user message service', async () => {
    const room = service.createRoom({ id: 'room-1', title: 'Build room' })
    db.createSession('Schema plan', 'session-schema-plan', 'running', 'host-session')
    service.applyEvent(room.id, {
      type: 'assignment_sent',
      member,
      run: run('schema-plan'),
      summary: 'Schema work started.'
    })

    await service.appendUserMessage(room.id, 'Please continue.', {
      memberKey: 'architect',
      runKey: 'schema-plan'
    })

    expect(delivery.processUserMessage).toHaveBeenCalledWith('session-schema-plan', 'Please continue.')
    expect(delivery.handleInteractionResponse).not.toHaveBeenCalled()
    expect(service.getDetail(room.id)?.messages.at(-1)).toEqual(expect.objectContaining({
      payload: expect.objectContaining({
        delivery: expect.objectContaining({
          kind: 'message',
          sessionId: 'session-schema-plan',
          target: {
            memberKey: 'architect',
            runKey: 'schema-plan'
          }
        }),
        reactions: [
          expect.objectContaining({
            kind: 'working',
            target: {
              memberKey: 'architect',
              runKey: 'schema-plan'
            }
          })
        ]
      })
    }))
  })

  it('queues targeted room messages into external runtime sessions', async () => {
    const runtimeAiBaseDir = await mkdtemp(path.join(os.tmpdir(), 'ow-agent-room-runtime-'))
    tempRuntimeRoot = runtimeAiBaseDir
    const runtimeRoot = path.join(runtimeAiBaseDir, 'runtime')
    process.env.__ONEWORKS_PROJECT_BASE_DIR__ = runtimeAiBaseDir
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(runtimeAiBaseDir, 'home-projects')
    const homeRuntimeRoot = resolveProjectHomePath(process.cwd(), process.env, 'runtime')
    await mkdir(path.join(runtimeRoot, 'sessions', 'session-schema-plan'), { recursive: true })

    const room = service.createRoom({ id: 'room-1', title: 'Build room' })
    db.createSession('Schema plan', 'session-schema-plan', 'completed', 'host-session')
    db.upsertSessionWorkspace({
      sessionId: 'session-schema-plan',
      kind: 'external_workspace',
      workspaceFolder: process.cwd(),
      cleanupPolicy: 'retain',
      state: 'ready'
    })
    db.createSession('Schema review', 'session-schema-review', 'completed', 'host-session')
    db.updateSessionRuntimeState('session-schema-plan', { runtimeKind: 'external' })
    service.applyEvent(room.id, {
      type: 'run_completed',
      member,
      run: run('schema-plan'),
      summary: 'Schema work completed.'
    })
    service.applyEvent(room.id, {
      type: 'run_completed',
      member: {
        key: 'reviewer',
        kind: 'entity',
        label: 'Reviewer'
      },
      run: {
        key: 'schema-review',
        sessionId: 'session-schema-review',
        title: 'Schema review'
      },
      summary: 'Schema review completed.'
    })

    await service.appendUserMessage(room.id, 'Please continue externally.', {
      memberKey: 'architect',
      runKey: 'schema-plan'
    })

    expect(delivery.processUserMessage).not.toHaveBeenCalled()
    const command = JSON.parse(
      await readFile(path.join(homeRuntimeRoot, 'sessions', 'session-schema-plan', 'commands.jsonl'), 'utf8')
    ) as {
      content?: string
      sessionId?: string
      source?: string
      type?: string
    }
    expect(command).toEqual(expect.objectContaining({
      sessionId: 'session-schema-plan',
      source: 'user',
      type: 'send_message'
    }))
    expect(command.content).toContain('Please continue externally.')
    expect(command.content).toContain('Current Agent Room context:')
    expect(command.content).toContain('memberKey=architect | sessionId=session-schema-plan')
    expect(command.content).toContain('memberKey=reviewer | sessionId=session-schema-review')
    expect(command.content).toContain('Do not start a new session for any existing member listed above.')
    await expect(pathExists(path.join(runtimeRoot, 'sessions', 'session-schema-plan', 'commands.jsonl'))).resolves
      .toBe(false)
  })

  it('delivers targeted room replies as interaction responses when the run is waiting', async () => {
    const room = service.createRoom({ id: 'room-1', title: 'Build room' })
    db.createSession('Schema plan', 'session-schema-plan', 'waiting_input', 'host-session')
    service.applyEvent(room.id, {
      type: 'attention_requested',
      member,
      run: run('schema-plan'),
      interactionId: 'interaction-1',
      requestKind: 'confirmation',
      summary: 'Need approval.',
      options: [{ label: 'Approve', value: 'approve' }]
    })

    await service.appendUserMessage(room.id, 'approve', {
      memberKey: 'architect',
      runKey: 'schema-plan'
    })

    expect(delivery.handleInteractionResponse).toHaveBeenCalledWith('session-schema-plan', 'interaction-1', 'approve')
    expect(delivery.processUserMessage).not.toHaveBeenCalled()
    expect(service.getDetail(room.id)?.messages.at(-1)).toEqual(expect.objectContaining({
      payload: expect.objectContaining({
        delivery: expect.objectContaining({
          kind: 'interaction_response',
          sessionId: 'session-schema-plan'
        }),
        reactions: [
          expect.objectContaining({ kind: 'working' })
        ]
      })
    }))
  })

  it('projects final child replies for targeted room messages', async () => {
    const room = service.createRoom({ id: 'room-1', title: 'Build room' })
    db.createSession('Schema plan', 'session-schema-plan', 'completed', 'host-session')
    service.applyEvent(room.id, {
      type: 'run_completed',
      member,
      run: run('schema-plan'),
      summary: 'Schema work completed.'
    })

    vi.setSystemTime(new Date('2026-04-24T00:00:01.000Z'))
    await service.appendUserMessage(room.id, 'Hello architect.', {
      memberKey: 'architect'
    })
    db.saveMessage('session-schema-plan', {
      type: 'message',
      message: {
        id: 'child-room-user',
        role: 'user',
        content: 'Hello architect.',
        createdAt: Date.parse('2026-04-24T00:00:01.005Z')
      }
    })
    db.saveMessage('session-schema-plan', {
      type: 'message',
      message: {
        id: 'child-room-progress',
        role: 'assistant',
        content: 'Checking the request.',
        createdAt: Date.parse('2026-04-24T00:00:02.000Z')
      }
    })
    db.saveMessage('session-schema-plan', {
      type: 'message',
      message: {
        id: 'child-room-final',
        role: 'assistant',
        content: 'Here is the schema answer.',
        createdAt: Date.parse('2026-04-24T00:00:03.000Z')
      }
    })

    const detail = service.getDetail(room.id)

    expect(
      detail?.messages.map(message => ({
        id: message.id,
        role: message.role,
        memberKey: message.memberKey,
        runKey: message.runKey,
        content: message.content,
        eventType: message.eventType,
        payload: message.payload
      }))
    ).toEqual([
      expect.objectContaining({
        eventType: 'run_completed',
        content: 'Schema work completed.'
      }),
      expect.objectContaining({
        role: 'user',
        memberKey: 'architect',
        content: 'Hello architect.'
      }),
      {
        id: 'child-message:session-schema-plan:child-room-final',
        role: 'agent',
        memberKey: 'architect',
        runKey: 'schema-plan',
        content: 'Here is the schema answer.',
        payload: expect.objectContaining({
          source: 'child_session_message',
          sessionId: 'session-schema-plan',
          replyTo: expect.objectContaining({
            role: 'user',
            content: 'Hello architect.'
          }),
          target: {
            memberKey: 'architect',
            runKey: 'schema-plan'
          }
        })
      }
    ])
    expect(detail?.room).toEqual(expect.objectContaining({
      lastMessage: 'Here is the schema answer.',
      updatedAt: Date.parse('2026-04-24T00:00:03.000Z')
    }))
  })

  it('matches wrapped room-delivered child user messages and quotes their replies', async () => {
    const room = service.createRoom({ id: 'room-1', title: 'Build room' })
    db.createSession('Schema plan', 'session-schema-plan', 'completed', 'host-session')
    service.applyEvent(room.id, {
      type: 'run_completed',
      member,
      run: run('schema-plan'),
      summary: 'Schema work completed.'
    })

    vi.setSystemTime(new Date('2026-04-24T00:00:01.000Z'))
    await service.appendUserMessage(room.id, 'Hello architect.', {
      memberKey: 'architect'
    })
    db.saveMessage('session-schema-plan', {
      type: 'message',
      message: {
        id: 'child-room-user',
        role: 'user',
        content: [
          '<agent-room-message>',
          'Current Agent Room context:',
          '- roomId: room-1',
          '',
          'User message:',
          'Hello architect.',
          '</agent-room-message>'
        ].join('\n'),
        createdAt: Date.parse('2026-04-24T00:00:01.005Z')
      }
    })
    db.saveMessage('session-schema-plan', {
      type: 'message',
      message: {
        id: 'child-room-final',
        role: 'assistant',
        content: 'Here is the wrapped answer.',
        createdAt: Date.parse('2026-04-24T00:00:03.000Z')
      }
    })
    service.applyEvent(room.id, {
      id: 'runtime-completed-wrapped',
      type: 'run_completed',
      member,
      run: run('schema-plan'),
      summary: 'Here is the wrapped answer.'
    }, {
      now: Date.parse('2026-04-24T00:00:03.500Z')
    })

    const detail = service.getDetail(room.id)

    expect(detail?.messages).toEqual([
      expect.objectContaining({
        eventType: 'run_completed',
        content: 'Schema work completed.'
      }),
      expect.objectContaining({
        role: 'user',
        content: 'Hello architect.'
      }),
      expect.objectContaining({
        id: 'child-message:session-schema-plan:child-room-final',
        role: 'agent',
        content: 'Here is the wrapped answer.',
        payload: expect.objectContaining({
          source: 'child_session_message',
          replyTo: expect.objectContaining({
            role: 'user',
            content: 'Hello architect.'
          })
        })
      })
    ])
    expect(detail?.messages.some(message => message.id === 'runtime-completed-wrapped')).toBe(false)
  })

  it('projects direct child session user messages into the room and quotes child replies', () => {
    const room = service.createRoom({ id: 'room-1', title: 'Build room' })
    db.createSession('Schema plan', 'session-schema-plan', 'completed', 'host-session')
    service.applyEvent(room.id, {
      type: 'run_completed',
      member,
      run: run('schema-plan'),
      summary: 'Schema work completed.'
    })

    db.saveMessage('session-schema-plan', {
      type: 'message',
      message: {
        id: 'child-direct-user',
        role: 'user',
        content: 'Direct hello.',
        createdAt: Date.parse('2026-04-24T00:00:04.000Z')
      }
    })
    db.saveMessage('session-schema-plan', {
      type: 'message',
      message: {
        id: 'child-direct-final',
        role: 'assistant',
        content: 'Direct answer.',
        createdAt: Date.parse('2026-04-24T00:00:05.000Z')
      }
    })
    service.applyEvent(room.id, {
      id: 'runtime-completed-direct',
      type: 'run_completed',
      member,
      run: run('schema-plan'),
      summary: 'Direct answer.'
    }, {
      now: Date.parse('2026-04-24T00:00:05.500Z')
    })

    const detail = service.getDetail(room.id)

    expect(detail?.messages).toEqual([
      expect.objectContaining({
        eventType: 'run_completed',
        content: 'Schema work completed.'
      }),
      {
        id: 'child-user:session-schema-plan:child-direct-user',
        roomId: room.id,
        role: 'user',
        memberKey: 'architect',
        runKey: 'schema-plan',
        content: 'Direct hello.',
        payload: {
          source: 'child_session_user_message',
          sessionId: 'session-schema-plan',
          messageId: 'child-direct-user',
          target: {
            memberKey: 'architect',
            runKey: 'schema-plan'
          }
        },
        createdAt: Date.parse('2026-04-24T00:00:04.000Z')
      },
      expect.objectContaining({
        id: 'child-message:session-schema-plan:child-direct-final',
        role: 'agent',
        memberKey: 'architect',
        runKey: 'schema-plan',
        content: 'Direct answer.',
        payload: expect.objectContaining({
          source: 'child_session_message',
          replyTo: expect.objectContaining({
            id: 'child-user:session-schema-plan:child-direct-user',
            role: 'user',
            content: 'Direct hello.'
          })
        })
      })
    ])
    expect(detail?.messages.some(message => message.id === 'runtime-completed-direct')).toBe(false)
  })

  it('hides duplicate persisted completed summaries for the same run', () => {
    const room = service.createRoom({ id: 'room-1', title: 'Build room' })
    const plannerIntro = [
      '我是你的代码代理，主要职责是读懂当前仓库、制定可执行方案，并在需要时直接完成实现、验证和问题排查。  ',
      '我擅长处理代码修改、架构梳理、调试定位、测试补齐，以及前后端联动这类需要结合上下文推进的问题。'
    ].join('\n')

    service.applyEvent(room.id, {
      id: 'runtime:sess-plan:evt_5',
      type: 'run_completed',
      member,
      run: run('schema-plan'),
      summary: plannerIntro
    })
    service.applyEvent(room.id, {
      id: 'runtime:sess-plan:runtime-state:sess-plan:5:completed',
      type: 'run_completed',
      member,
      run: run('schema-plan'),
      summary: plannerIntro
    })

    expect(service.getDetail(room.id)?.messages).toEqual([
      expect.objectContaining({
        id: 'runtime:sess-plan:evt_5',
        eventType: 'run_completed',
        content: plannerIntro
      })
    ])
  })

  it('falls back untargeted room messages to the host session', async () => {
    db.createSession('Host', 'host-session', 'running')
    const room = service.createRoom({
      id: 'room-1',
      title: 'Build room',
      hostSessionId: 'host-session'
    })

    await service.appendUserMessage(room.id, 'Please coordinate the next step.')

    expect(delivery.processUserMessage).toHaveBeenCalledWith('host-session', 'Please coordinate the next step.')
    expect(service.getDetail(room.id)?.messages).toEqual([
      expect.objectContaining({
        role: 'user',
        content: 'Please coordinate the next step.',
        payload: expect.objectContaining({
          delivery: expect.objectContaining({
            kind: 'message',
            sessionId: 'host-session'
          }),
          reactions: [
            expect.objectContaining({ kind: 'working' })
          ]
        })
      })
    ])
  })

  it('projects final leader replies for follow-up messages sent from the room', async () => {
    db.createSession('Host', 'host-session', 'running')
    const room = service.createRoom({
      id: 'room-1',
      title: 'Build room',
      hostSessionId: 'host-session'
    })

    vi.setSystemTime(new Date('2026-04-24T00:00:01.000Z'))
    await service.appendUserMessage(room.id, 'Where are we now?')
    db.saveMessage('host-session', {
      type: 'message',
      message: {
        id: 'host-room-user',
        role: 'user',
        content: 'Where are we now?',
        createdAt: Date.parse('2026-04-24T00:00:01.005Z')
      }
    })
    db.saveMessage('host-session', {
      type: 'message',
      message: {
        id: 'host-room-progress',
        role: 'assistant',
        content: 'Checking the child run status first.',
        createdAt: Date.parse('2026-04-24T00:00:02.000Z')
      }
    })
    db.saveMessage('host-session', {
      type: 'message',
      message: {
        id: 'host-room-final',
        role: 'assistant',
        content: 'Both child runs are completed.',
        createdAt: Date.parse('2026-04-24T00:00:03.000Z')
      }
    })

    const detail = service.getDetail(room.id)

    expect(
      detail?.messages.map(message => ({
        id: message.id,
        role: message.role,
        content: message.content,
        payload: message.payload
      }))
    ).toEqual([
      expect.objectContaining({
        role: 'user',
        content: 'Where are we now?'
      }),
      {
        id: 'host-message:host-session:host-room-final',
        role: 'agent',
        content: 'Both child runs are completed.',
        payload: expect.objectContaining({
          replyTo: {
            id: expect.any(String),
            role: 'user',
            content: 'Where are we now?'
          }
        })
      }
    ])
    expect(detail?.room).toEqual(expect.objectContaining({
      lastMessage: 'Both child runs are completed.',
      updatedAt: Date.parse('2026-04-24T00:00:03.000Z')
    }))
    expect(service.listRooms()).toEqual([
      expect.objectContaining({
        id: room.id,
        lastMessage: 'Both child runs are completed.'
      })
    ])
  })

  it('answers pending leader interactions from untargeted room replies', async () => {
    db.createSession('Host', 'host-session', 'waiting_input')
    vi.mocked(delivery.getSessionInteraction!).mockReturnValue({
      id: 'leader-approval'
    })
    const room = service.createRoom({
      id: 'room-1',
      title: 'Build room',
      hostSessionId: 'host-session'
    })

    await service.appendUserMessage(room.id, 'allow_once')

    expect(delivery.handleInteractionResponse).toHaveBeenCalledWith('host-session', 'leader-approval', 'allow_once')
    expect(delivery.processUserMessage).not.toHaveBeenCalled()
    expect(service.getDetail(room.id)?.messages[0]).toEqual(expect.objectContaining({
      payload: expect.objectContaining({
        reactions: [
          expect.objectContaining({ kind: 'working' })
        ]
      })
    }))
  })

  it('answers projected pending leader interactions through the room interaction endpoint', async () => {
    db.createSession('Host', 'host-session', 'waiting_input')
    db.saveMessage('host-session', {
      type: 'interaction_request',
      id: 'leader-approval',
      payload: {
        sessionId: 'host-session',
        kind: 'permission',
        question: 'Allow the leader action?',
        options: [{ label: 'Allow once', value: 'allow_once' }]
      }
    })
    const room = service.createRoom({
      id: 'room-1',
      title: 'Build room',
      hostSessionId: 'host-session'
    })

    await expect(service.respondInteraction(room.id, 'leader-approval', 'allow_once')).resolves.toBe(true)

    expect(delivery.handleInteractionResponse).toHaveBeenCalledWith('host-session', 'leader-approval', 'allow_once')
  })

  it('falls back to child run interaction ids for room interaction responses', async () => {
    const room = service.createRoom({ id: 'room-1', title: 'Build room' })
    db.createSession('Schema plan', 'session-schema-plan', 'waiting_input', 'host-session')
    service.applyEvent(room.id, {
      type: 'attention_requested',
      member,
      run: run('schema-plan'),
      interactionId: 'child-approval',
      requestKind: 'confirmation',
      summary: 'Need child approval.',
      options: [{ label: 'Approve', value: 'approve' }]
    })

    await expect(service.respondInteraction(room.id, 'child-approval', ['approve'])).resolves.toBe(true)

    expect(delivery.handleInteractionResponse).toHaveBeenCalledWith('session-schema-plan', 'child-approval', [
      'approve'
    ])
  })

  it('rejects room interaction responses when no pending request matches', async () => {
    db.createSession('Host', 'host-session', 'running')
    db.saveMessage('host-session', {
      type: 'interaction_request',
      id: 'leader-approval',
      payload: {
        sessionId: 'host-session',
        kind: 'permission',
        question: 'Allow the leader action?',
        options: [{ label: 'Allow once', value: 'allow_once' }]
      }
    })
    const room = service.createRoom({
      id: 'room-1',
      title: 'Build room',
      hostSessionId: 'host-session'
    })

    await expect(service.respondInteraction(room.id, 'leader-approval', 'allow_once')).resolves.toBe(false)
    expect(delivery.handleInteractionResponse).not.toHaveBeenCalled()
  })

  it('rejects undeliverable room messages before appending them', async () => {
    const room = service.createRoom({ id: 'room-1', title: 'Build room' })

    await expect(service.appendUserMessage(room.id, 'Please continue.'))
      .rejects
      .toThrow('No deliverable session for agent room message: room-1')

    expect(delivery.processUserMessage).not.toHaveBeenCalled()
    expect(service.getDetail(room.id)?.messages).toEqual([])
  })

  it('persists archive and favorite metadata without deleting room detail', async () => {
    db.createSession('Host', 'host-session', 'running')
    db.createSession('Host child', 'host-child-session', 'running', 'host-session')
    const room = service.createRoom({
      id: 'room-1',
      title: 'Build room',
      hostSessionId: 'host-session'
    })
    await service.appendUserMessage(room.id, 'Keep this transcript.')

    vi.setSystemTime(new Date('2026-04-24T00:00:01.000Z'))
    const favorited = service.updateRoomMetadata(room.id, { isFavorited: true })
    expect(favorited.favoritedAt).toBe(Date.now())

    vi.setSystemTime(new Date('2026-04-24T00:00:02.000Z'))
    const favoritedAgain = service.updateRoomMetadata(room.id, { isFavorited: true })
    expect(favoritedAgain.favoritedAt).toBe(favorited.favoritedAt)

    vi.setSystemTime(new Date('2026-04-24T00:00:03.000Z'))
    const archived = service.updateRoomMetadata(room.id, { isArchived: true })

    expect(archived).toEqual(expect.objectContaining({
      archivedAt: Date.now(),
      favoritedAt: favorited.favoritedAt
    }))
    expect(service.listRooms()).toEqual([])
    expect(service.listRooms('archived')).toEqual([
      expect.objectContaining({
        id: room.id,
        archivedAt: Date.now(),
        favoritedAt: favorited.favoritedAt
      })
    ])
    expect(db.getSession('host-session')).toEqual(expect.objectContaining({ isArchived: true }))
    expect(db.getSession('host-child-session')).toEqual(expect.objectContaining({ isArchived: true }))
    expect(notifySessionUpdated).toHaveBeenCalledWith(
      'host-session',
      expect.objectContaining({ id: 'host-session', isArchived: true })
    )
    expect(notifySessionUpdated).toHaveBeenCalledWith(
      'host-child-session',
      expect.objectContaining({ id: 'host-child-session', isArchived: true })
    )
    expect(service.getDetail(room.id)?.messages).toEqual([
      expect.objectContaining({ content: 'Keep this transcript.' })
    ])

    const restored = service.updateRoomMetadata(room.id, {
      isArchived: false,
      isFavorited: false
    })
    expect(restored.archivedAt).toBeUndefined()
    expect(restored.favoritedAt).toBeUndefined()
    expect(db.getSession('host-session')).toEqual(expect.objectContaining({ isArchived: false }))
    expect(db.getSession('host-child-session')).toEqual(expect.objectContaining({ isArchived: false }))
    expect(notifySessionUpdated).toHaveBeenCalledWith(
      'host-session',
      expect.objectContaining({ id: 'host-session', isArchived: false })
    )
    expect(notifySessionUpdated).toHaveBeenCalledWith(
      'host-child-session',
      expect.objectContaining({ id: 'host-child-session', isArchived: false })
    )
    expect(service.listRooms()).toEqual([expect.objectContaining({ id: room.id })])
  })
})
