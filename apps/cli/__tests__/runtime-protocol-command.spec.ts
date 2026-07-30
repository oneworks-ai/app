/* eslint-disable max-lines -- protocol command coverage intentionally exercises multiple envelopes together */
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'

import { afterEach, describe, expect, it } from 'vitest'

import { RuntimeCommandSchema, getCurrentProtocolVersion } from '@oneworks/runtime-protocol'
import { projectConfigRecoveryPayloadDigest } from '@oneworks/runtime-store'
import { resolveProjectHomePath } from '@oneworks/utils/ai-path'

import {
  appendRuntimeCommand,
  createRuntimeSession,
  readRuntimeCommands,
  readRuntimeEvents,
  readRuntimeStatus
} from '#~/commands/agent/runtime-store.js'
import {
  buildRuntimeResumeConsumerArgs,
  executeRuntimeProtocolCommand,
  runRuntimeProtocolStdio,
  shouldStartRuntimeConsumer,
  shouldStartRuntimeResumeConsumer
} from '#~/commands/run.js'
import {
  RuntimeDeliveryCrashError,
  attachRuntimeCommandBridge
} from '#~/commands/run/runtime-command-bridge.js'
import { createCliRuntimeEventSink, createRuntimeEventSink } from '#~/commands/run/runtime-event-sink.js'

const tempDirs: string[] = []
const originalProjectWorkspaceFolder = process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
const originalProjectHomeProjectsDir = process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__

const createTempDir = async () => {
  const cwd = await fs.mkdtemp(path.join(tmpdir(), 'ow-runtime-protocol-'))
  await fs.writeFile(path.join(cwd, 'package.json'), '{"private":true}\n')
  process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(cwd, '.oneworks-projects')
  process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = cwd
  tempDirs.push(cwd)
  return cwd
}

const resolveExpectedStorePath = (
  cwd: string,
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env
) => resolveProjectHomePath(cwd, env, 'runtime', 'sessions', sessionId)

const projectConfigRecoveryKey = (
  sessionId: string,
  attemptCommandId: string,
  failureEventId: string,
  failureEventSeq: number
) => createHash('sha256')
  .update(`${sessionId}\0${attemptCommandId}\0${failureEventId}\0${failureEventSeq}`)
  .digest('hex')

const projectConfigFailureEvent = (params: {
  adapter?: string
  sessionId: string
  commandId: string
  workspaceFolder: string
  id?: string
  seq?: number
}) => {
  const id = params.id ?? 'evt_failed_attempt'
  const seq = params.seq ?? 7
  return {
    protocolVersion: getCurrentProtocolVersion(),
    id,
    seq,
    ts: 150,
    sessionId: params.sessionId,
    type: 'session_failed',
    causedByCommandId: params.commandId,
    code: 'codex_project_config_invalid',
    fatal: true,
    message: 'Invalid project config',
    details: {
      adapter: params.adapter ?? 'codex',
      runtimeAdapter: 'codex',
      configSource: 'project',
      configPath: '.codex/config.toml',
      workspaceSource: 'active-session-workspace',
      workspaceFolder: params.workspaceFolder,
      sessionId: params.sessionId,
      reason: 'Invalid project Codex config.'
    }
  }
}

const projectConfigRecoveryGrantEvent = (
  recoveryCommand: Record<string, unknown>,
  failureEvent: ReturnType<typeof projectConfigFailureEvent>,
  workspaceFolder: string
) => {
  const recovery = recoveryCommand.recovery as {
    grantAuthorizationId: string
    grantCommandIndex: number
    grantEventId: string
    grantEventSeq: number
    idempotencyKey: string
  }
  return {
    protocolVersion: getCurrentProtocolVersion(),
    id: recovery.grantEventId,
    seq: recovery.grantEventSeq,
    ts: failureEvent.ts + 1,
    sessionId: failureEvent.sessionId,
    type: 'project_config_recovery_granted',
    source: 'server:project-config-recovery',
    recoveryGrant: {
      schemaVersion: 1,
      type: 'project_config_recovery_grant',
      authorizationId: recovery.grantAuthorizationId,
      commandIndex: recovery.grantCommandIndex,
      recoveryCommandId: recoveryCommand.id,
      idempotencyKey: recovery.idempotencyKey,
      sessionId: failureEvent.sessionId,
      attemptCommandId: failureEvent.causedByCommandId,
      failureEventId: failureEvent.id,
      failureEventSeq: failureEvent.seq,
      payloadDigest: projectConfigRecoveryPayloadDigest(
        RuntimeCommandSchema.parse(recoveryCommand)
      )!,
      workspaceFolder,
      adapter: String(recoveryCommand.adapter ?? 'codex'),
      runtimeAdapter: 'codex'
    }
  }
}

afterEach(async () => {
  if (originalProjectWorkspaceFolder == null) {
    delete process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
  } else {
    process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = originalProjectWorkspaceFolder
  }
  if (originalProjectHomeProjectsDir == null) {
    delete process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__
  } else {
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = originalProjectHomeProjectsDir
  }
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })))
})

