/* eslint-disable max-lines -- protocol command coverage intentionally exercises multiple envelopes together */
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'

import { afterEach, describe, expect, it } from 'vitest'

import { getCurrentProtocolVersion } from '@oneworks/runtime-protocol'
import { resolveProjectHomePath } from '@oneworks/utils/ai-path'

import {
  appendRuntimeCommand,
  createRuntimeSession,
  readRuntimeCommands,
  readRuntimeEvents,
  readRuntimeStatus
} from '#~/commands/agent/runtime-store.js'
import {
  executeRuntimeProtocolCommand,
  runRuntimeProtocolStdio,
  shouldStartRuntimeConsumer,
  shouldStartRuntimeResumeConsumer
} from '#~/commands/run.js'
import { attachRuntimeCommandBridge } from '#~/commands/run/runtime-command-bridge.js'
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
    expect(shouldStartRuntimeConsumer({ type: 'session.start' } as any, {})).toBe(true)
    expect(shouldStartRuntimeConsumer({ type: 'session.start', background: false } as any, {})).toBe(false)
    expect(shouldStartRuntimeConsumer({ type: 'session.start' } as any, {
      ONEWORKS_RUNTIME_PROTOCOL_DISABLE_CONSUMER: '1'
    } as NodeJS.ProcessEnv)).toBe(false)
    expect(shouldStartRuntimeConsumer({ type: 'session.start' } as any, {
      __ONEWORKS_PROJECT_BASE_DIR__: '/runtime-base',
      __ONEWORKS_AGENT_ROOM_HOST_SESSION_ID__: 'host-session'
    } as NodeJS.ProcessEnv)).toBe(false)
    expect(shouldStartRuntimeConsumer({
      type: 'session.start',
      hostSessionId: 'host-session'
    } as any, {
      __ONEWORKS_PROJECT_BASE_DIR__: '/runtime-base'
    } as NodeJS.ProcessEnv)).toBe(false)
    expect(shouldStartRuntimeConsumer({ type: 'session.start' } as any, {
      __ONEWORKS_PROJECT_BASE_DIR__: '/runtime-base',
      ONEWORKS_RUNTIME_PROTOCOL_FORCE_LOCAL_CONSUMER: '1',
      __ONEWORKS_AGENT_ROOM_HOST_SESSION_ID__: 'host-session'
    } as NodeJS.ProcessEnv)).toBe(true)
    expect(shouldStartRuntimeConsumer({ type: 'session.start' } as any)).toBe(false)
  })

  it('starts a resume consumer for terminal follow-up messages', () => {
    expect(shouldStartRuntimeResumeConsumer({
      command: { type: 'session.message' } as any,
      env: {},
      status: 'completed'
    })).toBe(true)
    expect(shouldStartRuntimeResumeConsumer({
      command: { type: 'session.message' } as any,
      env: {},
      status: 'failed'
    })).toBe(true)
    expect(shouldStartRuntimeResumeConsumer({
      command: { type: 'session.message' } as any,
      env: {},
      status: 'running'
    })).toBe(false)
    expect(shouldStartRuntimeResumeConsumer({
      command: { background: false, type: 'session.message' } as any,
      env: {},
      status: 'completed'
    })).toBe(false)
    expect(shouldStartRuntimeResumeConsumer({
      command: { type: 'session.message' } as any,
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
      cwd,
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
        content: [{ type: 'file', path: '/tmp/spec.md' }]
      }
    ])
    expect((await readRuntimeEvents(cwd, sessionId)).map(event => event.type)).toEqual([
      'command_ack',
      'message'
    ])
  })

  it('acks initial prompt start commands without duplicating the projected user message', async () => {
    const cwd = await createTempDir()
    const sessionId = 'sess-initial-prompt-start'
    const storePath = resolveExpectedStorePath(cwd, sessionId)
    await fs.mkdir(storePath, { recursive: true })
    await fs.writeFile(
      path.join(storePath, 'commands.jsonl'),
      `${
        JSON.stringify({
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
    expect((await readRuntimeEvents(cwd, sessionId)).map(event => event.type)).toEqual([
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
      'command_ack',
      'message',
      'session_started',
      'message',
      'session_completed'
    ])
    expect(events[3]).toEqual(expect.objectContaining({
      type: 'message',
      visibility: 'private'
    }))
    expect(events[3]).not.toHaveProperty('publicSummary')
    expect(events[4]).toEqual(expect.objectContaining({
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
      'command_ack',
      'message',
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
    await firstSink.flush()

    expect(firstStartup).toEqual(expect.objectContaining({
      startAlreadyAcked: false,
      startCommand: expect.objectContaining({ type: 'start' }),
      shouldRunInitialPrompt: true
    }))
    expect((await readRuntimeEvents(cwd, 'sess-consumer-startup-replay')).map(event => event.type)).toEqual([
      'command_ack',
      'message'
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
      'command_ack',
      'message'
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
      'command_ack',
      'message',
      'session_failed'
    ])
  })
})
