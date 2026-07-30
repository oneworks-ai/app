/* eslint-disable max-lines -- session service coverage is intentionally consolidated. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RuntimeCommand } from '@oneworks/runtime-protocol'
import {
  FileRuntimeSessionStore,
  acquireLockFile,
  buildProjectConfigRecoveryIdempotencyKey,
  isAuthenticProjectConfigRecovery,
  projectConfigRecoveryPayloadDigest
} from '@oneworks/runtime-store'

import { attachRuntimeCommandBridge } from '../../../cli/src/commands/run/runtime-command-bridge.js'
import { createRuntimeEventSink } from '../../../cli/src/commands/run/runtime-event-sink.js'
import { getDb } from '#~/db/index.js'
import { resolveSessionRuntimeStoreRoot } from '#~/services/runtime-store/session-control.js'
import { applySessionEvent } from '#~/services/session/events.js'
import {
  killSession,
  processUserMessage,
  requestSessionTermination,
  resolveExternalRuntimeProjectConfigFailure,
  retryExternalRuntimeSessionProjectConfig
} from '#~/services/session/index.js'
import { maybeNotifySession } from '#~/services/session/notification.js'
import {
  adapterSessionStore,
  createSessionConnectionState,
  externalSessionStore,
  notifySessionUpdated
} from '#~/services/session/runtime.js'
import { resolveSessionWorkspace } from '#~/services/session/workspace.js'

vi.mock('#~/db/index.js', () => ({
  getDb: vi.fn()
}))

vi.mock('#~/channels/index.js', () => ({
  handleChannelSessionEvent: vi.fn()
}))

vi.mock('#~/services/session/runtime.js', async () => {
  const actual = await vi.importActual<typeof import('#~/services/session/runtime.js')>(
    '#~/services/session/runtime.js'
  )
  return {
    ...actual,
    notifySessionUpdated: vi.fn()
  }
})

vi.mock('#~/services/session/notification.js', () => ({
  maybeNotifySession: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('#~/services/session/workspace.js', () => ({
  provisionSessionWorkspace: vi.fn(),
  resolveSessionWorkspace: vi.fn()
}))

vi.mock('#~/utils/logger.js', () => ({
  getSessionLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }))
}))

describe('session service', () => {
  const saveMessage = vi.fn()
  const getMessages = vi.fn()
  const getSessionRuntimeState = vi.fn()
  const updateSession = vi.fn()
  const updateSessionRuntimeState = vi.fn()
  let currentSession: any
  let previousProjectOoBaseDir: string | undefined
  let previousProjectHomeProjectsDir: string | undefined
  let tempRuntimeRoot: string | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    adapterSessionStore.clear()
    externalSessionStore.clear()
    previousProjectOoBaseDir = process.env.__ONEWORKS_PROJECT_BASE_DIR__
    previousProjectHomeProjectsDir = process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__
    tempRuntimeRoot = undefined

    currentSession = {
      id: 'sess-1',
      title: 'New Session',
      status: 'idle',
      createdAt: Date.now(),
      messageCount: 0
    }

    updateSession.mockImplementation((_id: string, updates: Record<string, unknown>) => {
      currentSession = { ...currentSession, ...updates }
    })
    getSessionRuntimeState.mockReturnValue({
      runtimeKind: 'interactive',
      historySeedPending: false
    })
    vi.mocked(resolveSessionWorkspace).mockResolvedValue({
      sessionId: 'sess-1',
      workspaceFolder: '/workspace/root'
    } as any)

    vi.mocked(getDb).mockReturnValue({
      saveMessage,
      getChannelSessionBySessionId: vi.fn(() => undefined),
      getMessages,
      listSessionQueuedMessages: vi.fn(() => []),
      getSession: vi.fn(() => currentSession),
      getSessionRuntimeState,
      updateSession,
      updateSessionRuntimeState
    } as any)
  })

  afterEach(async () => {
    if (previousProjectOoBaseDir == null) {
      delete process.env.__ONEWORKS_PROJECT_BASE_DIR__
    } else {
      process.env.__ONEWORKS_PROJECT_BASE_DIR__ = previousProjectOoBaseDir
    }
    if (previousProjectHomeProjectsDir == null) {
      delete process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__
    } else {
      process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = previousProjectHomeProjectsDir
    }

    if (tempRuntimeRoot != null) {
      await rm(tempRuntimeRoot, { force: true, recursive: true })
    }
  })

  it('processes user messages through the active adapter session cache', async () => {
    const socket = { readyState: 1, send: vi.fn() } as any
    const emit = vi.fn()
    const messageHistory = [
      {
        type: 'message',
        message: {
          id: 'assistant-1',
          role: 'assistant',
          content: 'previous',
          createdAt: 1
        }
      } as any
    ]
    getMessages.mockReturnValue(messageHistory)

    const runtime = createSessionConnectionState()
    runtime.sockets.add(socket)
    runtime.messages = messageHistory
    adapterSessionStore.set('sess-1', {
      ...runtime,
      session: {
        emit,
        kill: vi.fn()
      } as any
    })

    await processUserMessage('sess-1', 'hello world')

    expect(saveMessage).toHaveBeenCalledOnce()
    expect(saveMessage).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        type: 'message',
        message: expect.objectContaining({
          role: 'user',
          content: 'hello world'
        })
      })
    )
    expect(updateSession).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        title: 'hello world',
        lastMessage: 'hello world',
        lastUserMessage: 'hello world',
        status: 'running'
      })
    )
    expect(vi.mocked(notifySessionUpdated)).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        status: 'running',
        title: 'hello world'
      })
    )
    expect(vi.mocked(maybeNotifySession)).toHaveBeenCalledWith(
      'idle',
      'running',
      expect.objectContaining({ status: 'running' })
    )
    expect(socket.send).toHaveBeenCalledOnce()
    expect(String(vi.mocked(socket.send).mock.calls[0][0])).toContain('"type":"message"')
    expect(emit).toHaveBeenCalledWith({
      type: 'message',
      content: [{ type: 'text', text: 'hello world' }],
      parentUuid: 'assistant-1'
    })
  })

  it('drops arbitrary error details at the shared persistence and broadcast boundary', () => {
    const sentinel = 'SENTINEL_SESSION_EVENT_SECRET'
    const broadcast = vi.fn()

    applySessionEvent('sess-1', {
      type: 'error',
      data: {
        code: 'future_session_error',
        details: { privateToken: sentinel },
        fatal: true,
        message: 'Future session failure'
      },
      message: 'Future session failure'
    }, { broadcast })

    expect(JSON.stringify(saveMessage.mock.calls)).not.toContain(sentinel)
    expect(JSON.stringify(broadcast.mock.calls)).not.toContain(sentinel)
    expect(saveMessage).toHaveBeenCalledWith('sess-1', {
      type: 'error',
      data: {
        code: 'future_session_error',
        fatal: true,
        message: 'Future session failure'
      },
      message: 'Future session failure'
    })
  })

  it('kills active sessions and updates the persisted status', () => {
    const kill = vi.fn()

    adapterSessionStore.set('sess-1', {
      ...createSessionConnectionState(),
      session: {
        emit: vi.fn(),
        kill
      } as any
    })

    killSession('sess-1')

    expect(kill).toHaveBeenCalledOnce()
    expect(adapterSessionStore.has('sess-1')).toBe(false)
    expect(updateSession).toHaveBeenCalledWith('sess-1', { status: 'terminated' })
    expect(vi.mocked(notifySessionUpdated)).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        status: 'terminated'
      })
    )
  })

  it('clears parked external sessions without marking them terminated', () => {
    currentSession = {
      ...currentSession,
      status: 'running'
    }
    getSessionRuntimeState.mockReturnValue({
      runtimeKind: 'external',
      historySeedPending: false
    })
    externalSessionStore.set('sess-1', {
      ...createSessionConnectionState(),
      interactions: [{
        id: 'interaction-1',
        payload: {
          sessionId: 'sess-1',
          question: '是否继续？'
        }
      }]
    })

    killSession('sess-1')

    expect(externalSessionStore.has('sess-1')).toBe(false)
    expect(updateSession).not.toHaveBeenCalled()
    expect(vi.mocked(notifySessionUpdated)).not.toHaveBeenCalled()
    expect(currentSession.status).toBe('running')
  })

  it('does not mark external runtime sessions as terminated', () => {
    currentSession = {
      ...currentSession,
      status: 'completed'
    }
    getSessionRuntimeState.mockReturnValue({
      runtimeKind: 'external',
      historySeedPending: false
    })
    externalSessionStore.set('sess-1', createSessionConnectionState())

    killSession('sess-1')

    expect(externalSessionStore.has('sess-1')).toBe(false)
    expect(updateSession).not.toHaveBeenCalled()
    expect(vi.mocked(notifySessionUpdated)).not.toHaveBeenCalled()
    expect(currentSession.status).toBe('completed')
  })

  it('queues stop commands into external runtime sessions', async () => {
    const runtimeAiBaseDir = await mkdtemp(path.join(os.tmpdir(), 'ow-session-runtime-stop-'))
    tempRuntimeRoot = runtimeAiBaseDir
    const runtimeRoot = path.join(runtimeAiBaseDir, 'runtime')
    process.env.__ONEWORKS_PROJECT_BASE_DIR__ = runtimeAiBaseDir
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(runtimeAiBaseDir, 'home-projects')
    await mkdir(path.join(runtimeRoot, 'sessions', 'sess-1'), { recursive: true })
    currentSession = {
      ...currentSession,
      status: 'running'
    }
    getSessionRuntimeState.mockReturnValue({
      runtimeKind: 'external',
      historySeedPending: false
    })

    const result = await requestSessionTermination('sess-1')
    const migratedRuntimeRoot = resolveSessionRuntimeStoreRoot('/workspace/root')
    const command = JSON.parse(
      await readFile(path.join(migratedRuntimeRoot, 'sessions', 'sess-1', 'commands.jsonl'), 'utf8')
    ) as {
      mode?: string
      sessionId?: string
      type?: string
    }

    expect(result).toMatchObject({
      accepted: true,
      delivery: 'runtime_store'
    })
    expect(command).toMatchObject({
      mode: 'kill',
      sessionId: 'sess-1',
      type: 'stop'
    })
    expect(updateSession).toHaveBeenCalledWith('sess-1', { status: 'terminated' })
  })

  it('queues user messages into external runtime sessions', async () => {
    const runtimeAiBaseDir = await mkdtemp(path.join(os.tmpdir(), 'ow-session-runtime-'))
    tempRuntimeRoot = runtimeAiBaseDir
    const runtimeRoot = path.join(runtimeAiBaseDir, 'runtime')
    process.env.__ONEWORKS_PROJECT_BASE_DIR__ = runtimeAiBaseDir
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(runtimeAiBaseDir, 'home-projects')
    await mkdir(path.join(runtimeRoot, 'sessions', 'sess-1'), { recursive: true })
    getSessionRuntimeState.mockReturnValue({
      runtimeKind: 'external',
      historySeedPending: false
    })

    await processUserMessage('sess-1', 'wake up')

    const migratedRuntimeRoot = resolveSessionRuntimeStoreRoot('/workspace/root')
    const command = JSON.parse(
      await readFile(path.join(migratedRuntimeRoot, 'sessions', 'sess-1', 'commands.jsonl'), 'utf8')
    ) as {
      commandId?: string
      content?: string
      id?: string
      message?: string
      sessionId?: string
      source?: string
      ts?: number
      type?: string
    }

    expect(command).toEqual(expect.objectContaining({
      content: 'wake up',
      message: 'wake up',
      sessionId: 'sess-1',
      source: 'user',
      type: 'send_message'
    }))
    expect(saveMessage).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        type: 'message',
        message: expect.objectContaining({
          id: command.commandId,
          role: 'user',
          content: 'wake up',
          agentRoom: expect.objectContaining({
            source: 'user',
            commandId: command.commandId,
            causedByCommandId: command.id
          }),
          createdAt: command.ts
        })
      })
    )
    expect(updateSession).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        lastMessage: 'wake up',
        lastUserMessage: 'wake up',
        status: 'running'
      })
    )
    expect(getMessages).not.toHaveBeenCalled()
    expect(adapterSessionStore.has('sess-1')).toBe(false)
  })

  it('queues external runtime messages with the latest permission mode', async () => {
    const runtimeAiBaseDir = await mkdtemp(path.join(os.tmpdir(), 'ow-session-runtime-permission-'))
    tempRuntimeRoot = runtimeAiBaseDir
    const runtimeRoot = path.join(runtimeAiBaseDir, 'runtime')
    process.env.__ONEWORKS_PROJECT_BASE_DIR__ = runtimeAiBaseDir
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(runtimeAiBaseDir, 'home-projects')
    await mkdir(path.join(runtimeRoot, 'sessions', 'sess-1'), { recursive: true })
    currentSession = {
      ...currentSession,
      permissionMode: 'bypassPermissions'
    }
    getSessionRuntimeState.mockReturnValue({
      runtimeKind: 'external',
      historySeedPending: false
    })

    await processUserMessage('sess-1', 'wake up')

    const migratedRuntimeRoot = resolveSessionRuntimeStoreRoot('/workspace/root')
    const command = JSON.parse(
      await readFile(path.join(migratedRuntimeRoot, 'sessions', 'sess-1', 'commands.jsonl'), 'utf8')
    ) as Record<string, unknown>

    expect(command).toEqual(expect.objectContaining({
      sessionId: 'sess-1',
      type: 'send_message',
      content: 'wake up',
      permissionMode: 'bypassPermissions'
    }))
  })

  it('reuses a grant-only crash and stores the locked final adapter exactly once', async () => {
    const runtimeAiBaseDir = await mkdtemp(path.join(os.tmpdir(), 'ow-session-runtime-project-config-'))
    tempRuntimeRoot = runtimeAiBaseDir
    const runtimeRoot = path.join(runtimeAiBaseDir, 'runtime')
    process.env.__ONEWORKS_PROJECT_BASE_DIR__ = runtimeAiBaseDir
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(runtimeAiBaseDir, 'home-projects')
    const sessionStore = path.join(runtimeRoot, 'sessions', 'sess-1')
    await mkdir(sessionStore, { recursive: true })
    await writeFile(path.join(sessionStore, 'commands.jsonl'), `${JSON.stringify({
      protocolVersion: '1.0.0',
      id: 'cmd-start-attempt',
      ts: 90,
      sessionId: 'sess-1',
      type: 'start',
      priority: 20,
      source: 'test',
      content: 'visible recovery prompt',
      message: 'visible recovery prompt',
      contentItems: [
        { type: 'file', path: '/workspace/root/context.md' }
      ],
      runtimeContentItems: [
        { type: 'text', text: 'exact runtime recovery prompt' },
        { type: 'file', path: '/workspace/root/context.md' }
      ]
    })}\n`, 'utf8')
    const recoveryIdempotencyKey = buildProjectConfigRecoveryIdempotencyKey(
      'sess-1',
      'cmd-start-attempt',
      'evt-current-project-config-failure',
      7
    )
    const crashedRecoveryCommand: RuntimeCommand = {
      protocolVersion: '1.0.0',
      id: 'cmd-recovery-after-grant-crash',
      ts: 101,
      sessionId: 'sess-1',
      type: 'resume',
      priority: 20,
      source: 'project_config_recovery',
      adapter: 'custom-codex',
      content: 'visible recovery prompt',
      message: 'visible recovery prompt',
      contentItems: [{ type: 'file', path: '/workspace/root/context.md' }],
      runtimeContentItems: [
        { type: 'text', text: 'exact runtime recovery prompt' },
        { type: 'file', path: '/workspace/root/context.md' }
      ],
      messageDelivery: 'bridge',
      projectConfigPolicy: 'global-only',
      recovery: {
        kind: 'codex-project-config',
        attemptCommandId: 'cmd-start-attempt',
        replacedActivationCommandId: 'cmd-start-attempt',
        failureEventId: 'evt-current-project-config-failure',
        failureEventSeq: 7,
        grantEventId: 'evt-recovery-grant',
        grantEventSeq: 8,
        grantAuthorizationId: '11111111-1111-4111-8111-111111111111',
        grantCommandIndex: 1,
        idempotencyKey: recoveryIdempotencyKey
      }
    }
    const failureEvent = {
      protocolVersion: '1.0.0',
      id: 'evt-current-project-config-failure',
      seq: 7,
      ts: 100,
      sessionId: 'sess-1',
      type: 'session_failed',
      causedByCommandId: 'cmd-start-attempt',
      fatal: true,
      code: 'codex_project_config_invalid',
      details: {
        adapter: 'custom-codex',
        runtimeAdapter: 'codex',
        configSource: 'project',
        configPath: '.codex/config.toml',
        workspaceSource: 'active-session-workspace',
        workspaceFolder: '/workspace/root',
        sessionId: 'sess-1',
        reason: 'wire_api is unsupported',
        line: 2,
        column: 1
      }
    }
    const grantOnlyCrashEvent = {
      protocolVersion: '1.0.0',
      id: 'evt-recovery-grant',
      seq: 8,
      ts: 101,
      sessionId: 'sess-1',
      type: 'project_config_recovery_granted',
      source: 'server:project-config-recovery',
      recoveryGrant: {
        schemaVersion: 1,
        type: 'project_config_recovery_grant',
        authorizationId: '11111111-1111-4111-8111-111111111111',
        commandIndex: 1,
        recoveryCommandId: crashedRecoveryCommand.id,
        idempotencyKey: recoveryIdempotencyKey,
        sessionId: 'sess-1',
        attemptCommandId: 'cmd-start-attempt',
        failureEventId: 'evt-current-project-config-failure',
        failureEventSeq: 7,
        payloadDigest: projectConfigRecoveryPayloadDigest(crashedRecoveryCommand)!,
        workspaceFolder: '/workspace/root',
        adapter: 'custom-codex',
        runtimeAdapter: 'codex'
      }
    }
    await writeFile(
      path.join(sessionStore, 'events.jsonl'),
      `${JSON.stringify(failureEvent)}\n${JSON.stringify(grantOnlyCrashEvent)}\n`,
      'utf8'
    )
    currentSession = {
      ...currentSession,
      adapter: 'custom-codex',
      status: 'failed'
    }

    const results = await Promise.all([
      retryExternalRuntimeSessionProjectConfig('sess-1'),
      retryExternalRuntimeSessionProjectConfig('sess-1')
    ])
    const migratedRuntimeRoot = resolveSessionRuntimeStoreRoot('/workspace/root')
    const commands = (await readFile(
      path.join(migratedRuntimeRoot, 'sessions', 'sess-1', 'commands.jsonl'),
      'utf8'
    ))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as Record<string, unknown>)

    expect(results.filter(result => result.queued)).toHaveLength(1)
    expect(results.filter(result => 'reason' in result && result.reason === 'already_queued')).toHaveLength(1)
    expect(results.find(result => result.queued)?.commandId).toBe('cmd-recovery-after-grant-crash')
    expect(commands).toEqual([
      expect.objectContaining({
        id: 'cmd-start-attempt',
        type: 'start'
      }),
      expect.objectContaining({
        content: 'visible recovery prompt',
        adapter: 'custom-codex',
        contentItems: [
          { type: 'file', path: '/workspace/root/context.md' }
        ],
        message: 'visible recovery prompt',
        messageDelivery: 'bridge',
        projectConfigPolicy: 'global-only',
        recovery: {
          kind: 'codex-project-config',
          attemptCommandId: 'cmd-start-attempt',
          replacedActivationCommandId: 'cmd-start-attempt',
          failureEventId: 'evt-current-project-config-failure',
          failureEventSeq: 7,
          grantEventId: 'evt-recovery-grant',
          grantEventSeq: 8,
          grantAuthorizationId: '11111111-1111-4111-8111-111111111111',
          grantCommandIndex: 1,
          idempotencyKey: expect.any(String)
        },
        sessionId: 'sess-1',
        source: 'project_config_recovery',
        type: 'resume',
        runtimeContentItems: [
          { type: 'text', text: 'exact runtime recovery prompt' },
          { type: 'file', path: '/workspace/root/context.md' }
        ]
      })
    ])
    const runtimeSession = new FileRuntimeSessionStore(
      path.join(migratedRuntimeRoot, 'sessions', 'sess-1'),
      'sess-1'
    )
    const recoveryGrants = (await runtimeSession.replayEvents()).filter(
      event => event.type === 'project_config_recovery_granted'
    )
    expect(recoveryGrants).toEqual([
      expect.objectContaining({
        protocolVersion: '1.0.0',
        sessionId: 'sess-1',
        source: 'server:project-config-recovery',
        recoveryGrant: expect.objectContaining({
          schemaVersion: 1,
          type: 'project_config_recovery_grant',
          authorizationId: '11111111-1111-4111-8111-111111111111',
          commandIndex: 1,
          sessionId: 'sess-1',
          attemptCommandId: 'cmd-start-attempt',
          failureEventId: 'evt-current-project-config-failure',
          failureEventSeq: 7,
          workspaceFolder: '/workspace/root',
          adapter: 'custom-codex',
          runtimeAdapter: 'codex'
        })
      })
    ])
    const [storedCommands, storedEvents] = await Promise.all([
      runtimeSession.readCommands(),
      runtimeSession.replayEvents()
    ])
    expect(isAuthenticProjectConfigRecovery(
      storedCommands.at(-1)!,
      storedCommands,
      storedEvents,
      {
        adapter: 'custom-codex',
        runtimeAdapter: 'codex',
        sessionId: 'sess-1',
        workspaceFolder: '/workspace/root'
      }
    )).toBe(true)

    const emitted: unknown[] = []
    const sink = await createRuntimeEventSink({
      cwd: '/workspace/root',
      env: process.env,
      sessionId: 'sess-1'
    })
    const stopBridge = await attachRuntimeCommandBridge({
      adapter: 'custom-codex',
      cwd: '/workspace/root',
      env: process.env,
      runtimeAdapter: 'codex',
      session: { emit: event => emitted.push(event) },
      sessionId: 'sess-1',
      sink
    })
    await stopBridge()
    await sink.flush()
    expect(emitted).toEqual([{
      type: 'message',
      deliveryId: 'runtime-delivery:cmd-recovery-after-grant-crash',
      content: [
        { type: 'text', text: 'exact runtime recovery prompt' },
        { type: 'file', path: '/workspace/root/context.md' }
      ]
    }])
  })

  it('rejects recovery when a later unrelated failure supersedes the project config failure', async () => {
    const runtimeAiBaseDir = await mkdtemp(path.join(os.tmpdir(), 'ow-session-runtime-stale-project-config-'))
    tempRuntimeRoot = runtimeAiBaseDir
    const runtimeRoot = path.join(runtimeAiBaseDir, 'runtime')
    process.env.__ONEWORKS_PROJECT_BASE_DIR__ = runtimeAiBaseDir
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(runtimeAiBaseDir, 'home-projects')
    const sessionStore = path.join(runtimeRoot, 'sessions', 'sess-1')
    await mkdir(sessionStore, { recursive: true })
    await writeFile(path.join(sessionStore, 'events.jsonl'), [
      {
        protocolVersion: '1.0.0',
        id: 'evt-old-project-config-failure',
        seq: 7,
        ts: 100,
        sessionId: 'sess-1',
        type: 'session_failed',
        fatal: true,
        code: 'codex_project_config_invalid',
        details: {
          adapter: 'codex',
          runtimeAdapter: 'codex',
          configSource: 'project',
          configPath: '.codex/config.toml',
          workspaceSource: 'active-session-workspace',
          workspaceFolder: '/workspace/root',
          sessionId: 'sess-1',
          reason: 'wire_api is unsupported'
        }
      },
      {
        protocolVersion: '1.0.0',
        id: 'evt-later-unrelated-failure',
        seq: 9,
        ts: 200,
        sessionId: 'sess-1',
        type: 'session_failed',
        fatal: true,
        code: 'adapter_runtime_failed'
      }
    ].map(event => JSON.stringify(event)).join('\n') + '\n', 'utf8')
    currentSession = {
      ...currentSession,
      adapter: 'codex',
      status: 'failed'
    }

    await expect(retryExternalRuntimeSessionProjectConfig('sess-1')).resolves.toEqual({
      queued: false,
      reason: 'current_failure_ineligible'
    })
  })

  it.each([
    { commandId: 'cmd-ordinary-resume', source: 'user', type: 'resume' as const },
    { commandId: 'cmd-agent-room-message', source: 'agent-room', type: 'send_message' as const }
  ])(
    'rejects an obsolete failure after $type append but before DB projection',
    async ({ commandId, source, type }) => {
      const runtimeAiBaseDir = await mkdtemp(path.join(os.tmpdir(), 'ow-session-runtime-attempt-race-'))
      tempRuntimeRoot = runtimeAiBaseDir
      const runtimeRoot = path.join(runtimeAiBaseDir, 'runtime')
      process.env.__ONEWORKS_PROJECT_BASE_DIR__ = runtimeAiBaseDir
      process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(runtimeAiBaseDir, 'home-projects')
      const sourceSessionStore = path.join(runtimeRoot, 'sessions', 'sess-1')
      await mkdir(sourceSessionStore, { recursive: true })
      await writeFile(path.join(sourceSessionStore, 'commands.jsonl'), `${JSON.stringify({
        protocolVersion: '1.0.0',
        id: 'cmd-start-attempt',
        ts: 90,
        sessionId: 'sess-1',
        type: 'start',
        priority: 20,
        source: 'test',
        content: 'failed prompt',
        message: 'failed prompt'
      })}\n`, 'utf8')
      await writeFile(path.join(sourceSessionStore, 'events.jsonl'), `${JSON.stringify({
        protocolVersion: '1.0.0',
        id: 'evt-project-config-failure',
        seq: 7,
        ts: 100,
        sessionId: 'sess-1',
        type: 'session_failed',
        causedByCommandId: 'cmd-start-attempt',
        fatal: true,
        code: 'codex_project_config_invalid',
        details: {
          adapter: 'codex',
          runtimeAdapter: 'codex',
          configSource: 'project',
          configPath: '.codex/config.toml',
          workspaceSource: 'active-session-workspace',
          workspaceFolder: '/workspace/root',
          sessionId: 'sess-1',
          reason: 'wire_api is unsupported'
        }
      })}\n`, 'utf8')
      currentSession = {
        ...currentSession,
        adapter: 'codex',
        status: 'failed'
      }

      await expect(resolveExternalRuntimeProjectConfigFailure('sess-1')).resolves.toMatchObject({
        available: true,
        failureEventId: 'evt-project-config-failure'
      })
      const migratedRuntimeRoot = resolveSessionRuntimeStoreRoot('/workspace/root')
      const migratedSessionStore = path.join(migratedRuntimeRoot, 'sessions', 'sess-1')
      const session = new FileRuntimeSessionStore(migratedSessionStore, 'sess-1')
      const projectionGate = await acquireLockFile(session.getLockPath('events.append'), {
        operation: 'hold-db-projection'
      })
      let recoveryPromise: ReturnType<typeof retryExternalRuntimeSessionProjectConfig> | undefined
      try {
        await session.appendCommand({
          protocolVersion: '1.0.0',
          id: commandId,
          ts: 110,
          sessionId: 'sess-1',
          type,
          priority: 20,
          source,
          content: 'continue normally',
          message: 'continue normally'
        })
        recoveryPromise = retryExternalRuntimeSessionProjectConfig('sess-1')
      } finally {
        await projectionGate.release()
      }
      await expect(recoveryPromise!).resolves.toEqual({
        queued: false,
        reason: 'current_failure_ineligible'
      })

      const commands = await session.readCommands()
      expect(commands.map(command => command.id)).toEqual([
        'cmd-start-attempt',
        commandId
      ])
      expect(currentSession.status).toBe('failed')
    }
  )

  it('queues external runtime messages with a per-message model override', async () => {
    const runtimeAiBaseDir = await mkdtemp(path.join(os.tmpdir(), 'ow-session-runtime-model-'))
    tempRuntimeRoot = runtimeAiBaseDir
    const runtimeRoot = path.join(runtimeAiBaseDir, 'runtime')
    process.env.__ONEWORKS_PROJECT_BASE_DIR__ = runtimeAiBaseDir
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(runtimeAiBaseDir, 'home-projects')
    await mkdir(path.join(runtimeRoot, 'sessions', 'sess-1'), { recursive: true })
    getSessionRuntimeState.mockReturnValue({
      runtimeKind: 'external',
      historySeedPending: false
    })

    await processUserMessage('sess-1', [
      { type: 'image', url: 'file:///tmp/pic.png', path: '/tmp/pic.png' }
    ], {
      model: 'gpt-5.5'
    })

    const migratedRuntimeRoot = resolveSessionRuntimeStoreRoot('/workspace/root')
    const command = JSON.parse(
      await readFile(path.join(migratedRuntimeRoot, 'sessions', 'sess-1', 'commands.jsonl'), 'utf8')
    ) as Record<string, unknown>

    expect(command).toEqual(expect.objectContaining({
      sessionId: 'sess-1',
      type: 'send_message',
      content: '[图片]',
      model: 'gpt-5.5'
    }))
  })

  it('uses an active adapter runtime even if the persisted runtime kind is external', async () => {
    const emit = vi.fn()
    getMessages.mockReturnValue([])
    getSessionRuntimeState.mockReturnValue({
      runtimeKind: 'external',
      historySeedPending: false
    })
    adapterSessionStore.set('sess-1', {
      ...createSessionConnectionState(),
      session: {
        emit,
        kill: vi.fn()
      } as any
    })

    await processUserMessage('sess-1', 'hello child')

    expect(saveMessage).toHaveBeenCalledOnce()
    expect(saveMessage).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        type: 'message',
        message: expect.objectContaining({
          role: 'user',
          content: 'hello child'
        })
      })
    )
    expect(emit).toHaveBeenCalledWith({
      type: 'message',
      content: [{ type: 'text', text: 'hello child' }],
      parentUuid: undefined
    })
  })

  it('creates a runtime-store session for external forks on the first user message', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-session-fork-workspace-'))
    tempRuntimeRoot = workspaceRoot
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(workspaceRoot, 'home-projects')
    currentSession = {
      ...currentSession,
      adapter: 'codex',
      effort: 'high',
      model: 'mock,codex',
      permissionMode: 'dontAsk',
      promptName: 'client',
      promptType: 'workspace',
      title: 'Forked session'
    }
    getSessionRuntimeState.mockReturnValue({
      runtimeKind: 'external',
      historySeed: '历史上下文',
      historySeedPending: true
    })
    vi.mocked(resolveSessionWorkspace).mockResolvedValue({
      sessionId: 'sess-1',
      workspaceFolder: workspaceRoot
    } as any)

    await processUserMessage('sess-1', 'continue fork')

    const storePath = path.join(resolveSessionRuntimeStoreRoot(workspaceRoot), 'sessions', 'sess-1')
    const meta = JSON.parse(await readFile(path.join(storePath, 'meta.json'), 'utf8')) as Record<string, unknown>
    const command = JSON.parse(await readFile(path.join(storePath, 'commands.jsonl'), 'utf8')) as Record<
      string,
      unknown
    >

    expect(meta).toMatchObject({
      sessionId: 'sess-1',
      adapter: 'codex',
      model: 'mock,codex',
      promptType: 'workspace',
      promptName: 'client',
      systemPrompt: '历史上下文'
    })
    expect(command).toMatchObject({
      type: 'start',
      source: 'web',
      content: 'continue fork',
      taskType: 'workspace',
      name: 'client',
      systemPrompt: '历史上下文'
    })
    expect(getMessages).not.toHaveBeenCalled()
    expect(adapterSessionStore.has('sess-1')).toBe(false)
    expect(updateSessionRuntimeState).toHaveBeenCalledWith('sess-1', { historySeedPending: false })
    expect(updateSession).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        lastMessage: 'continue fork',
        lastUserMessage: 'continue fork',
        status: 'running'
      })
    )
  })

  it('summarizes file-only user messages with the selected workspace path', async () => {
    const socket = { readyState: 1, send: vi.fn() } as any
    const emit = vi.fn()
    getMessages.mockReturnValue([])

    const runtime = createSessionConnectionState()
    runtime.sockets.add(socket)
    adapterSessionStore.set('sess-1', {
      ...runtime,
      session: {
        emit,
        kill: vi.fn()
      } as any
    })

    await processUserMessage('sess-1', [
      { type: 'file', path: 'apps/client/src/main.tsx', name: 'main.tsx' }
    ])

    expect(updateSession).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        title: 'Context file: apps/client/src/main.tsx',
        lastMessage: 'Context file: apps/client/src/main.tsx',
        lastUserMessage: 'Context file: apps/client/src/main.tsx'
      })
    )
    expect(emit).toHaveBeenCalledWith({
      type: 'message',
      content: [{ type: 'file', path: 'apps/client/src/main.tsx', name: 'main.tsx' }],
      parentUuid: undefined
    })
  })
})
