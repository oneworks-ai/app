/* eslint-disable max-lines -- runtime projection regression suite keeps shared setup local */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WSEvent } from '@oneworks/core'
import { resolveProjectHomePath } from '@oneworks/utils'

import { SqliteDb } from '#~/db/index.js'
import { createSqliteDatabase } from '#~/db/sqlite.js'
import { createAgentRoomService } from '#~/services/agent-room/index.js'
import { discoverRuntimeSessionStores } from '#~/services/runtime-store/discovery.js'
import { projectRuntimeEvent } from '#~/services/runtime-store/projection.js'
import type { RuntimeEvent, RuntimeSessionMetadata, RuntimeSessionStore } from '#~/services/runtime-store/types.js'
import { RuntimeStoreWatcher, replayRuntimeStore } from '#~/services/runtime-store/watcher.js'
import { createWorkspaceRuntimeEnv } from '#~/services/runtime-store/workspace-env.js'

describe('runtime store projection', () => {
  const originalProjectHomeProjectsDir = process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__
  let db: SqliteDb
  let tempRoot: string | undefined
  let processLeaderMessage: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-29T00:00:00.000Z'))
    db = new SqliteDb({ db: createSqliteDatabase(':memory:') })
    processLeaderMessage = vi.fn(async () => undefined)
  })

  afterEach(async () => {
    db.close()
    vi.useRealTimers()
    if (originalProjectHomeProjectsDir == null) {
      delete process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__
    } else {
      process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = originalProjectHomeProjectsDir
    }
    if (tempRoot != null) {
      await rm(tempRoot, { force: true, recursive: true })
      tempRoot = undefined
    }
  })

  const project = (event: RuntimeEvent, metadata: Partial<RuntimeSessionMetadata> = {}) => {
    projectRuntimeEvent(event, {
      db,
      broadcast: false,
      agentRoomProjectionEnabled: true,
      hostRequestDelivery: {
        processUserMessage: processLeaderMessage
      },
      metadata: {
        sessionId: event.sessionId,
        title: 'Runtime session',
        roomId: 'room-1',
        roomTitle: 'Runtime room',
        memberKey: 'dev',
        memberLabel: 'Developer',
        runId: 'run-dev',
        runTitle: 'Developer run',
        ...metadata
      }
    })
  }

  const flushDelivery = async () => {
    await Promise.resolve()
    await Promise.resolve()
  }

  const getHostDeliveryMarker = (sessionId: string) => {
    const event = db.getMessages(sessionId)[0] as WSEvent | undefined
    if (event?.type !== 'adapter_event' || event.data?.source !== 'runtime_host_request_delivery') {
      throw new Error(`Expected host session ${sessionId} to receive a delivery marker.`)
    }
    return event.data as {
      childSessionId: string
      deliveryKey: string
      interactionId: string
      requestKind: string
      runKey: string
      runtimeEventId?: string
      runtimeEventSeq?: number
      source: string
    }
  }

  const isRuntimeHostRequestDeliveryEvent = (
    event: WSEvent
  ): event is Extract<WSEvent, { type: 'adapter_event' }> => (
    event.type === 'adapter_event' && event.data?.source === 'runtime_host_request_delivery'
  )

  it('initializes runtime-projected session permission mode from metadata', () => {
    project({
      id: 'evt-create-permission',
      seq: 1,
      sessionId: 'sess-dev',
      type: 'session_started',
      status: 'running'
    }, { permissionMode: 'bypassPermissions' })

    expect(db.getSession('sess-dev')?.permissionMode).toBe('bypassPermissions')
  })

  it('preserves current session permission mode over stale runtime metadata', () => {
    db.createSession('Runtime session', 'sess-dev', 'completed')
    db.updateSession('sess-dev', { permissionMode: 'bypassPermissions' })

    project({
      id: 'evt-stale-permission',
      seq: 1,
      sessionId: 'sess-dev',
      type: 'session_started',
      status: 'running'
    }, { permissionMode: 'default' })

    expect(db.getSession('sess-dev')?.permissionMode).toBe('bypassPermissions')
  })

  it('projects failed runtime sessions as visible fatal error events', () => {
    const failedEvent: RuntimeEvent = {
      error:
        '{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"Model is not supported by this account."}}\nother',
      id: 'evt-failed',
      seq: 1,
      sessionId: 'sess-dev',
      status: 'failed',
      type: 'session_failed',
      visibility: 'room'
    }

    project(failedEvent)
    project(failedEvent)

    expect(db.getSession('sess-dev')?.status).toBe('failed')
    expect(db.getMessages('sess-dev')).toEqual([
      {
        type: 'error',
        message: 'Model is not supported by this account.',
        data: {
          code: 'session_failed',
          details: {
            runtimeEventId: 'evt-failed',
            runtimeEventSeq: 1,
            runtimeEventType: 'session_failed',
            runtimeSessionId: 'sess-dev'
          },
          fatal: true,
          message: 'Model is not supported by this account.'
        }
      }
    ])
  })

  it('keeps private session messages out of the agent room timeline', () => {
    project({
      id: 'evt-private',
      seq: 1,
      sessionId: 'sess-dev',
      type: 'message',
      role: 'assistant',
      content: 'private implementation details',
      visibility: 'private'
    })

    expect(db.getMessages('sess-dev')).toEqual([
      expect.objectContaining({
        type: 'message',
        message: expect.objectContaining({
          content: 'private implementation details'
        })
      })
    ])
    expect(db.getAgentRoomDetail('room-1')?.messages).toEqual([])
  })

  it('keeps room-visible assistant summaries out of the room timeline', () => {
    db.createAgentRoom({
      id: 'room-other',
      title: 'Other room'
    })
    db.appendAgentRoomMessage({
      id: 'evt-room',
      roomId: 'room-other',
      role: 'agent',
      content: 'Existing event from another runtime.',
      eventType: 'run_replied'
    })

    project({
      id: 'evt-room',
      seq: 1,
      sessionId: 'sess-dev',
      type: 'message',
      role: 'assistant',
      content: 'secret transcript',
      publicSummary: 'Implementation is complete.'
    })

    expect(db.getAgentRoomDetail('room-other')?.messages).toEqual([
      expect.objectContaining({
        id: 'evt-room',
        content: 'Existing event from another runtime.'
      })
    ])
    expect(db.getAgentRoomDetail('room-1')?.messages).toEqual([])
  })

  it('marks child session user prompts with structured agent room source metadata', () => {
    project({
      id: 'evt-direct-user',
      seq: 1,
      sessionId: 'sess-dev',
      type: 'message',
      role: 'user',
      content: 'direct user prompt'
    }, { hostSessionId: 'host-session' })
    project({
      id: 'evt-leader-command',
      seq: 2,
      sessionId: 'sess-dev',
      type: 'message',
      role: 'user',
      content: 'leader delegated prompt',
      commandId: 'cmd-1'
    }, { hostSessionId: 'host-session' })
    project({
      id: 'evt-user-command',
      seq: 3,
      sessionId: 'sess-dev',
      type: 'message',
      role: 'user',
      content: 'direct command-backed user prompt',
      source: 'user',
      commandId: 'cmd-user'
    }, { hostSessionId: 'host-session' })
    project({
      id: 'evt-agent-command',
      seq: 4,
      sessionId: 'sess-dev',
      type: 'message',
      role: 'user',
      content: 'reviewer delegated prompt',
      source: 'std/dev-reviewer',
      sourceLabel: 'std/dev-reviewer',
      commandId: 'cmd-2'
    }, { hostSessionId: 'host-session' })

    expect(db.getMessages('sess-dev')).toEqual([
      expect.objectContaining({
        type: 'message',
        message: expect.objectContaining({
          id: 'evt-direct-user',
          agentRoom: expect.objectContaining({
            source: 'user',
            roomId: 'room-1',
            hostSessionId: 'host-session',
            memberKey: 'dev',
            runKey: 'run-dev'
          })
        })
      }),
      expect.objectContaining({
        type: 'message',
        message: expect.objectContaining({
          id: 'evt-leader-command',
          agentRoom: expect.objectContaining({
            source: 'leader',
            roomId: 'room-1',
            hostSessionId: 'host-session',
            memberKey: 'dev',
            runKey: 'run-dev',
            commandId: 'cmd-1'
          })
        })
      }),
      expect.objectContaining({
        type: 'message',
        message: expect.objectContaining({
          id: 'evt-user-command',
          agentRoom: expect.objectContaining({
            source: 'user',
            roomId: 'room-1',
            hostSessionId: 'host-session',
            memberKey: 'dev',
            runKey: 'run-dev',
            commandId: 'cmd-user'
          })
        })
      }),
      expect.objectContaining({
        type: 'message',
        message: expect.objectContaining({
          id: 'evt-agent-command',
          agentRoom: expect.objectContaining({
            source: 'std/dev-reviewer',
            sourceLabel: 'std/dev-reviewer',
            roomId: 'room-1',
            hostSessionId: 'host-session',
            memberKey: 'dev',
            runKey: 'run-dev',
            commandId: 'cmd-2'
          })
        })
      })
    ])
  })

  it('updates session status from status_changed events', () => {
    project({
      id: 'evt-status',
      seq: 1,
      sessionId: 'sess-dev',
      type: 'status_changed',
      status: 'completed'
    })

    expect(db.getSession('sess-dev')).toEqual(expect.objectContaining({
      status: 'completed'
    }))
    expect(db.getAgentRoomDetail('room-1')?.runs[0]).toEqual(expect.objectContaining({
      status: 'completed'
    }))
  })

  it('does not regress completed sessions to running when old start and message events replay', () => {
    project({
      id: 'evt-completed',
      seq: 10,
      sessionId: 'sess-dev',
      type: 'status_changed',
      status: 'completed'
    })

    project({
      id: 'evt-started-old',
      seq: 1,
      sessionId: 'sess-dev',
      type: 'session_started',
      status: 'running'
    })
    project({
      id: 'evt-message-old',
      seq: 2,
      sessionId: 'sess-dev',
      type: 'message',
      role: 'assistant',
      content: 'already replayed message'
    })

    expect(db.getSession('sess-dev')).toEqual(expect.objectContaining({
      lastMessage: 'already replayed message',
      status: 'completed'
    }))
  })

  it('does not add process status updates to the agent room timeline', () => {
    project({
      id: 'evt-running',
      seq: 1,
      sessionId: 'sess-dev',
      type: 'status_changed',
      status: 'running',
      publicSummary: 'Developer is still working.'
    })

    expect(db.getSession('sess-dev')).toEqual(expect.objectContaining({
      status: 'running'
    }))
    expect(db.getAgentRoomDetail('room-1')?.runs[0]).toEqual(expect.objectContaining({
      status: 'running'
    }))
    expect(db.getAgentRoomDetail('room-1')?.messages).toEqual([])
  })

  it('updates final status from lifecycle events without explicit status fields', () => {
    project({
      id: 'evt-start',
      seq: 1,
      sessionId: 'sess-dev',
      type: 'session_started',
      status: 'starting',
      publicSummary: 'Developer started.'
    })
    project({
      id: 'evt-completed',
      seq: 2,
      sessionId: 'sess-dev',
      type: 'session_completed',
      publicSummary: 'Developer completed.'
    })

    expect(db.getSession('sess-dev')).toEqual(expect.objectContaining({
      status: 'completed'
    }))
    expect(db.getAgentRoomDetail('room-1')?.runs[0]).toEqual(expect.objectContaining({
      status: 'completed'
    }))
    expect(db.getAgentRoomDetail('room-1')?.messages).toEqual([
      expect.objectContaining({
        content: 'Developer joined the room',
        eventType: 'member_joined'
      }),
      expect.objectContaining({
        content: 'Developer started.',
        eventType: 'assignment_sent'
      }),
      expect.objectContaining({
        content: 'Developer completed.',
        eventType: 'run_completed'
      })
    ])
  })

  it('deduplicates repeated completed summaries for the same child turn', () => {
    project({
      id: 'evt-child-final',
      seq: 1,
      ts: 100,
      sessionId: 'sess-dev',
      type: 'session_completed',
      publicSummary: 'Natural language child reply.'
    })
    project({
      id: 'runtime-state:sess-dev:1:completed',
      seq: 2,
      ts: 100,
      sessionId: 'sess-dev',
      type: 'status_changed',
      status: 'completed',
      summary: 'Natural language child reply.',
      visibility: 'room'
    })

    const completedMessages = createAgentRoomService(db).getDetail('room-1')?.messages.filter(message =>
      message.eventType === 'run_completed'
    )
    expect(completedMessages).toEqual([
      expect.objectContaining({
        id: 'runtime:sess-dev:evt-child-final',
        content: 'Natural language child reply.',
        memberKey: 'dev',
        runKey: 'run-dev'
      })
    ])
  })

  it('routes child approval requests to the host and projects room attention state', async () => {
    db.createSession('Leader task', 'host-session', 'running')

    project({
      id: 'evt-approval',
      seq: 1,
      sessionId: 'sess-dev',
      type: 'approval_requested',
      requestId: 'approval-1',
      kind: 'permission',
      question: 'Allow file edit?',
      publicSummary: 'Developer needs edit approval.',
      options: [{ label: 'Allow once', value: 'allow_once' }]
    }, {
      hostSessionId: 'host-session'
    })

    expect(db.getSession('sess-dev')).toEqual(expect.objectContaining({
      status: 'waiting_input',
      lastMessage: 'Allow file edit?'
    }))
    expect(db.getMessages('sess-dev')).toEqual([
      expect.objectContaining({
        type: 'interaction_request',
        id: 'approval-1',
        payload: expect.objectContaining({
          question: 'Allow file edit?'
        })
      })
    ])
    expect(processLeaderMessage).toHaveBeenCalledTimes(1)
    expect(processLeaderMessage).toHaveBeenCalledWith(
      'host-session',
      expect.stringContaining(
        'childSessionId: sess-dev'
      )
    )
    const hostMessage = processLeaderMessage.mock.calls[0]?.[1] as string
    expect(hostMessage).toEqual(expect.stringContaining('interactionId: approval-1'))
    expect(hostMessage).toEqual(expect.stringContaining('- Allow once (allow_once)'))
    expect(hostMessage).toEqual(expect.stringContaining('session.submit'))
    expect(hostMessage).toEqual(expect.stringContaining('"data":"<option-value>"'))
    expect(hostMessage).toEqual(
      expect.stringContaining('Do not ask the user merely to relay an obvious child approval choice.')
    )
    expect(db.getMessages('host-session')).toEqual([])

    await flushDelivery()

    expect(getHostDeliveryMarker('host-session')).toEqual(expect.objectContaining({
      childSessionId: 'sess-dev',
      deliveryKey: 'runtime-host-request:sess-dev:approval-1:evt-approval',
      interactionId: 'approval-1',
      requestKind: 'confirmation',
      runKey: 'run-dev',
      runtimeEventId: 'evt-approval',
      runtimeEventSeq: 1
    }))

    const detail = db.getAgentRoomDetail('room-1')
    expect(detail?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        content: 'Developer needs edit approval.',
        eventType: 'attention_requested',
        memberKey: 'dev',
        runKey: 'run-dev',
        payload: expect.objectContaining({
          interactionId: 'approval-1',
          options: [{ label: 'Allow once', value: 'allow_once' }],
          requestKind: 'confirmation',
          type: 'attention_requested'
        })
      })
    ]))
    expect(detail?.runs[0]).toEqual(expect.objectContaining({
      interactionId: 'approval-1',
      options: [{ label: 'Allow once', value: 'allow_once' }],
      requestKind: 'confirmation',
      status: 'waiting',
      latestSummary: 'Developer needs edit approval.'
    }))

    project({
      id: 'evt-approval',
      seq: 1,
      sessionId: 'sess-dev',
      type: 'approval_requested',
      requestId: 'approval-1',
      kind: 'permission',
      question: 'Allow file edit?',
      publicSummary: 'Developer needs edit approval.',
      options: [{ label: 'Allow once', value: 'allow_once' }]
    }, {
      hostSessionId: 'host-session'
    })

    expect(processLeaderMessage).toHaveBeenCalledTimes(1)
  })

  it('preserves permission context when projecting child approval requests to session history', () => {
    project({
      id: 'evt-approval-context',
      seq: 1,
      sessionId: 'sess-dev',
      type: 'approval_requested',
      requestId: 'approval-context',
      kind: 'permission',
      question: 'Allow running Bash?',
      options: [
        { label: 'Allow once', value: 'allow_once' },
        { label: 'Allow session', value: 'allow_session' },
        { label: 'Deny once', value: 'deny_once' }
      ],
      permissionContext: {
        adapter: 'codex',
        subjectKey: 'Bash',
        subjectLabel: 'Bash',
        deniedTools: ['Bash'],
        scope: 'tool',
        projectConfigPath: '.oo.config.json'
      }
    })

    expect(db.getMessages('sess-dev')).toEqual([
      expect.objectContaining({
        type: 'interaction_request',
        id: 'approval-context',
        payload: expect.objectContaining({
          kind: 'permission',
          question: 'Allow running Bash?',
          permissionContext: expect.objectContaining({
            adapter: 'codex',
            deniedTools: ['Bash'],
            projectConfigPath: '.oo.config.json',
            scope: 'tool',
            subjectKey: 'Bash',
            subjectLabel: 'Bash'
          })
        })
      })
    ])
  })

  it('delivers repeated child approval request ids as distinct host requests', async () => {
    db.createSession('Leader task', 'host-session', 'running')

    project({
      id: 'evt-first-approval',
      seq: 1,
      ts: 100,
      sessionId: 'sess-dev',
      type: 'approval_requested',
      requestId: 'codex-approval:0',
      kind: 'permission',
      question: 'Allow first command?'
    }, {
      hostSessionId: 'host-session'
    })

    await flushDelivery()

    project({
      id: 'evt-second-approval',
      seq: 2,
      ts: 200,
      sessionId: 'sess-dev',
      type: 'approval_requested',
      requestId: 'codex-approval:0',
      kind: 'permission',
      question: 'Allow second command?'
    }, {
      hostSessionId: 'host-session'
    })

    expect(processLeaderMessage).toHaveBeenCalledTimes(2)
    expect(processLeaderMessage.mock.calls[1]?.[1]).toEqual(expect.stringContaining('Allow second command?'))

    await flushDelivery()

    const markers = (db.getMessages('host-session') as WSEvent[])
      .filter(isRuntimeHostRequestDeliveryEvent)
      .map(event => event.data?.deliveryKey)
    expect(markers).toEqual([
      'runtime-host-request:sess-dev:codex-approval:0:evt-first-approval',
      'runtime-host-request:sess-dev:codex-approval:0:evt-second-approval'
    ])

    project({
      id: 'evt-second-approval',
      seq: 2,
      ts: 200,
      sessionId: 'sess-dev',
      type: 'approval_requested',
      requestId: 'codex-approval:0',
      kind: 'permission',
      question: 'Allow second command?'
    }, {
      hostSessionId: 'host-session'
    })

    expect(processLeaderMessage).toHaveBeenCalledTimes(2)
  })

  it('keeps legacy delivery markers from blocking newer reused request ids', async () => {
    db.createSession('Leader task', 'host-session', 'running')
    db.saveMessage('host-session', {
      type: 'adapter_event',
      data: {
        source: 'runtime_host_request_delivery',
        deliveryKey: 'runtime-host-request:sess-dev:codex-approval:0',
        createdAt: 100
      }
    })

    project({
      id: 'evt-old-approval',
      seq: 1,
      ts: 100,
      sessionId: 'sess-dev',
      type: 'approval_requested',
      requestId: 'codex-approval:0',
      kind: 'permission',
      question: 'Allow old command?'
    }, {
      hostSessionId: 'host-session'
    })
    project({
      id: 'evt-new-approval',
      seq: 2,
      ts: 200,
      sessionId: 'sess-dev',
      type: 'approval_requested',
      requestId: 'codex-approval:0',
      kind: 'permission',
      question: 'Allow new command?'
    }, {
      hostSessionId: 'host-session'
    })

    expect(processLeaderMessage).toHaveBeenCalledTimes(1)
    expect(processLeaderMessage.mock.calls[0]?.[1]).toEqual(expect.stringContaining('Allow new command?'))

    await flushDelivery()

    expect(
      (db.getMessages('host-session') as WSEvent[])
        .filter(isRuntimeHostRequestDeliveryEvent)
        .map(event => event.data?.deliveryKey)
    ).toEqual([
      'runtime-host-request:sess-dev:codex-approval:0',
      'runtime-host-request:sess-dev:codex-approval:0:evt-new-approval'
    ])
  })

  it('keeps child approval runs waiting when terminal status repeats the approval prompt', async () => {
    db.createSession('Leader task', 'host-session', 'running')

    project({
      id: 'evt-approval',
      seq: 1,
      sessionId: 'sess-dev',
      type: 'approval_requested',
      requestId: 'approval-1',
      kind: 'permission',
      question: 'Allow file edit?',
      publicSummary: 'Developer needs edit approval.'
    }, {
      hostSessionId: 'host-session'
    })
    project({
      id: 'evt-completed',
      seq: 2,
      sessionId: 'sess-dev',
      type: 'session_completed'
    }, {
      hostSessionId: 'host-session'
    })
    project({
      id: 'evt-state-completed',
      seq: 3,
      sessionId: 'sess-dev',
      type: 'status_changed',
      status: 'completed',
      summary: 'Developer needs edit approval.',
      visibility: 'room'
    }, {
      hostSessionId: 'host-session'
    })

    expect(db.getAgentRoomRun('room-1', 'run-dev')).toEqual(expect.objectContaining({
      status: 'waiting',
      latestSummary: 'Developer needs edit approval.'
    }))
    expect(db.getSession('sess-dev')).toEqual(expect.objectContaining({
      status: 'waiting_input',
      lastMessage: 'Allow file edit?'
    }))
    expect(
      createAgentRoomService(db).getDetail('room-1')?.messages.some(message => message.eventType === 'run_completed')
    ).toBe(false)

    await flushDelivery()
  })

  it('keeps approval sessions waiting when runtime emits follow-up running state', () => {
    project({
      id: 'evt-approval',
      seq: 1,
      sessionId: 'sess-dev',
      type: 'approval_requested',
      requestId: 'approval-1',
      kind: 'permission',
      question: 'Allow shell command?'
    })

    project({
      id: 'evt-running',
      seq: 2,
      sessionId: 'sess-dev',
      type: 'status_changed',
      status: 'running'
    })
    project({
      id: 'evt-tool-pending',
      seq: 3,
      sessionId: 'sess-dev',
      type: 'message',
      role: 'assistant',
      content: 'Bash command pending approval'
    })

    expect(db.getSession('sess-dev')).toEqual(expect.objectContaining({
      status: 'waiting_input',
      lastMessage: 'Bash command pending approval'
    }))
  })

  it('retries host delivery after a failed child approval delivery', async () => {
    db.createSession('Leader task', 'host-session', 'running')
    processLeaderMessage
      .mockRejectedValueOnce(new Error('leader unavailable'))
      .mockResolvedValueOnce(undefined)

    const event: RuntimeEvent = {
      id: 'evt-retry-approval',
      seq: 1,
      sessionId: 'sess-dev',
      type: 'approval_requested',
      requestId: 'approval-retry',
      kind: 'permission',
      question: 'Allow retry command?'
    }

    project(event, { hostSessionId: 'host-session' })

    expect(processLeaderMessage).toHaveBeenCalledTimes(1)
    expect(db.getMessages('host-session')).toEqual([])

    await flushDelivery()

    expect(db.getMessages('host-session')).toEqual([])

    project(event, { hostSessionId: 'host-session' })

    expect(processLeaderMessage).toHaveBeenCalledTimes(2)

    await flushDelivery()

    expect(getHostDeliveryMarker('host-session')).toEqual(expect.objectContaining({
      deliveryKey: 'runtime-host-request:sess-dev:approval-retry:evt-retry-approval',
      interactionId: 'approval-retry'
    }))

    project(event, { hostSessionId: 'host-session' })

    expect(processLeaderMessage).toHaveBeenCalledTimes(2)
  })

  it('projects child permission requests without public summaries while routing them to the host', async () => {
    db.createSession('Leader task', 'host-session', 'running')

    project({
      id: 'evt-native-approval',
      seq: 1,
      sessionId: 'sess-dev',
      type: 'approval_requested',
      requestId: 'codex-approval:1',
      kind: 'permission',
      question: 'Allow running `pnpm test`?',
      options: [
        { label: 'Allow once', value: 'allow_once' },
        { label: 'Deny once', value: 'deny_once' }
      ]
    }, {
      hostSessionId: 'host-session'
    })

    const detail = db.getAgentRoomDetail('room-1')

    expect(db.getSession('sess-dev')).toEqual(expect.objectContaining({
      status: 'waiting_input',
      lastMessage: 'Allow running `pnpm test`?'
    }))
    expect(processLeaderMessage).toHaveBeenCalledTimes(1)
    const hostMessage = processLeaderMessage.mock.calls[0]?.[1] as string
    expect(hostMessage).toEqual(expect.stringContaining('Developer / Developer run is waiting for your handling.'))
    expect(hostMessage).toEqual(expect.stringContaining('Request: Allow running `pnpm test`?'))
    expect(hostMessage).toEqual(expect.stringContaining('runKey: run-dev'))
    expect(hostMessage).toEqual(expect.stringContaining('interactionId: codex-approval:1'))
    expect(hostMessage).toEqual(expect.stringContaining('- Deny once (deny_once)'))
    expect(detail?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        content: 'Allow running `pnpm test`?',
        eventType: 'attention_requested',
        memberKey: 'dev',
        runKey: 'run-dev',
        payload: expect.objectContaining({
          interactionId: 'codex-approval:1',
          requestKind: 'confirmation',
          type: 'attention_requested'
        })
      })
    ]))
    expect(detail?.runs[0]).toEqual(expect.objectContaining({
      interactionId: 'codex-approval:1',
      options: [
        { label: 'Allow once', value: 'allow_once' },
        { label: 'Deny once', value: 'deny_once' }
      ],
      requestKind: 'confirmation',
      status: 'waiting',
      latestSummary: 'Allow running `pnpm test`?'
    }))

    await flushDelivery()
  })

  it('projects child input requests as visible room attention state', async () => {
    db.createSession('Leader task', 'host-session', 'running')

    project({
      id: 'evt-input',
      seq: 1,
      sessionId: 'sess-dev',
      type: 'input_requested',
      requestId: 'input-1',
      question: 'Which branch should I use?',
      requestKind: 'input',
      publicSummary: 'Developer needs branch selection.'
    }, {
      hostSessionId: 'host-session'
    })

    expect(db.getSession('sess-dev')).toEqual(expect.objectContaining({
      status: 'waiting_input',
      lastMessage: 'Which branch should I use?'
    }))
    const detail = db.getAgentRoomDetail('room-1')
    expect(detail?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        content: 'Developer needs branch selection.',
        eventType: 'attention_requested',
        memberKey: 'dev',
        runKey: 'run-dev',
        payload: expect.objectContaining({
          interactionId: 'input-1',
          requestKind: 'input',
          type: 'attention_requested'
        })
      })
    ]))
    expect(detail?.runs[0]).toEqual(expect.objectContaining({
      interactionId: 'input-1',
      requestKind: 'input',
      status: 'waiting',
      latestSummary: 'Developer needs branch selection.'
    }))
    expect(processLeaderMessage).toHaveBeenCalledWith('host-session', expect.stringContaining('interactionId: input-1'))

    await flushDelivery()
  })

  it('stores command acknowledgements as audit adapter events and preserves compatible unknown fields', () => {
    project({
      id: 'evt-ack',
      seq: 1,
      sessionId: 'sess-dev',
      type: 'command_ack',
      commandId: 'cmd-1',
      futureField: {
        preserved: true
      }
    })

    expect(db.getMessages('sess-dev')).toEqual([
      expect.objectContaining({
        type: 'adapter_event',
        data: {
          runtimeEvent: expect.objectContaining({
            type: 'command_ack',
            commandId: 'cmd-1',
            futureField: {
              preserved: true
            }
          })
        }
      })
    ])
  })

  it('projects start commands as provisional user messages and deduplicates runtime echoes', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-runtime-store-'))
    const root = path.join(tempRoot, '.oneworks/runtime')
    const storePath = path.join(root, 'sessions/sess-command-projection')
    await mkdir(storePath, { recursive: true })
    await writeFile(
      path.join(root, 'index.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        sessions: {
          'sess-command-projection': {
            storePath: 'sessions/sess-command-projection',
            status: 'starting'
          }
        }
      })
    )
    await writeFile(
      path.join(storePath, 'meta.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        supportedProtocolRange: '^1.0.0',
        sessionId: 'sess-command-projection',
        title: 'Command projection',
        createdAt: Date.now()
      })
    )
    await writeFile(
      path.join(storePath, 'commands.jsonl'),
      `${
        JSON.stringify({
          id: 'cmd-start-1',
          ts: 100,
          sessionId: 'sess-command-projection',
          type: 'start',
          priority: 20,
          source: 'web',
          commandId: 'session-start-1',
          message: 'hello from command'
        })
      }\n`
    )
    await writeFile(
      path.join(storePath, 'events.jsonl'),
      `${
        JSON.stringify({
          id: 'evt-user-1',
          seq: 1,
          ts: 200,
          sessionId: 'sess-command-projection',
          type: 'message',
          role: 'user',
          source: 'web',
          commandId: 'session-start-1',
          causedByCommandId: 'cmd-start-1',
          content: 'hello from command'
        })
      }\n`
    )

    const store = (await discoverRuntimeSessionStores([root]))[0] as RuntimeSessionStore
    await replayRuntimeStore(store, { db, broadcast: false })

    expect(db.getMessages('sess-command-projection')).toEqual([
      expect.objectContaining({
        type: 'message',
        message: expect.objectContaining({
          id: 'session-start-1',
          role: 'user',
          content: 'hello from command',
          agentRoom: expect.objectContaining({
            source: 'user',
            commandId: 'session-start-1',
            causedByCommandId: 'cmd-start-1'
          })
        })
      })
    ])
    expect(db.getSession('sess-command-projection')).toEqual(expect.objectContaining({
      lastMessage: 'hello from command',
      lastUserMessage: 'hello from command',
      messageCount: 1,
      status: 'running'
    }))
  })

  it('does not replay stale terminal runtime state over a newer follow-up command', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-runtime-store-'))
    const root = path.join(tempRoot, '.oneworks/runtime')
    const storePath = path.join(root, 'sessions/sess-follow-up')
    await mkdir(storePath, { recursive: true })
    await writeFile(
      path.join(root, 'index.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        sessions: {
          'sess-follow-up': {
            storePath: 'sessions/sess-follow-up',
            status: 'completed'
          }
        }
      })
    )
    await writeFile(
      path.join(storePath, 'meta.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        supportedProtocolRange: '^1.0.0',
        sessionId: 'sess-follow-up',
        title: 'Follow-up command projection',
        createdAt: 100
      })
    )
    await writeFile(
      path.join(storePath, 'commands.jsonl'),
      [
        JSON.stringify({
          id: 'cmd-start-1',
          ts: 100,
          sessionId: 'sess-follow-up',
          type: 'start',
          priority: 20,
          source: 'web',
          commandId: 'session-start-1',
          message: 'first prompt'
        }),
        JSON.stringify({
          id: 'cmd-send-2',
          ts: 1_000,
          sessionId: 'sess-follow-up',
          type: 'send_message',
          priority: 20,
          source: 'web',
          commandId: 'session-message-2',
          message: 'second prompt'
        }),
        ''
      ].join('\n')
    )
    await writeFile(
      path.join(storePath, 'state.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        sessionId: 'sess-follow-up',
        status: 'completed',
        title: 'Follow-up command projection',
        lastSeq: 4,
        updatedAt: 500
      })
    )
    await writeFile(path.join(storePath, 'events.jsonl'), '')

    const store = (await discoverRuntimeSessionStores([root]))[0] as RuntimeSessionStore
    await replayRuntimeStore(store, { db, broadcast: false })

    expect(db.getSession('sess-follow-up')).toEqual(expect.objectContaining({
      lastMessage: 'second prompt',
      lastUserMessage: 'second prompt',
      messageCount: 2,
      status: 'running'
    }))
  })

  it('does not miss runtime metadata when meta appears after the first scan', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-runtime-store-'))
    const root = path.join(tempRoot, '.oneworks/runtime')
    const storePath = path.join(root, 'sessions/sess-late-meta')
    await mkdir(storePath, { recursive: true })
    await writeFile(
      path.join(root, 'index.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        sessions: {
          'sess-late-meta': {
            storePath: 'sessions/sess-late-meta',
            status: 'starting'
          }
        }
      })
    )

    const store = (await discoverRuntimeSessionStores([root]))[0] as RuntimeSessionStore
    const first = await replayRuntimeStore(store, { db, broadcast: false })
    expect(db.getSession('sess-late-meta')).toBeUndefined()

    await writeFile(
      path.join(storePath, 'meta.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        supportedProtocolRange: '^1.0.0',
        sessionId: 'sess-late-meta',
        title: 'Late metadata session',
        roomId: 'room-late-meta',
        roomTitle: 'Late metadata room',
        createdAt: Date.now()
      })
    )

    const second = await replayRuntimeStore(store, {
      db,
      broadcast: false,
      agentRoomProjectionEnabled: true,
      checkpoint: first.checkpoint
    })

    expect(second.projectedCount).toBe(0)
    expect(db.getSession('sess-late-meta')).toEqual(expect.objectContaining({
      title: 'Late metadata session'
    }))
    expect(db.getAgentRoom('room-late-meta')).toEqual(expect.objectContaining({
      title: 'Late metadata room'
    }))
  })

  it('replays stores from runtime roots added after watcher construction', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-runtime-store-'))
    const root = path.join(tempRoot, 'session-worktree/.oneworks/runtime')
    const storePath = path.join(root, 'sessions/sess-dynamic-root')
    await mkdir(storePath, { recursive: true })
    await writeFile(
      path.join(root, 'index.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        sessions: {
          'sess-dynamic-root': {
            storePath: 'sessions/sess-dynamic-root',
            status: 'starting'
          }
        }
      })
    )
    await writeFile(
      path.join(storePath, 'meta.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        supportedProtocolRange: '^1.0.0',
        sessionId: 'sess-dynamic-root',
        title: 'Dynamic root runtime',
        roomId: 'room-dynamic-root',
        roomTitle: 'Dynamic root room',
        memberKey: 'dev',
        memberLabel: 'Developer',
        runId: 'run-dev',
        runTitle: 'Developer run',
        createdAt: Date.now()
      })
    )

    const watcher = new RuntimeStoreWatcher({
      roots: [],
      db,
      broadcast: false,
      agentRoomProjectionEnabled: true,
      pollIntervalMs: 60_000
    })
    await watcher.addRoot(root)

    expect(db.getSession('sess-dynamic-root')).toEqual(expect.objectContaining({
      id: 'sess-dynamic-root',
      title: 'Dynamic root runtime'
    }))
    expect(db.getAgentRoom('room-dynamic-root')).toEqual(expect.objectContaining({
      title: 'Dynamic root room'
    }))
  })

  it('includes ready session workspace runtime roots when a watcher starts after server restart', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-runtime-store-'))
    const workspaceFolder = path.join(tempRoot, 'session-workspace')
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(tempRoot, 'home-projects')
    const root = resolveProjectHomePath(workspaceFolder, createWorkspaceRuntimeEnv(workspaceFolder), 'runtime')
    const storePath = path.join(root, 'sessions/sess-restored')
    await mkdir(storePath, { recursive: true })
    db.upsertSessionWorkspace({
      sessionId: 'host-session',
      kind: 'shared_workspace',
      workspaceFolder,
      cleanupPolicy: 'retain',
      state: 'ready'
    })
    await writeFile(
      path.join(root, 'index.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        sessions: {
          'sess-restored': {
            storePath: 'sessions/sess-restored',
            status: 'starting'
          }
        }
      })
    )
    await writeFile(
      path.join(storePath, 'meta.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        supportedProtocolRange: '^1.0.0',
        sessionId: 'sess-restored',
        title: 'Restored runtime',
        hostSessionId: 'host-session',
        memberKey: 'dev',
        memberLabel: 'Developer',
        runId: 'sess-restored',
        runTitle: 'Restored run',
        createdAt: Date.now()
      })
    )

    const watcher = new RuntimeStoreWatcher({
      cwd: path.join(tempRoot, 'other-cwd'),
      db,
      broadcast: false,
      agentRoomProjectionEnabled: true,
      pollIntervalMs: 60_000
    })
    await watcher.scanAndReplay()
    watcher.stop()

    expect(db.getSession('sess-restored')).toEqual(expect.objectContaining({
      id: 'sess-restored',
      title: 'Restored runtime'
    }))
    expect(db.getAgentRoomByHostSessionId('host-session')).toEqual(expect.objectContaining({
      hostSessionId: 'host-session'
    }))
  })

  it('discovers indexed session stores and replays by offset and last seq without duplicating messages', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-runtime-store-'))
    const root = path.join(tempRoot, '.oneworks/runtime')
    const storePath = path.join(root, 'sessions/sess-dev')
    await mkdir(storePath, { recursive: true })
    await writeFile(
      path.join(root, 'index.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        sessions: {
          'sess-dev': {
            storePath: 'sessions/sess-dev',
            status: 'running'
          }
        }
      })
    )
    await writeFile(
      path.join(storePath, 'meta.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        sessionId: 'sess-dev',
        title: 'Runtime session',
        roomId: 'room-1',
        roomTitle: 'Runtime room',
        memberKey: 'dev',
        memberLabel: 'Developer',
        runId: 'run-dev'
      })
    )
    await writeFile(
      path.join(storePath, 'events.jsonl'),
      [
        JSON.stringify({
          id: 'evt-1',
          seq: 1,
          sessionId: 'sess-dev',
          type: 'message',
          role: 'assistant',
          content: 'first'
        }),
        JSON.stringify({
          id: 'evt-2',
          seq: 2,
          sessionId: 'sess-dev',
          type: 'message',
          role: 'assistant',
          content: 'second'
        }),
        ''
      ].join('\n')
    )

    const stores = await discoverRuntimeSessionStores([root])
    expect(stores).toEqual([
      expect.objectContaining({
        sessionId: 'sess-dev',
        storePath
      })
    ])

    const store = stores[0] as RuntimeSessionStore
    const deliverSessionEvent = vi.fn(async () => true)
    const first = await replayRuntimeStore(store, { db, broadcast: false, deliverSessionEvent })
    expect(deliverSessionEvent).toHaveBeenCalledTimes(2)
    expect(deliverSessionEvent).toHaveBeenNthCalledWith(
      1,
      'sess-dev',
      expect.objectContaining({
        type: 'message',
        message: expect.objectContaining({
          id: 'evt-1',
          role: 'assistant',
          content: 'first'
        })
      })
    )
    expect(deliverSessionEvent).toHaveBeenNthCalledWith(
      2,
      'sess-dev',
      expect.objectContaining({
        type: 'message',
        message: expect.objectContaining({
          id: 'evt-2',
          role: 'assistant',
          content: 'second'
        })
      })
    )
    deliverSessionEvent.mockClear()

    const second = await replayRuntimeStore(store, {
      db,
      broadcast: false,
      checkpoint: first.checkpoint,
      deliverSessionEvent
    })
    expect(deliverSessionEvent).not.toHaveBeenCalled()

    const replayedWithoutCheckpoint = await replayRuntimeStore(store, {
      db,
      broadcast: false,
      deliverSessionEvent
    })
    expect(deliverSessionEvent).not.toHaveBeenCalled()

    expect(first).toEqual(expect.objectContaining({
      projectedCount: 2,
      checkpoint: expect.objectContaining({
        lastSeq: 2
      })
    }))
    expect(second.projectedCount).toBe(0)
    expect(replayedWithoutCheckpoint.projectedCount).toBe(2)
    expect(db.getMessages('sess-dev')).toHaveLength(2)
  })

  it('reconciles terminal runtime state after events were already checkpointed', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-runtime-store-'))
    const root = path.join(tempRoot, '.oneworks/runtime')
    const storePath = path.join(root, 'sessions/sess-state-completed')
    await mkdir(storePath, { recursive: true })
    await writeFile(
      path.join(root, 'index.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        sessions: {
          'sess-state-completed': {
            storePath: 'sessions/sess-state-completed',
            status: 'completed'
          }
        }
      })
    )
    await writeFile(
      path.join(storePath, 'meta.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        sessionId: 'sess-state-completed',
        title: 'Runtime session',
        roomId: 'room-state',
        roomTitle: 'Runtime room',
        memberKey: 'dev',
        memberLabel: 'Developer',
        runId: 'run-state'
      })
    )
    await writeFile(
      path.join(storePath, 'state.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        sessionId: 'sess-state-completed',
        status: 'completed',
        title: 'Runtime session',
        lastSeq: 5,
        lastMessage: 'Runtime finished.',
        updatedAt: 500
      })
    )
    await writeFile(
      path.join(storePath, 'events.jsonl'),
      [
        JSON.stringify({
          id: 'evt-1',
          seq: 1,
          sessionId: 'sess-state-completed',
          type: 'message',
          role: 'assistant',
          content: 'Runtime finished.'
        }),
        ''
      ].join('\n')
    )

    const store = (await discoverRuntimeSessionStores([root]))[0] as RuntimeSessionStore
    const first = await replayRuntimeStore(store, { db, broadcast: false, agentRoomProjectionEnabled: true })
    db.updateSession('sess-state-completed', { status: 'terminated' })
    await replayRuntimeStore(store, {
      db,
      broadcast: false,
      agentRoomProjectionEnabled: true,
      checkpoint: first.checkpoint
    })

    expect(db.getSession('sess-state-completed')).toEqual(expect.objectContaining({
      status: 'completed'
    }))
    expect(db.getAgentRoomDetail('room-state')?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: 'Runtime finished.',
          eventType: 'run_completed'
        })
      ])
    )
  })
})
