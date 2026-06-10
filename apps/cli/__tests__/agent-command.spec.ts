import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveProjectHomePath } from '@oneworks/utils/ai-path'

import { registerAgentCommand } from '#~/commands/agent.js'
import {
  appendRuntimeCommand,
  appendRuntimeEventForTest,
  createRuntimeSession,
  readRuntimeCommands,
  readRuntimeEvents,
  readRuntimeStatus,
  resolveRuntimeSessionStore
} from '#~/commands/agent/runtime-store.js'

const tempDirs: string[] = []
const originalCwd = process.cwd()
const originalProjectWorkspaceFolder = process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
const originalProjectHomeProjectsDir = process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__

const createTempDir = async () => {
  const cwd = await fs.mkdtemp(path.join(tmpdir(), 'ow-agent-command-'))
  await fs.writeFile(path.join(cwd, 'package.json'), '{"private":true}\n')
  process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(cwd, '.oneworks-projects')
  process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = cwd
  tempDirs.push(cwd)
  return cwd
}

const resolveExpectedStorePath = (cwd: string, sessionId: string) => (
  resolveProjectHomePath(cwd, process.env, 'runtime', 'sessions', sessionId)
)

const createProgram = () => {
  const program = new Command()
  program.exitOverride()
  program.configureOutput({
    writeErr: () => {}
  })
  registerAgentCommand(program)
  return program
}