describe('runtime protocol command mode', () => {
  it('starts a background consumer by default when protocol mode has an environment', () => {
    expect(shouldStartRuntimeConsumer({ type: 'session.start' }, {})).toBe(true)
    expect(shouldStartRuntimeConsumer({ type: 'session.start', background: false }, {})).toBe(false)
    expect(shouldStartRuntimeConsumer({ type: 'session.start' }, {
      ONEWORKS_RUNTIME_PROTOCOL_DISABLE_CONSUMER: '1'
    } as NodeJS.ProcessEnv)).toBe(false)
    expect(shouldStartRuntimeConsumer({ type: 'session.start' }, {
      __ONEWORKS_PROJECT_BASE_DIR__: '/runtime-base',
      __ONEWORKS_AGENT_ROOM_HOST_SESSION_ID__: 'host-session'
    } as NodeJS.ProcessEnv)).toBe(false)
    expect(shouldStartRuntimeConsumer({
      type: 'session.start',
      hostSessionId: 'host-session'
    }, {
      __ONEWORKS_PROJECT_BASE_DIR__: '/runtime-base'
    } as NodeJS.ProcessEnv)).toBe(false)
    expect(shouldStartRuntimeConsumer({ type: 'session.start' }, {
      __ONEWORKS_PROJECT_BASE_DIR__: '/runtime-base',
      ONEWORKS_RUNTIME_PROTOCOL_FORCE_LOCAL_CONSUMER: '1',
      __ONEWORKS_AGENT_ROOM_HOST_SESSION_ID__: 'host-session'
    } as NodeJS.ProcessEnv)).toBe(true)
    expect(shouldStartRuntimeConsumer({ type: 'session.start' })).toBe(false)
  })

  it('starts a resume consumer for terminal follow-up messages', () => {
    expect(shouldStartRuntimeResumeConsumer({
      command: { type: 'session.message' },
      env: {},
      status: 'completed'
    })).toBe(true)
    expect(shouldStartRuntimeResumeConsumer({
      command: { type: 'session.message' },
      env: {},
      status: 'failed'
    })).toBe(true)
    expect(shouldStartRuntimeResumeConsumer({
      command: { type: 'session.message' },
      env: {},
      status: 'running'
    })).toBe(false)
    expect(shouldStartRuntimeResumeConsumer({
      command: { background: false, type: 'session.message' },
      env: {},
      status: 'completed'
    })).toBe(false)
    expect(shouldStartRuntimeResumeConsumer({
      command: { type: 'session.message' },
      env: { ONEWORKS_RUNTIME_PROTOCOL_DISABLE_CONSUMER: '1' } as NodeJS.ProcessEnv,
      status: 'completed'
    })).toBe(false)
  })

  it('executes protocol start commands through the unified runtime writer', async () => {
    const cwd = await createTempDir()

    const result = await executeRuntimeProtocolCommand({
      protocolVersion: getCurrentProtocolVersion(),
      commandId: 'proto-start-1',
      type: 'session.start',
      sessionId: 'sess-proto-start',
      entity: 'dev',
      title: 'Protocol developer',
      message: 'Start through protocol'
    }, {
      cwd,
      now: () => 100
    })

    expect(result).toEqual(expect.objectContaining({
      commandId: 'proto-start-1',
      ok: true,
      sessionId: 'sess-proto-start',
      status: 'starting',
      storePath: resolveExpectedStorePath(cwd, 'sess-proto-start')
    }))
    expect(result.result).toEqual(expect.objectContaining({
      runtimeCommandId: expect.stringMatching(/^cmd_start_/),
      sessionId: 'sess-proto-start'
    }))

    const status = await readRuntimeStatus(cwd, 'sess-proto-start')
    expect(status.meta).toEqual(expect.objectContaining({
      entity: 'dev',
      title: 'Protocol developer'
    }))
    expect(await readRuntimeCommands(cwd, 'sess-proto-start')).toEqual([
      expect.objectContaining({
        commandId: 'proto-start-1',
        content: 'Start through protocol',
        type: 'start'
      })
    ])
  })

  it('preserves structured-only protocol start content for bridge delivery without empty text', async () => {
    const cwd = await createTempDir()
    const result = await executeRuntimeProtocolCommand({
      protocolVersion: getCurrentProtocolVersion(),
      commandId: 'proto-structured-start',
      type: 'session.start',
      sessionId: 'sess-structured-start',
      entity: 'dev',
      contentItems: [{ type: 'file', path: '/tmp/structured-start.md' }]
    }, { cwd, now: () => 100 })

    expect(result.ok).toBe(true)
    expect(await readRuntimeCommands(cwd, 'sess-structured-start')).toEqual([
      expect.objectContaining({
        type: 'start',
        contentItems: [{ type: 'file', path: '/tmp/structured-start.md' }],
        messageDelivery: 'bridge'
      })
    ])
  })

  it('stores deferred systemPrompt, account, and updateConfiguredSkills symmetrically', async () => {
    const cwd = await createTempDir()
    const sessionId = 'sess-deferred-public-fields'
    const result = await executeRuntimeProtocolCommand({
      protocolVersion: getCurrentProtocolVersion(),
      commandId: 'proto-deferred-fields',
      type: 'session.start',
      sessionId,
      entity: 'dev',
      message: 'Run deferred task',
      account: 'work',
      systemPrompt: 'Authoritative deferred prompt',
      updateConfiguredSkills: true
    }, { cwd, now: () => 100 })

    expect(result.ok).toBe(true)
    expect((await readRuntimeStatus(cwd, sessionId)).meta).toEqual(expect.objectContaining({
      account: 'work',
      systemPrompt: 'Authoritative deferred prompt',
      updateConfiguredSkills: true
    }))
    expect(await readRuntimeCommands(cwd, sessionId)).toEqual([
      expect.objectContaining({
        account: 'work',
        systemPrompt: 'Authoritative deferred prompt',
        updateConfiguredSkills: true
      })
    ])
  })

  it.each([
    ['session.resume', 'account', 'work'],
    ['session.message', 'systemPrompt', 'must not leak into a resume'],
    ['session.stop', 'updateConfiguredSkills', true]
  ] as const)(
    'rejects the start-only %s.%s field before runtime dispatch',
    async (type, field, value) => {
      const cwd = await createTempDir()
      const sessionId = `sess-start-only-${field}`
      await createRuntimeSession({
        cwd,
        entity: 'dev',
        env: { ONEWORKS_RUNTIME_PROTOCOL_DISABLE_CONSUMER: '1' },
        message: 'Start',
        sessionId
      })
      const before = await readRuntimeCommands(cwd, sessionId)
      const result = await executeRuntimeProtocolCommand({
        protocolVersion: getCurrentProtocolVersion(),
        commandId: `proto-invalid-${field}`,
        type,
        sessionId,
        ...(type === 'session.stop' ? {} : { message: 'Continue' }),
        [field]: value
      }, { cwd })

      expect(result).toEqual(expect.objectContaining({
        commandId: `proto-invalid-${field}`,
        ok: false
      }))
      expect(await readRuntimeCommands(cwd, sessionId)).toEqual(before)
    }
  )

  it('keeps project config recovery command-local across public resume persistence and spawn args', async () => {
    const cwd = await createTempDir()
    const env = {
      ONEWORKS_RUNTIME_PROTOCOL_DISABLE_CONSUMER: '1'
    } as NodeJS.ProcessEnv
    await createRuntimeSession({
      cwd,
      entity: 'dev',
      env,
      message: 'Start',
      sessionId: 'sess-proto-recovery'
    })

    const recoveryResult = await executeRuntimeProtocolCommand({
      protocolVersion: getCurrentProtocolVersion(),
      commandId: 'proto-resume-recovery',
      type: 'session.resume',
      sessionId: 'sess-proto-recovery',
      message: 'Retry with global config',
      projectConfigPolicy: 'global-only'
    }, { cwd, env })
    const ordinaryResult = await executeRuntimeProtocolCommand({
      protocolVersion: getCurrentProtocolVersion(),
      commandId: 'proto-resume-ordinary',
      type: 'session.resume',
      sessionId: 'sess-proto-recovery',
      message: 'Resume normally'
    }, { cwd, env })

    expect(recoveryResult.ok).toBe(true)
    expect(ordinaryResult.ok).toBe(true)
    const commands = await readRuntimeCommands(cwd, 'sess-proto-recovery', env)
    expect(commands.at(-2)).toEqual(expect.objectContaining({
      type: 'resume',
      projectConfigPolicy: 'global-only'
    }))
    expect(commands.at(-1)).toEqual(expect.objectContaining({
      type: 'resume'
    }))
    expect(commands.at(-1)).not.toHaveProperty('projectConfigPolicy')
    expect((await readRuntimeStatus(cwd, 'sess-proto-recovery', env)).meta)
      .not.toHaveProperty('projectConfigPolicy')

    expect(buildRuntimeResumeConsumerArgs({
      cliEntrypoint: '/tmp/ow.js',
      projectConfigPolicy: 'global-only',
      sessionId: 'sess-proto-recovery'
    })).toEqual(expect.arrayContaining([
      '--resume',
      'sess-proto-recovery',
      '--project-config-policy',
      'global-only'
    ]))
    expect(buildRuntimeResumeConsumerArgs({
      cliEntrypoint: '/tmp/ow.js',
      sessionId: 'sess-proto-recovery'
    })).not.toContain('--project-config-policy')
  })

  it('uses the project-home runtime dir for protocol writes with server env', async () => {
    const cwd = await createTempDir()
    const aiBaseDir = await fs.mkdtemp(path.join(tmpdir(), 'ow-runtime-ai-base-'))
    const homeDir = await fs.mkdtemp(path.join(tmpdir(), 'ow-runtime-home-'))
    tempDirs.push(aiBaseDir)
    tempDirs.push(homeDir)
    const env = {
      HOME: homeDir,
      __ONEWORKS_PROJECT_BASE_DIR__: aiBaseDir,
      ONEWORKS_RUNTIME_PROTOCOL_DISABLE_CONSUMER: '1'
    } as NodeJS.ProcessEnv

    const result = await executeRuntimeProtocolCommand({
      protocolVersion: getCurrentProtocolVersion(),
      commandId: 'proto-env-start',
      type: 'session.start',
      sessionId: 'sess-proto-env',
      entity: 'dev',
      message: 'Start in injected project context'
    }, {
      cwd,
      env,
      now: () => 100
    })

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      sessionId: 'sess-proto-env',
      storePath: resolveExpectedStorePath(cwd, 'sess-proto-env', env)
    }))
    expect(await readRuntimeCommands(cwd, 'sess-proto-env', env)).toEqual([
      expect.objectContaining({
        commandId: 'proto-env-start',
        content: 'Start in injected project context',
        type: 'start'
      })
    ])
    await expect(fs.access(path.join(cwd, '.oneworks/runtime/sessions/sess-proto-env'))).rejects.toThrow()
  })

  it('inherits server injected room metadata for protocol start commands', async () => {
    const cwd = await createTempDir()
    const env = {
      ONEWORKS_RUNTIME_PROTOCOL_DISABLE_CONSUMER: '1',
      __ONEWORKS_AGENT_ROOM_HOST_SESSION_ID__: 'host-session',
      __ONEWORKS_AGENT_ROOM_ID__: 'room-protocol',
      __ONEWORKS_AGENT_ROOM_TITLE__: 'Protocol room'
    } as NodeJS.ProcessEnv

    await executeRuntimeProtocolCommand({
      protocolVersion: getCurrentProtocolVersion(),
      commandId: 'proto-room-start',
      type: 'session.start',
      sessionId: 'sess-proto-room',
      entity: 'dev',
      memberAvatar: 'DV',
      message: 'Start in room'
    }, {
      cwd,
      env,
      now: () => 100
    })

    const status = await readRuntimeStatus(cwd, 'sess-proto-room', env)
    expect(status.meta).toEqual(expect.objectContaining({
      hostSessionId: 'host-session',
      memberAvatar: 'DV',
      parentSessionId: 'host-session',
      roomId: 'room-protocol',
      roomTitle: 'Protocol room'
    }))
  })

  it('inherits server injected adapter defaults when protocol start omits model parameters', async () => {
    const cwd = await createTempDir()
    const env = {
      ONEWORKS_RUNTIME_PROTOCOL_DISABLE_CONSUMER: '1',
      __ONEWORKS_RUNTIME_PROTOCOL_DEFAULT_ADAPTER__: 'codex',
      __ONEWORKS_RUNTIME_PROTOCOL_DEFAULT_MODEL__: 'mock-service,codex-hooks',
      __ONEWORKS_RUNTIME_PROTOCOL_DEFAULT_EFFORT__: 'high',
      __ONEWORKS_RUNTIME_PROTOCOL_DEFAULT_PERMISSION_MODE__: 'bypassPermissions'
    } as NodeJS.ProcessEnv

    await executeRuntimeProtocolCommand({
      protocolVersion: getCurrentProtocolVersion(),
      commandId: 'proto-default-model-start',
      type: 'session.start',
      sessionId: 'sess-proto-default-model',
      entity: 'dev',
      message: 'Start with inherited defaults'
    }, {
      cwd,
      env,
      now: () => 100
    })

    const status = await readRuntimeStatus(cwd, 'sess-proto-default-model', env)
    expect(status.meta).toEqual(expect.objectContaining({
      adapter: 'codex',
      effort: 'high',
      permissionMode: 'bypassPermissions',
      model: 'mock-service,codex-hooks'
    }))
    expect(await readRuntimeCommands(cwd, 'sess-proto-default-model', env)).toEqual([
      expect.objectContaining({
        adapter: 'codex',
        effort: 'high',
        model: 'mock-service,codex-hooks',
        permissionMode: 'bypassPermissions',
        type: 'start'
      })
    ])
  })

  it('generates a stable room id from host session metadata when no room id is explicit', async () => {
    const cwd = await createTempDir()

    const result = await executeRuntimeProtocolCommand({
      protocolVersion: getCurrentProtocolVersion(),
      commandId: 'proto-host-room-start',
      type: 'session.start',
      sessionId: 'sess-proto-host-room',
      entity: 'dev',
      hostSessionId: 'host-session',
      message: 'Start child task'
    }, {
      cwd,
      now: () => 100
    })

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      sessionId: 'sess-proto-host-room'
    }))
    expect(result.result).toEqual(expect.objectContaining({
      hostSessionId: 'host-session',
      roomId: 'room_host-session'
    }))
    const status = await readRuntimeStatus(cwd, 'sess-proto-host-room')
    expect(status.meta).toEqual(expect.objectContaining({
      hostSessionId: 'host-session',
      parentSessionId: 'host-session',
      roomId: 'room_host-session'
    }))
    expect(await readRuntimeCommands(cwd, 'sess-proto-host-room')).toEqual([
      expect.objectContaining({
        roomId: 'room_host-session',
        type: 'start'
      })
    ])
  })

  it('accepts payload-only protocol command fields while preserving top-level overrides', async () => {
    const cwd = await createTempDir()

    const result = await executeRuntimeProtocolCommand({
      protocolVersion: getCurrentProtocolVersion(),
      commandId: 'proto-payload-start',
      type: 'session.start',
      sessionId: 'sess-proto-payload',
      title: 'Top level title',
      payload: {
        entity: 'dev',
        message: 'Start from payload',
        title: 'Payload title'
      }
    }, {
      cwd,
      now: () => 100
    })

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      sessionId: 'sess-proto-payload'
    }))
    const status = await readRuntimeStatus(cwd, 'sess-proto-payload')
    expect(status.meta).toEqual(expect.objectContaining({
      entity: 'dev',
      title: 'Top level title'
    }))
    expect(await readRuntimeCommands(cwd, 'sess-proto-payload')).toEqual([
      expect.objectContaining({
        content: 'Start from payload',
        title: 'Top level title',
        type: 'start'
      })
    ])
  })

  it('correlates protocol message, submit, and stop commands in commands.jsonl', async () => {
    const cwd = await createTempDir()
    await createRuntimeSession({
      cwd,
      entity: 'qa',
      message: 'Start',
      sessionId: 'sess-proto-correlation',
      now: () => 100
    })

    const messageResult = await executeRuntimeProtocolCommand({
      protocolVersion: getCurrentProtocolVersion(),
      commandId: 'proto-message-1',
      type: 'session.message',
      sessionId: 'sess-proto-correlation',
      message: 'Continue'
    }, {
      cwd,
      now: () => 200
    })
    const submitResult = await executeRuntimeProtocolCommand({
      protocolVersion: getCurrentProtocolVersion(),
      commandId: 'proto-submit-1',
      type: 'session.submit',
      sessionId: 'sess-proto-correlation',
      requestId: 'req-1',
      value: 'allow_once'
    }, {
      cwd,
      now: () => 300
    })
    const stopResult = await executeRuntimeProtocolCommand({
      protocolVersion: getCurrentProtocolVersion(),
      commandId: 'proto-stop-1',
      type: 'session.stop',
      sessionId: 'sess-proto-correlation'
    }, {
      cwd,
      now: () => 400
    })

    expect([messageResult, submitResult, stopResult]).toEqual([
      expect.objectContaining({ commandId: 'proto-message-1', ok: true }),
      expect.objectContaining({ commandId: 'proto-submit-1', ok: true }),
      expect.objectContaining({ commandId: 'proto-stop-1', ok: true })
    ])
    expect(await readRuntimeCommands(cwd, 'sess-proto-correlation')).toEqual([
      expect.objectContaining({ type: 'start' }),
      expect.objectContaining({
        commandId: 'proto-message-1',
        content: 'Continue',
        type: 'send_message'
      }),
      expect.objectContaining({
        commandId: 'proto-submit-1',
        requestId: 'req-1',
        type: 'submit_input',
        value: 'allow_once'
      }),
      expect.objectContaining({
        commandId: 'proto-stop-1',
        mode: 'graceful',
        type: 'stop'
      })
    ])
  })

  it('does not replay already acknowledged commands when a terminal session resumes', async () => {
    const cwd = await createTempDir()
    await createRuntimeSession({
      cwd,
      entity: 'qa',
      message: 'Start',
      sessionId: 'sess-resume-bridge',
      now: () => 100
    })
    const sink = await createRuntimeEventSink({ cwd, sessionId: 'sess-resume-bridge' })
    await sink.recordStartup(await readRuntimeCommands(cwd, 'sess-resume-bridge'))

    await appendRuntimeCommand({
      cwd,
      message: 'already handled',
      now: () => 200,
      sessionId: 'sess-resume-bridge',
      type: 'send_message'
    })
    const oldMessageCommand = (await readRuntimeCommands(cwd, 'sess-resume-bridge'))
      .find(command => command.content === 'already handled')
    expect(oldMessageCommand).toBeDefined()
    await sink.ackCommand(oldMessageCommand!)

    await appendRuntimeCommand({
      cwd,
      message: 'new follow up',
      now: () => 300,
      sessionId: 'sess-resume-bridge',
      type: 'send_message'
    })

    const emitted: unknown[] = []
    const stopBridge = await attachRuntimeCommandBridge({
      adapter: 'codex',
      cwd,
      runtimeAdapter: 'codex',
      session: {
        emit: event => emitted.push(event)
      },
      sessionId: 'sess-resume-bridge',
      sink
    })
    await stopBridge()

    expect(emitted).toEqual([
      {
        type: 'message',
        content: [{ type: 'text', text: 'new follow up' }]
      }
    ])
  })

  it('delivers bridge start commands as structured input instead of startup text', async () => {
    const cwd = await createTempDir()
    const sessionId = 'sess-bridge-start'
    const storePath = resolveExpectedStorePath(cwd, sessionId)
    await fs.mkdir(storePath, { recursive: true })
    await fs.writeFile(
      path.join(storePath, 'commands.jsonl'),
      `${
        JSON.stringify({
          protocolVersion: getCurrentProtocolVersion(),
          id: 'cmd_start_1',
          ts: 100,
          sessionId,
          type: 'start',
          priority: 20,
          source: 'web',
          content: 'Context file: /tmp/spec.md',
          messageDelivery: 'bridge',
          contentItems: [{ type: 'file', path: '/tmp/spec.md' }]
        })
      }\n`
    )

    const sink = await createRuntimeEventSink({ cwd, sessionId })
    const startup = await sink.recordStartup(await readRuntimeCommands(cwd, sessionId))
    await sink.flush()

    expect(startup).toEqual(expect.objectContaining({
      startAlreadyAcked: false,
      shouldRunInitialPrompt: false
    }))
    expect(await readRuntimeEvents(cwd, sessionId)).toEqual([])

    const emitted: unknown[] = []
    const stopBridge = await attachRuntimeCommandBridge({
      adapter: 'codex',
      cwd,
      runtimeAdapter: 'codex',
      session: {
        emit: event => emitted.push(event)
      },
      sessionId,
      sink
    })
    await stopBridge()

    expect(emitted).toEqual([
      {
        type: 'message',
        content: [{ type: 'file', path: '/tmp/spec.md' }]
      }
    ])
    expect((await readRuntimeEvents(cwd, sessionId)).map(event => event.type)).toEqual([
      'command_ack',
      'message'
    ])
  })

  it('durably completes an initial prompt only after adapter acceptance without duplicating it', async () => {
    const cwd = await createTempDir()
    const sessionId = 'sess-initial-prompt-start'
    const storePath = resolveExpectedStorePath(cwd, sessionId)
    await fs.mkdir(storePath, { recursive: true })
    await fs.writeFile(
      path.join(storePath, 'commands.jsonl'),
      `${
        JSON.stringify({
          protocolVersion: getCurrentProtocolVersion(),
          id: 'cmd_start_1',
          ts: 100,
          sessionId,
          type: 'start',
          priority: 20,
          source: 'web',
          content: 'hi',
          messageDelivery: 'initial_prompt'
        })
      }\n`
    )

    const sink = await createRuntimeEventSink({ cwd, sessionId })
    const startup = await sink.recordStartup(await readRuntimeCommands(cwd, sessionId))
    await sink.flush()

    expect(startup).toEqual(expect.objectContaining({
      startAlreadyAcked: false,
      shouldRunInitialPrompt: true
    }))
    expect(await readRuntimeEvents(cwd, sessionId)).toEqual([])

    // This is the synchronous adapter/session acceptance boundary.  A crash
    // before it leaves the start unacknowledged for at-least-once replay.
    await sink.completeInitialPromptDelivery()
    expect((await readRuntimeEvents(cwd, sessionId)).map(event => event.type)).toEqual([
      'command_delivery_prepared',
      'command_delivery_accepted',
      'command_delivery_completed',
      'message',
      'command_ack'
    ])

    await sink.handleAdapterEvent({
      type: 'message',
      data: {
        id: 'user-echo-1',
        role: 'user',
        content: 'hi',
        createdAt: 200
      }
    })
    await sink.flush()
    expect((await readRuntimeEvents(cwd, sessionId)).map(event => event.type)).toEqual([
      'command_delivery_prepared',
      'command_delivery_accepted',
      'command_delivery_completed',
      'message',
      'command_ack'
    ])
  })

  it('can deliver runtime-only content without changing the recorded command message', async () => {
    const cwd = await createTempDir()
    const sessionId = 'sess-runtime-only-content'
    const storePath = resolveExpectedStorePath(cwd, sessionId)
    await fs.mkdir(storePath, { recursive: true })
    await fs.writeFile(
      path.join(storePath, 'commands.jsonl'),
      `${
        JSON.stringify({
          protocolVersion: getCurrentProtocolVersion(),
          id: 'cmd_start_1',
          ts: 100,
          sessionId,
          type: 'start',
          priority: 20,
          source: 'web',
          content: 'visible message',
          messageDelivery: 'bridge',
          runtimeContentItems: [
            { type: 'text', text: 'visible message' },
            { type: 'text', text: 'runtime reminder' }
          ]
        })
      }\n`
    )

    const sink = await createRuntimeEventSink({ cwd, sessionId })
    await sink.recordStartup(await readRuntimeCommands(cwd, sessionId))
    await sink.flush()

    const emitted: unknown[] = []
    const stopBridge = await attachRuntimeCommandBridge({
      cwd,
      session: {
        emit: event => emitted.push(event)
      },
      sessionId,
      sink
    })
    await stopBridge()

    expect(emitted).toEqual([
      {
        type: 'message',
        content: [
          { type: 'text', text: 'visible message' },
          { type: 'text', text: 'runtime reminder' }
        ]
      }
    ])
    expect((await readRuntimeEvents(cwd, sessionId)).find(event => event.type === 'message')).toEqual(
      expect.objectContaining({
        content: 'visible message'
      })
    )
  })

  it.each(['resume', 'send_message'] as const)(
    'dispatches a server-stored recovery for an adapter-less unacknowledged %s attempt',
    async (failedType) => {
    const cwd = await createTempDir()
    const sessionId = `sess-project-config-recovery-${failedType}`
    const storePath = resolveExpectedStorePath(cwd, sessionId)
    await fs.mkdir(storePath, { recursive: true })
    const failedCommand = {
      protocolVersion: getCurrentProtocolVersion(),
      id: 'cmd_failed_attempt',
      ts: 100,
      sessionId,
      type: failedType,
      priority: 20,
      source: 'user',
      content: 'visible recovery prompt',
      runtimeContentItems: [
        { type: 'text', text: 'exact failed prompt' },
        { type: 'file', path: '/tmp/recovery-context.md' }
      ]
    }
    const recoveryCommand = {
      protocolVersion: getCurrentProtocolVersion(),
      id: 'cmd_recovery_1',
      ts: 200,
      sessionId,
      type: 'resume',
      priority: 20,
      source: 'project_config_recovery',
      adapter: 'custom-codex',
      content: 'visible recovery prompt',
      message: 'visible recovery prompt',
      messageDelivery: 'bridge',
      projectConfigPolicy: 'global-only',
      runtimeContentItems: failedCommand.runtimeContentItems,
      recovery: {
        kind: 'codex-project-config',
        attemptCommandId: 'cmd_failed_attempt',
        replacedActivationCommandId: 'cmd_failed_attempt',
        failureEventId: 'evt_failed_attempt',
        failureEventSeq: 7,
        grantEventId: 'evt_grant_cmd_recovery_1',
        grantEventSeq: 8,
        grantAuthorizationId: '11111111-1111-4111-8111-111111111111',
        grantCommandIndex: 1,
        idempotencyKey: projectConfigRecoveryKey(
          sessionId,
          'cmd_failed_attempt',
          'evt_failed_attempt',
          7
        )
      }
    }
    await fs.writeFile(
      path.join(storePath, 'commands.jsonl'),
      `${JSON.stringify(failedCommand)}\n${JSON.stringify(recoveryCommand)}\n`
    )
    const failureEvent = projectConfigFailureEvent({
      adapter: 'custom-codex',
      sessionId,
      commandId: failedCommand.id,
      workspaceFolder: cwd
    })
    const grantEvent = projectConfigRecoveryGrantEvent(recoveryCommand, failureEvent, cwd)
    await fs.writeFile(
      path.join(storePath, 'events.jsonl'),
      `${JSON.stringify(failureEvent)}\n${JSON.stringify(grantEvent)}\n`
    )

    const sink = await createRuntimeEventSink({ cwd, sessionId })
    await sink.recordStartup(await readRuntimeCommands(cwd, sessionId))
    const emitted: unknown[] = []
    const stopBridge = await attachRuntimeCommandBridge({
      adapter: 'custom-codex',
      cwd,
      runtimeAdapter: 'codex',
      session: {
        emit: event => emitted.push(event)
      },
      sessionId,
      sink
    })
    await stopBridge()
    await sink.flush()

    expect(emitted).toEqual([
      {
        type: 'message',
        deliveryId: 'runtime-delivery:cmd_recovery_1',
        content: [
          { type: 'text', text: 'exact failed prompt' },
          { type: 'file', path: '/tmp/recovery-context.md' }
        ]
      }
    ])
    expect((await readRuntimeEvents(cwd, sessionId)).filter(event =>
      event.type === 'command_ack' && event.commandId === 'cmd_recovery_1'
    )).toHaveLength(1)
    expect((await readRuntimeEvents(cwd, sessionId)).filter(event =>
      event.type === 'command_ack' && event.commandId === 'cmd_failed_attempt'
    )).toHaveLength(0)
    expect((await readRuntimeEvents(cwd, sessionId)).filter(event =>
      event.type === 'message' && event.causedByCommandId === 'cmd_recovery_1'
    )).toHaveLength(1)

    const stopRestartedBridge = await attachRuntimeCommandBridge({
      adapter: 'custom-codex',
      cwd,
      runtimeAdapter: 'codex',
      session: { emit: event => emitted.push(event) },
      sessionId,
      sink
    })
    await stopRestartedBridge()
    expect(emitted).toHaveLength(1)

    await fs.appendFile(path.join(storePath, 'commands.jsonl'), `${JSON.stringify({
      protocolVersion: getCurrentProtocolVersion(),
      id: 'cmd_later_ordinary',
      ts: 300,
      sessionId,
      type: 'resume',
      priority: 20,
      source: 'user',
      message: 'later ordinary prompt'
    })}\n`)
    const stopLaterBridge = await attachRuntimeCommandBridge({
      adapter: 'custom-codex',
      cwd,
      runtimeAdapter: 'codex',
      session: { emit: event => emitted.push(event) },
      sessionId,
      sink
    })
    await stopLaterBridge()
    expect(emitted).toHaveLength(2)
    expect(emitted.at(-1)).toEqual({
      type: 'message',
      content: [{ type: 'text', text: 'later ordinary prompt' }]
    })
  })

  it('does not suppress an original activation for a grantless command or partial grant', async () => {
    const cwd = await createTempDir()
    const sessionId = 'sess-forged-recovery'
    const storePath = resolveExpectedStorePath(cwd, sessionId)
    await fs.mkdir(storePath, { recursive: true })
    const idempotencyKey = projectConfigRecoveryKey(
      sessionId,
      'cmd-original',
      'evt-failed',
      1
    )
    await fs.writeFile(path.join(storePath, 'commands.jsonl'), [
      JSON.stringify({
        protocolVersion: getCurrentProtocolVersion(), id: 'cmd-original', ts: 1,
        sessionId, type: 'resume', priority: 20, source: 'user', message: 'original prompt'
      }),
      JSON.stringify({
        protocolVersion: getCurrentProtocolVersion(), id: 'cmd-forged', ts: 2,
        sessionId, type: 'resume', priority: 20, source: 'project_config_recovery',
        adapter: 'codex', message: 'original prompt',
        messageDelivery: 'bridge', projectConfigPolicy: 'global-only',
        recovery: {
          kind: 'codex-project-config', attemptCommandId: 'cmd-original',
          replacedActivationCommandId: 'cmd-original', failureEventId: 'evt-failed',
          failureEventSeq: 1,
          grantEventId: 'evt-missing-grant',
          grantEventSeq: 2,
          grantAuthorizationId: '11111111-1111-4111-8111-111111111111',
          grantCommandIndex: 1,
          idempotencyKey
        }
      })
    ].join('\n') + '\n')
    const failureEvent = projectConfigFailureEvent({
      sessionId,
      commandId: 'cmd-original',
      workspaceFolder: cwd,
      id: 'evt-failed',
      seq: 1
    })
    await fs.writeFile(path.join(storePath, 'events.jsonl'), [
      JSON.stringify(failureEvent),
      JSON.stringify({
        protocolVersion: getCurrentProtocolVersion(),
        id: 'evt-partial-grant',
        seq: 2,
        ts: 2,
        sessionId,
        type: 'project_config_recovery_granted',
        source: 'server:project-config-recovery',
        recoveryGrant: {
          schemaVersion: 1,
          type: 'project_config_recovery_grant',
          recoveryCommandId: 'cmd-forged',
          idempotencyKey
        }
      })
    ].join('\n') + '\n')

    const sink = await createRuntimeEventSink({ cwd, sessionId })
    const emitted: unknown[] = []
    const stop = await attachRuntimeCommandBridge({
      adapter: 'codex',
      cwd,
      runtimeAdapter: 'codex',
      sessionId,
      sink,
      session: { emit: event => emitted.push(event) }
    })
    await stop()

    expect(emitted).toEqual([{
      type: 'message', content: [{ type: 'text', text: 'original prompt' }]
    }])
    expect((await readRuntimeEvents(cwd, sessionId)).some(event =>
      event.type === 'command_failed' && event.commandId === 'cmd-forged'
    )).toBe(true)
  })

  it('remains lossless after a grant-only writer crash and later exact-command retry', async () => {
    const cwd = await createTempDir()
    const sessionId = 'sess-grant-command-observation'
    const storePath = resolveExpectedStorePath(cwd, sessionId)
    await fs.mkdir(storePath, { recursive: true })
    const original = {
      protocolVersion: getCurrentProtocolVersion(),
      id: 'cmd-original',
      ts: 1,
      sessionId,
      type: 'resume',
      priority: 20,
      source: 'user',
      message: 'durable prompt'
    }
    const recovery = {
      protocolVersion: getCurrentProtocolVersion(),
      id: 'cmd-recovery',
      ts: 2,
      sessionId,
      type: 'resume',
      priority: 20,
      source: 'project_config_recovery',
      adapter: 'codex',
      message: original.message,
      messageDelivery: 'bridge',
      projectConfigPolicy: 'global-only',
      recovery: {
        kind: 'codex-project-config',
        attemptCommandId: original.id,
        replacedActivationCommandId: original.id,
        failureEventId: 'evt-failure',
        failureEventSeq: 1,
        grantEventId: 'evt_grant_cmd-recovery',
        grantEventSeq: 2,
        grantAuthorizationId: '11111111-1111-4111-8111-111111111111',
        grantCommandIndex: 1,
        idempotencyKey: projectConfigRecoveryKey(
          sessionId,
          original.id,
          'evt-failure',
          1
        )
      }
    }
    const failureEvent = projectConfigFailureEvent({
      sessionId,
      commandId: original.id,
      workspaceFolder: cwd,
      id: 'evt-failure',
      seq: 1
    })
    const grantEvent = projectConfigRecoveryGrantEvent(recovery, failureEvent, cwd)
    await fs.writeFile(path.join(storePath, 'commands.jsonl'), `${JSON.stringify(original)}\n`)
    await fs.writeFile(
      path.join(storePath, 'events.jsonl'),
      `${JSON.stringify(failureEvent)}\n${JSON.stringify(grantEvent)}\n`
    )

    const emitted: unknown[] = []
    const sink = await createRuntimeEventSink({ cwd, sessionId })
    const stopGrantOnlyObservation = await attachRuntimeCommandBridge({
      adapter: 'codex',
      cwd,
      runtimeAdapter: 'codex',
      sessionId,
      sink,
      session: { emit: event => emitted.push(event) }
    })
    await stopGrantOnlyObservation()
    expect(emitted).toEqual([{
      type: 'message',
      content: [{ type: 'text', text: 'durable prompt' }]
    }])

    await fs.appendFile(
      path.join(storePath, 'commands.jsonl'),
      `${JSON.stringify(recovery)}\n`
    )
    const stopAfterCommand = await attachRuntimeCommandBridge({
      adapter: 'codex',
      cwd,
      runtimeAdapter: 'codex',
      sessionId,
      sink,
      session: { emit: event => emitted.push(event) }
    })
    await stopAfterCommand()
    expect(emitted.at(-1)).toEqual({
      type: 'message',
      deliveryId: 'runtime-delivery:cmd-recovery',
      content: [{ type: 'text', text: 'durable prompt' }]
    })
  })

  it.each([
    ['before_emit', 0, 1, 'resume'],
    ['before_emit', 0, 1, 'send_message'],
    ['after_accepted', 1, 2, 'resume'],
    ['after_accepted', 1, 2, 'send_message'],
    ['after_completed', 1, 1, 'resume'],
    ['after_completed', 1, 1, 'send_message']
  ] as const)(
    'uses honest at-least-once recovery delivery at %s (%i→%i) for %s',
    async (boundary, beforeRestart, afterRestart, failedType) => {
      const cwd = await createTempDir()
      const sessionId = `sess-delivery-crash-${boundary}`
      const storePath = resolveExpectedStorePath(cwd, sessionId)
      await fs.mkdir(storePath, { recursive: true })
      const recovery = {
        protocolVersion: getCurrentProtocolVersion(),
        id: 'cmd-recovery',
        ts: 2,
        sessionId,
        type: 'resume',
        priority: 20,
        source: 'project_config_recovery',
        adapter: 'codex',
        projectConfigPolicy: 'global-only',
        runtimeContentItems: [
          { type: 'text', text: 'recover this prompt' },
          { type: 'file', path: '/tmp/crash-recovery-context.md' }
        ],
        messageDelivery: 'bridge',
        recovery: {
          kind: 'codex-project-config',
          attemptCommandId: 'cmd-original',
          replacedActivationCommandId: 'cmd-original',
          failureEventId: 'evt-failure',
          failureEventSeq: 1,
          grantEventId: 'evt_grant_cmd-recovery',
          grantEventSeq: 2,
          grantAuthorizationId: '11111111-1111-4111-8111-111111111111',
          grantCommandIndex: 1,
          idempotencyKey: projectConfigRecoveryKey(
            sessionId,
            'cmd-original',
            'evt-failure',
            1
          )
        }
      }
      await fs.writeFile(path.join(storePath, 'commands.jsonl'), [
        JSON.stringify({
          protocolVersion: getCurrentProtocolVersion(),
          id: 'cmd-original',
          ts: 1,
          sessionId,
          type: failedType,
          priority: 20,
          source: 'user',
          runtimeContentItems: recovery.runtimeContentItems
        }),
        JSON.stringify(recovery)
      ].join('\n') + '\n')
      const failureEvent = projectConfigFailureEvent({
        sessionId,
        commandId: 'cmd-original',
        workspaceFolder: cwd,
        id: 'evt-failure',
        seq: 1
      })
      const grantEvent = projectConfigRecoveryGrantEvent(recovery, failureEvent, cwd)
      await fs.writeFile(
        path.join(storePath, 'events.jsonl'),
        `${JSON.stringify(failureEvent)}\n${JSON.stringify(grantEvent)}\n`
      )
      const sink = await createRuntimeEventSink({ cwd, sessionId })
      const emitted: unknown[] = []
      const stopCrashed = await attachRuntimeCommandBridge({
        adapter: 'codex',
        cwd,
        deliveryCrashHook: current => {
          if (current === boundary) throw new RuntimeDeliveryCrashError(boundary)
        },
        runtimeAdapter: 'codex',
        session: { emit: event => emitted.push(event) },
        sessionId,
        sink
      })
      await stopCrashed()
      expect(emitted).toHaveLength(beforeRestart)

      const stopRestarted = await attachRuntimeCommandBridge({
        adapter: 'codex',
        cwd,
        runtimeAdapter: 'codex',
        session: { emit: event => emitted.push(event) },
        sessionId,
        sink
      })
      await stopRestarted()
      expect(emitted).toHaveLength(afterRestart)
      expect(emitted.every(event =>
        (event as { deliveryId?: string }).deliveryId === 'runtime-delivery:cmd-recovery'
      )).toBe(true)
      expect(emitted.every(event =>
        JSON.stringify(event).includes('/tmp/crash-recovery-context.md')
      )).toBe(true)
    }
  )

  it('reads JSONL protocol commands from stdin and writes JSONL result envelopes', async () => {
    const cwd = await createTempDir()
    const env = {
      ONEWORKS_RUNTIME_PROTOCOL_DISABLE_CONSUMER: '1',
      __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__,
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: cwd,
      __ONEWORKS_AGENT_ROOM_HOST_SESSION_ID__: 'host-stdio-env',
      __ONEWORKS_AGENT_ROOM_ID__: undefined,
      __ONEWORKS_AGENT_ROOM_TITLE__: 'Stdio env room'
    } as NodeJS.ProcessEnv
    const output: string[] = []
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        output.push(String(chunk))
        callback()
      }
    })

    await runRuntimeProtocolStdio({
      cwd,
      inputFormat: 'stream-json',
      outputFormat: 'stream-json',
      env,
      stdin: Readable.from([
        `${
          JSON.stringify({
            protocolVersion: getCurrentProtocolVersion(),
            commandId: 'proto-stdio-start',
            type: 'session.start',
            sessionId: 'sess-proto-stdio',
            entity: 'dev',
            message: 'Start'
          })
        }\n`,
        `${
          JSON.stringify({
            protocolVersion: getCurrentProtocolVersion(),
            commandId: 'proto-stdio-stop',
            type: 'session.stop',
            sessionId: 'sess-proto-stdio'
          })
        }\n`
      ]),
      stdout,
      now: () => 100
    })

    expect(output.join('').trim().split('\n').map(line => JSON.parse(line))).toEqual([
      expect.objectContaining({
        commandId: 'proto-stdio-start',
        ok: true,
        type: 'session.start.result'
      }),
      expect.objectContaining({
        commandId: 'proto-stdio-stop',
        ok: true,
        type: 'session.stop.result'
      })
    ])
    expect(await readRuntimeCommands(cwd, 'sess-proto-stdio')).toEqual([
      expect.objectContaining({
        commandId: 'proto-stdio-start',
        roomId: 'room_host-stdio-env',
        type: 'start'
      }),
      expect.objectContaining({ commandId: 'proto-stdio-stop', type: 'stop' })
    ])
    expect((await readRuntimeStatus(cwd, 'sess-proto-stdio', env)).meta).toEqual(expect.objectContaining({
      hostSessionId: 'host-stdio-env',
      parentSessionId: 'host-stdio-env',
      roomId: 'room_host-stdio-env',
      roomTitle: 'Stdio env room'
    }))
  })

  it('returns an error envelope for incompatible protocol versions', async () => {
    const cwd = await createTempDir()

    const result = await executeRuntimeProtocolCommand({
      protocolVersion: '2.0.0',
      commandId: 'proto-incompatible',
      type: 'session.start',
      sessionId: 'sess-incompatible',
      entity: 'dev',
      message: 'Should not start'
    }, {
      cwd
    })

    expect(result).toEqual(expect.objectContaining({
      commandId: 'proto-incompatible',
      ok: false,
      type: 'session.start.result'
    }))
    expect(result.error).toMatch(/not compatible/)
    await expect(readRuntimeStatus(cwd, 'sess-incompatible')).rejects.toThrow(/not found/)
  })

  it('advances runtime consumer state to completed when the adapter emits stop', async () => {
    const cwd = await createTempDir()
    await createRuntimeSession({
      cwd,
      entity: 'dev',
      message: 'Start consumer work',
      sessionId: 'sess-consumer-complete',
      now: () => 100
    })
    const sink = await createRuntimeEventSink({ cwd, sessionId: 'sess-consumer-complete' })

    await sink.recordStartup(await readRuntimeCommands(cwd, 'sess-consumer-complete'))
    await sink.completeInitialPromptDelivery()
    await sink.handleAdapterEvent({
      type: 'init',
      data: {
        uuid: 'adapter-session',
        model: 'gpt-5',
        adapter: 'codex',
        version: '1.0.0',
        tools: [],
        slashCommands: [],
        cwd,
        agents: [],
        title: 'Consumer run'
      }
    })
    await sink.handleAdapterEvent({
      type: 'message',
      data: {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Consumer finished.',
        createdAt: 200
      }
    })
    await sink.handleAdapterEvent({ type: 'stop' })
    await sink.flush()

    const status = await readRuntimeStatus(cwd, 'sess-consumer-complete')
    expect(status.state).toEqual(expect.objectContaining({
      status: 'completed',
      lastMessage: 'Consumer finished.'
    }))
    const events = await readRuntimeEvents(cwd, 'sess-consumer-complete')
    expect(events.map(event => event.type)).toEqual([
      'command_delivery_prepared',
      'command_delivery_accepted',
      'command_delivery_completed',
      'message',
      'command_ack',
      'session_started',
      'message',
      'session_completed'
    ])
    expect(events[6]).toEqual(expect.objectContaining({
      type: 'message',
      visibility: 'private'
    }))
    expect(events[6]).not.toHaveProperty('publicSummary')
    expect(events[7]).toEqual(expect.objectContaining({
      type: 'session_completed',
      summary: 'Consumer finished.',
      visibility: 'room'
    }))
  })

  it('mirrors direct CLI sessions into the runtime store', async () => {
    const cwd = await createTempDir()
    const sink = await createCliRuntimeEventSink({
      adapter: 'codex',
      cwd,
      effort: 'high',
      message: 'Read README',
      model: 'gpt-5',
      permissionMode: 'bypassPermissions',
      sessionId: 'sess-cli-direct',
      title: 'Read README'
    })
    await sink.completeInitialPromptDelivery()

    await sink.handleAdapterEvent({
      type: 'init',
      data: {
        uuid: 'adapter-session',
        model: 'gpt-5',
        adapter: 'codex',
        version: '1.0.0',
        tools: [],
        slashCommands: [],
        cwd,
        agents: [],
        title: 'Read README'
      }
    })
    await sink.handleAdapterEvent({
      type: 'message',
      data: {
        id: 'transcript-user-1',
        role: 'user',
        content: 'Read README',
        createdAt: 150
      }
    })
    await sink.handleAdapterEvent({
      type: 'message',
      data: {
        id: 'assistant-1',
        role: 'assistant',
        content: 'README summary.',
        createdAt: 200
      }
    })
    await sink.handleAdapterEvent({ type: 'stop' })
    await sink.flush()

    const status = await readRuntimeStatus(cwd, 'sess-cli-direct')
    expect(status.meta).toEqual(expect.objectContaining({
      adapter: 'codex',
      cwd,
      model: 'gpt-5',
      permissionMode: 'bypassPermissions',
      sessionId: 'sess-cli-direct',
      title: 'Read README'
    }))
    expect(status.state).toEqual(expect.objectContaining({
      lastMessage: 'README summary.',
      status: 'completed'
    }))
    expect((await readRuntimeCommands(cwd, 'sess-cli-direct'))[0]).toEqual(expect.objectContaining({
      content: 'Read README',
      source: 'cli',
      type: 'start'
    }))
    expect((await readRuntimeEvents(cwd, 'sess-cli-direct')).map(event => event.type)).toEqual([
      'command_delivery_prepared',
      'command_delivery_accepted',
      'command_delivery_completed',
      'message',
      'command_ack',
      'session_started',
      'message',
      'session_completed'
    ])
  })

  it('mirrors interactive direct CLI user transcript messages into the runtime store', async () => {
    const cwd = await createTempDir()
    const sink = await createCliRuntimeEventSink({
      adapter: 'codex',
      cwd,
      model: 'gpt-5',
      sessionId: 'sess-cli-direct-interactive',
      title: 'sess-cli-direct-interactive'
    })

    await sink.handleAdapterEvent({
      type: 'init',
      data: {
        uuid: 'adapter-session',
        model: 'gpt-5',
        adapter: 'codex',
        version: '1.0.0',
        tools: [],
        slashCommands: [],
        cwd,
        agents: [],
        title: 'sess-cli-direct-interactive'
      }
    })
    await sink.handleAdapterEvent({
      type: 'message',
      data: {
        id: 'transcript-user-1',
        role: 'user',
        content: 'hi',
        createdAt: 150
      }
    })
    await sink.handleAdapterEvent({
      type: 'message',
      data: {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Hello.',
        createdAt: 200
      }
    })
    await sink.handleAdapterEvent({ type: 'stop' })
    await sink.flush()

    const events = await readRuntimeEvents(cwd, 'sess-cli-direct-interactive')
    expect(events.map(event => event.type)).toEqual([
      'session_started',
      'message',
      'message',
      'session_completed'
    ])
    expect(events[1]).toEqual(expect.objectContaining({
      type: 'message',
      role: 'user',
      content: 'hi'
    }))
    expect(events[2]).toEqual(expect.objectContaining({
      type: 'message',
      role: 'assistant',
      content: 'Hello.'
    }))
  })

  it('does not replay an already acked start command on runtime consumer startup', async () => {
    const cwd = await createTempDir()
    await createRuntimeSession({
      cwd,
      entity: 'dev',
      message: 'Start only once',
      sessionId: 'sess-consumer-startup-replay',
      now: () => 100
    })
    const commands = await readRuntimeCommands(cwd, 'sess-consumer-startup-replay')
    const firstSink = await createRuntimeEventSink({ cwd, sessionId: 'sess-consumer-startup-replay' })

    const firstStartup = await firstSink.recordStartup(commands)
    await firstSink.completeInitialPromptDelivery()
    await firstSink.flush()

    expect(firstStartup).toEqual(expect.objectContaining({
      startAlreadyAcked: false,
      startCommand: expect.objectContaining({ type: 'start' }),
      shouldRunInitialPrompt: true
    }))
    expect((await readRuntimeEvents(cwd, 'sess-consumer-startup-replay')).map(event => event.type)).toEqual([
      'command_delivery_prepared',
      'command_delivery_accepted',
      'command_delivery_completed',
      'message',
      'command_ack'
    ])

    const secondSink = await createRuntimeEventSink({ cwd, sessionId: 'sess-consumer-startup-replay' })
    const secondStartup = await secondSink.recordStartup(commands)
    await secondSink.flush()

    expect(secondStartup).toEqual(expect.objectContaining({
      startAlreadyAcked: true,
      startCommand: expect.objectContaining({ type: 'start' }),
      shouldRunInitialPrompt: false
    }))
    expect((await readRuntimeEvents(cwd, 'sess-consumer-startup-replay')).map(event => event.type)).toEqual([
      'command_delivery_prepared',
      'command_delivery_accepted',
      'command_delivery_completed',
      'message',
      'command_ack'
    ])
  })

  it('records permission context on runtime consumer interaction requests', async () => {
    const cwd = await createTempDir()
    await createRuntimeSession({
      cwd,
      entity: 'dev',
      message: 'Start consumer approval work',
      sessionId: 'sess-consumer-approval',
      now: () => 100
    })
    const sink = await createRuntimeEventSink({ cwd, sessionId: 'sess-consumer-approval' })

    await sink.handleAdapterEvent({
      type: 'interaction_request',
      data: {
        id: 'approval-context',
        payload: {
          sessionId: 'sess-consumer-approval',
          kind: 'permission',
          question: 'Allow Bash?',
          options: [
            { label: 'Allow once', value: 'allow_once' },
            { label: 'Deny once', value: 'deny_once' }
          ],
          permissionContext: {
            adapter: 'codex',
            deniedTools: ['Bash'],
            scope: 'tool',
            subjectKey: 'Bash',
            subjectLabel: 'Bash'
          }
        }
      }
    })
    await sink.flush()

    expect(await readRuntimeEvents(cwd, 'sess-consumer-approval')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'approval_requested',
        requestId: 'approval-context',
        kind: 'permission',
        permissionContext: expect.objectContaining({
          adapter: 'codex',
          deniedTools: ['Bash'],
          scope: 'tool',
          subjectKey: 'Bash',
          subjectLabel: 'Bash'
        })
      })
    ]))
  })

  it('records fatal runtime consumer errors as failed state', async () => {
    const cwd = await createTempDir()
    await createRuntimeSession({
      cwd,
      entity: 'dev',
      message: 'Start failing consumer work',
      sessionId: 'sess-consumer-failed',
      now: () => 100
    })
    const sink = await createRuntimeEventSink({ cwd, sessionId: 'sess-consumer-failed' })

    await sink.recordStartup(await readRuntimeCommands(cwd, 'sess-consumer-failed'))
    await sink.handleAdapterEvent({
      type: 'error',
      data: {
        message: 'adapter crashed',
        fatal: true
      }
    })
    await sink.flush()

    const status = await readRuntimeStatus(cwd, 'sess-consumer-failed')
    expect(status.state).toEqual(expect.objectContaining({
      status: 'failed',
      lastMessage: 'adapter crashed'
    }))
    expect(await readRuntimeEvents(cwd, 'sess-consumer-failed')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'session_failed',
          status: 'failed',
          summary: 'adapter crashed'
        })
      ])
    )
  })

  it('does not let stop or successful exit overwrite fatal runtime failures', async () => {
    const cwd = await createTempDir()
    await createRuntimeSession({
      cwd,
      entity: 'dev',
      message: 'Start failing consumer work',
      sessionId: 'sess-consumer-failed-terminal',
      now: () => 100
    })
    const sink = await createRuntimeEventSink({ cwd, sessionId: 'sess-consumer-failed-terminal' })

    await sink.recordStartup(await readRuntimeCommands(cwd, 'sess-consumer-failed-terminal'))
    await sink.completeInitialPromptDelivery()
    await sink.handleAdapterEvent({
      type: 'error',
      data: {
        message: 'adapter stream disconnected',
        fatal: true
      }
    })
    await sink.handleAdapterEvent({ type: 'stop' })
    await sink.handleAdapterEvent({ type: 'exit', data: { exitCode: 0 } })
    await sink.flush()

    const status = await readRuntimeStatus(cwd, 'sess-consumer-failed-terminal')
    expect(status.state).toEqual(expect.objectContaining({
      status: 'failed',
      lastMessage: 'adapter stream disconnected'
    }))
    expect((await readRuntimeEvents(cwd, 'sess-consumer-failed-terminal')).map(event => event.type)).toEqual([
      'command_delivery_prepared',
      'command_delivery_accepted',
      'command_delivery_completed',
      'message',
      'command_ack',
      'session_failed'
    ])
  })
})