const withEnv = async (
  updates: Record<string, string | undefined>,
  fn: () => Promise<void>
) => {
  const previous = new Map<string, string | undefined>()
  const keys = new Set([
    ...Object.keys(updates),
    '__ONEWORKS_PROJECT_WORKSPACE_FOLDER__'
  ])
  for (const key of keys) {
    previous.set(key, process.env[key])
    const value = updates[key as keyof typeof updates]
    if (value == null) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    await fn()
  } finally {
    for (const [key, value] of previous) {
      if (value == null) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  process.chdir(originalCwd)
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

describe('agent runtime CLI commands', () => {
  it('preserves agent as an explicit root command', async () => {
    const { normalizeCliArgs } = await import('#~/cli-argv.js')
    expect(normalizeCliArgs(['agent', 'status', '--session', 'sess-1'])).toEqual([
      'agent',
      'status',
      '--session',
      'sess-1'
    ])
  })

  it('validates required command options', async () => {
    const program = createProgram()
    await expect(program.parseAsync(['agent', 'send', '--session', 'sess-1'], { from: 'user' }))
      .rejects
      .toMatchObject({
        code: expect.stringContaining('commander.')
      })
  })

  it('creates a runtime store and queues the start command', async () => {
    const cwd = await createTempDir()

    const result = await createRuntimeSession({
      cwd,
      entity: 'dev',
      title: 'Developer',
      message: 'Implement the CLI runtime protocol',
      sessionId: 'sess-dev',
      now: () => 100
    })

    expect(result).toEqual({
      sessionId: 'sess-dev',
      storePath: resolveExpectedStorePath(cwd, 'sess-dev'),
      status: 'starting',
      title: 'Developer'
    })

    const status = await readRuntimeStatus(cwd, 'sess-dev')
    expect(status.state).toEqual(expect.objectContaining({
      protocolVersion: expect.stringMatching(/^\d+\.\d+\.\d+/),
      supportedProtocolRange: expect.stringMatching(/^\^\d+\.0\.0$/),
      sessionId: 'sess-dev',
      status: 'starting',
      title: 'Developer',
      needsEngineConsumer: true
    }))

    expect(await readRuntimeCommands(cwd, 'sess-dev')).toEqual([
      expect.objectContaining({
        protocolVersion: expect.stringMatching(/^\d+\.\d+\.\d+/),
        supportedProtocolRange: expect.stringMatching(/^\^\d+\.0\.0$/),
        sessionId: 'sess-dev',
        type: 'start',
        priority: 20,
        source: 'cli',
        entity: 'dev',
        title: 'Developer',
        content: 'Implement the CLI runtime protocol'
      })
    ])
  })

  it('stores host session metadata for automatic room binding', async () => {
    const cwd = await createTempDir()

    const result = await createRuntimeSession({
      cwd,
      entity: 'dev',
      hostSessionId: 'host-session',
      parentSessionId: 'host-session',
      roomTitle: 'Host room',
      memberAvatar: 'DV',
      title: 'Implementer',
      message: 'Implement the feature',
      sessionId: 'sess-dev',
      now: () => 100
    })

    expect(result).toEqual(expect.objectContaining({
      hostSessionId: 'host-session',
      sessionId: 'sess-dev'
    }))

    const status = await readRuntimeStatus(cwd, 'sess-dev')
    expect(status.meta).toEqual(expect.objectContaining({
      hostSessionId: 'host-session',
      parentSessionId: 'host-session',
      roomTitle: 'Host room',
      memberKey: 'dev',
      memberAvatar: 'DV',
      memberKind: 'entity',
      memberLabel: 'dev',
      runId: 'sess-dev',
      runTitle: 'Implementer'
    }))
    expect(await readRuntimeCommands(cwd, 'sess-dev')).toEqual([
      expect.objectContaining({
        entity: 'dev',
        memberKey: 'dev',
        runId: 'sess-dev',
        title: 'Implementer'
      })
    ])
  })

  it('inherits host room hints from dedicated env when starting through the command', async () => {
    const cwd = await createTempDir()
    process.chdir(cwd)

    await withEnv({
      __ONEWORKS_AGENT_ROOM_HOST_SESSION_ID__: 'host-from-env',
      __ONEWORKS_AGENT_ROOM_ID__: 'room-from-env',
      __ONEWORKS_AGENT_ROOM_TITLE__: 'Room from env',
      __ONEWORKS_PROJECT_CTX_ID__: 'ctx-only'
    }, async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const program = createProgram()

      await program.parseAsync([
        'agent',
        'start',
        '--entity',
        'dev',
        '--title',
        'Developer',
        '--message',
        'Start delegated work',
        '--json'
      ], { from: 'user' })

      const output = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string) as { sessionId: string }
      const status = await readRuntimeStatus(cwd, output.sessionId)
      expect(status.meta).toEqual(expect.objectContaining({
        hostSessionId: 'host-from-env',
        parentSessionId: 'host-from-env',
        roomId: 'room-from-env',
        roomTitle: 'Room from env'
      }))
    })
  })

  it('keeps the agent send alias usable through the protocol writer', async () => {
    const cwd = await createTempDir()
    process.chdir(cwd)
    await createRuntimeSession({
      cwd,
      entity: 'dev',
      message: 'Start',
      sessionId: 'sess-agent-alias',
      now: () => 100
    })

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const program = createProgram()

    await program.parseAsync([
      'agent',
      'send',
      '--session',
      'sess-agent-alias',
      '--message',
      'Continue',
      '--json'
    ], { from: 'user' })

    expect(JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string)).toEqual(expect.objectContaining({
      ok: true,
      sessionId: 'sess-agent-alias',
      type: 'send_message'
    }))
    expect(await readRuntimeCommands(cwd, 'sess-agent-alias')).toEqual([
      expect.objectContaining({ type: 'start' }),
      expect.objectContaining({
        commandId: expect.stringMatching(/^cmdreq_/),
        content: 'Continue',
        type: 'send_message'
      })
    ])
  })

  it('prefers explicit host session and ignores generic ctx env for host binding', async () => {
    const cwd = await createTempDir()
    process.chdir(cwd)

    await withEnv({
      __ONEWORKS_AGENT_ROOM_HOST_SESSION_ID__: 'host-from-env',
      __ONEWORKS_AGENT_ROOM_ID__: undefined,
      __ONEWORKS_AGENT_ROOM_TITLE__: undefined,
      __ONEWORKS_PROJECT_CTX_ID__: 'ctx-only'
    }, async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const program = createProgram()

      await program.parseAsync([
        'agent',
        'start',
        '--entity',
        'qa',
        '--host-session',
        'explicit-host',
        '--message',
        'Verify delegated work',
        '--json'
      ], { from: 'user' })

      const output = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string) as { sessionId: string }
      const status = await readRuntimeStatus(cwd, output.sessionId)
      expect(status.meta).toEqual(expect.objectContaining({
        hostSessionId: 'explicit-host',
        parentSessionId: 'explicit-host'
      }))
      expect(status.meta?.hostSessionId).not.toBe('host-from-env')
      expect(status.meta?.hostSessionId).not.toBe('ctx-only')
    })
  })

  it('does not treat the generic ctx env as host session metadata', async () => {
    const cwd = await createTempDir()
    process.chdir(cwd)

    await withEnv({
      __ONEWORKS_AGENT_ROOM_HOST_SESSION_ID__: undefined,
      __ONEWORKS_AGENT_ROOM_ID__: undefined,
      __ONEWORKS_AGENT_ROOM_TITLE__: undefined,
      __ONEWORKS_PROJECT_CTX_ID__: 'ctx-only'
    }, async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const program = createProgram()

      await program.parseAsync([
        'agent',
        'start',
        '--entity',
        'dev',
        '--message',
        'Start standalone runtime',
        '--json'
      ], { from: 'user' })

      const output = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string) as { sessionId: string }
      const status = await readRuntimeStatus(cwd, output.sessionId)
      expect(status.meta?.hostSessionId).toBeUndefined()
      expect(status.meta?.parentSessionId).toBeUndefined()
    })
  })

  it('appends typed commands with protocol metadata and priorities', async () => {
    const cwd = await createTempDir()
    await createRuntimeSession({
      cwd,
      entity: 'qa',
      title: 'QA',
      message: 'Verify the flow',
      sessionId: 'sess-qa',
      now: () => 100
    })

    await appendRuntimeCommand({
      cwd,
      sessionId: 'sess-qa',
      type: 'send_message',
      message: 'Continue',
      now: () => 200
    })
    await appendRuntimeCommand({
      cwd,
      sessionId: 'sess-qa',
      type: 'submit_input',
      requestId: 'req-1',
      value: 'allow_once',
      now: () => 300
    })
    await appendRuntimeCommand({
      cwd,
      sessionId: 'sess-qa',
      type: 'kill',
      now: () => 400
    })
    await appendRuntimeCommand({
      cwd,
      sessionId: 'sess-qa',
      type: 'resume',
      message: 'Resume work',
      now: () => 500
    })
    await appendRuntimeCommand({
      cwd,
      sessionId: 'sess-qa',
      type: 'stop',
      now: () => 600
    })

    expect(await readRuntimeCommands(cwd, 'sess-qa')).toEqual([
      expect.objectContaining({ type: 'start' }),
      expect.objectContaining({
        id: expect.stringMatching(/^cmd_send_message_/),
        protocolVersion: expect.stringMatching(/^\d+\.\d+\.\d+/),
        supportedProtocolRange: expect.stringMatching(/^\^\d+\.0\.0$/),
        ts: 200,
        sessionId: 'sess-qa',
        type: 'send_message',
        priority: 20,
        source: 'cli',
        content: 'Continue'
      }),
      expect.objectContaining({
        type: 'submit_input',
        priority: 10,
        requestId: 'req-1',
        value: 'allow_once'
      }),
      expect.objectContaining({
        type: 'kill',
        priority: 0,
        mode: 'force'
      }),
      expect.objectContaining({
        type: 'resume',
        priority: 20,
        content: 'Resume work'
      }),
      expect.objectContaining({
        type: 'stop',
        priority: 0,
        mode: 'graceful'
      })
    ])
  })

  it('prints status and events as stable JSON and JSONL', async () => {
    const cwd = await createTempDir()
    process.chdir(cwd)
    await createRuntimeSession({
      cwd,
      entity: 'dev',
      title: 'Developer',
      message: 'Start',
      sessionId: 'sess-json',
      now: () => 100
    })
    await appendRuntimeEventForTest(cwd, 'sess-json', {
      protocolVersion: '2.0.3',
      id: 'evt-1',
      seq: 1,
      ts: 200,
      sessionId: 'sess-json',
      type: 'message',
      role: 'assistant',
      content: 'ready'
    })

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const program = createProgram()

    await program.parseAsync(['agent', 'status', '--session', 'sess-json', '--json'], { from: 'user' })
    const statusOutput = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string) as Awaited<
      ReturnType<typeof readRuntimeStatus>
    >
    expect(statusOutput).toEqual(expect.objectContaining({
      sessionId: 'sess-json',
      status: 'starting',
      title: 'Developer'
    }))

    await program.parseAsync(['agent', 'events', '--session', 'sess-json', '--jsonl'], { from: 'user' })
    expect(JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string)).toEqual(expect.objectContaining({
      id: 'evt-1',
      type: 'message',
      content: 'ready'
    }))

    expect(await readRuntimeEvents(cwd, 'sess-json')).toHaveLength(1)
  })

  it('allows concurrent send commands without taking the runtime owner lock', async () => {
    const cwd = await createTempDir()
    await createRuntimeSession({
      cwd,
      entity: 'dev',
      title: 'Developer',
      message: 'Start',
      sessionId: 'sess-concurrent',
      now: () => 100
    })

    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        appendRuntimeCommand({
          cwd,
          sessionId: 'sess-concurrent',
          type: 'send_message',
          message: `message-${index}`,
          now: () => 200 + index
        }))
    )

    const commands = await readRuntimeCommands(cwd, 'sess-concurrent')
    expect(commands.filter(command => command.type === 'send_message')).toHaveLength(5)

    const store = await resolveRuntimeSessionStore(cwd, 'sess-concurrent')
    await expect(fs.stat(path.resolve(store.locksPath, 'runtime-owner.lock'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })
})
