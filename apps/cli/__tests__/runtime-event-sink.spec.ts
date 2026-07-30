import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { AdapterStartupError } from '@oneworks/types'

import { readRuntimeEvents } from '#~/commands/agent/runtime-store.js'
import { createCliRuntimeEventSink } from '#~/commands/run/runtime-event-sink.js'

const tempDirs: string[] = []
const originalProjectHomeProjectsDir = process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__
const originalProjectWorkspaceFolder = process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__

const createTempDir = async () => {
  const cwd = await fs.mkdtemp(path.join(tmpdir(), 'ow-runtime-event-sink-'))
  await fs.writeFile(path.join(cwd, 'package.json'), '{"private":true}\n')
  process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(cwd, '.oneworks-projects')
  process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = cwd
  tempDirs.push(cwd)
  return cwd
}

afterEach(async () => {
  if (originalProjectHomeProjectsDir == null) {
    delete process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__
  } else {
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = originalProjectHomeProjectsDir
  }
  if (originalProjectWorkspaceFolder == null) {
    delete process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
  } else {
    process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = originalProjectWorkspaceFolder
  }
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })))
})

describe('runtime event sink', () => {
  it('records adapter CLI prepare operations for UI progress', async () => {
    const cwd = await createTempDir()
    const sessionId = 'sess-operation-progress'
    const sink = await createCliRuntimeEventSink({
      adapter: 'codex',
      cwd,
      sessionId,
      title: 'Operation progress'
    })

    await sink.recordOperation({
      type: 'operation_started',
      operationId: 'adapter-cli-prepare',
      title: 'Adapter CLI',
      message: 'Checking adapter CLI.'
    })
    await sink.recordOperation({
      type: 'operation_completed',
      operationId: 'adapter-cli-prepare',
      title: 'Adapter CLI',
      message: 'Adapter CLI is ready.'
    })
    await sink.flush()

    expect(await readRuntimeEvents(cwd, sessionId)).toEqual([
      expect.objectContaining({
        type: 'operation_started',
        operationId: 'adapter-cli-prepare',
        status: 'running',
        visibility: 'system'
      }),
      expect.objectContaining({
        type: 'operation_completed',
        operationId: 'adapter-cli-prepare',
        status: 'completed',
        visibility: 'system'
      })
    ])
  })

  it('records adapter operation output events for UI progress', async () => {
    const cwd = await createTempDir()
    const sessionId = 'sess-adapter-operation-progress'
    const sink = await createCliRuntimeEventSink({
      adapter: 'codex',
      cwd,
      sessionId,
      title: 'Adapter operation progress'
    })

    await sink.handleAdapterEvent({
      type: 'operation',
      data: {
        adapter: 'codex',
        type: 'operation_started',
        operationId: 'codex-turn-start',
        title: 'Starting Codex turn',
        message: '正在启动 Codex 首轮处理…'
      }
    })
    await sink.flush()

    expect(await readRuntimeEvents(cwd, sessionId)).toEqual([
      expect.objectContaining({
        type: 'operation_started',
        operationId: 'codex-turn-start',
        title: 'Starting Codex turn',
        message: '正在启动 Codex 首轮处理…',
        status: 'running',
        visibility: 'system'
      })
    ])
  })

  it('preserves structured adapter startup diagnostics in runtime failures', async () => {
    const cwd = await createTempDir()
    const sessionId = 'sess-project-config-failure'
    const sink = await createCliRuntimeEventSink({
      adapter: 'codex',
      cwd,
      message: 'Start Codex',
      sessionId,
      title: 'Project config failure'
    })

    await sink.recordFailure(new AdapterStartupError(
      'Codex could not parse the active workspace project config.',
      'codex_project_config_invalid',
      {
        adapter: 'codex',
        runtimeAdapter: 'codex',
        configPath: '.codex/config.toml',
        configSource: 'project',
        workspaceSource: 'active-session-workspace',
        workspaceFolder: cwd,
        sessionId,
        reason: 'wire_api is unsupported',
        line: 2,
        column: 3
      }
    ))
    await sink.flush()

    const events = await readRuntimeEvents(cwd, sessionId)
    const failure = events.find(event => event.type === 'session_failed')
    expect(failure).toEqual(expect.objectContaining({
      type: 'session_failed',
      status: 'failed',
      code: 'codex_project_config_invalid',
      causedByCommandId: expect.stringMatching(/^cmd_start_/),
      details: {
        adapter: 'codex',
        runtimeAdapter: 'codex',
        configPath: '.codex/config.toml',
        configSource: 'project',
        workspaceSource: 'active-session-workspace',
        workspaceFolder: cwd,
        sessionId,
        reason: 'wire_api is unsupported',
        line: 2,
        column: 3
      }
    }))
    // Startup failed before adapter acceptance, so its initial prompt remains
    // unacknowledged and can be replayed by the next at-least-once attempt.
    expect(events.find(event => event.type === 'command_ack')).toBeUndefined()
  })

  it('never persists arbitrary unknown or malformed known error details', async () => {
    const cwd = await createTempDir()
    const sessionId = 'sess-private-error-details'
    const sentinel = 'SENTINEL_RUNTIME_ERROR_SECRET'
    const sink = await createCliRuntimeEventSink({
      adapter: 'codex',
      cwd,
      sessionId
    })

    await sink.handleAdapterEvent({
      type: 'error',
      data: {
        code: 'future_adapter_error',
        details: { privateToken: sentinel },
        fatal: true,
        message: 'Unknown adapter failure'
      }
    })
    await sink.recordFailure(Object.assign(new Error('Malformed project config failure'), {
      code: 'codex_project_config_invalid',
      details: {
        configPath: '../../forged.toml',
        privateToken: sentinel
      }
    }))
    await sink.flush()

    const events = await readRuntimeEvents(cwd, sessionId)
    expect(events).toEqual([
      expect.objectContaining({
        code: 'future_adapter_error',
        message: 'Unknown adapter failure'
      }),
      expect.objectContaining({
        code: 'session_failed',
        message: 'Malformed project config failure'
      })
    ])
    expect(JSON.stringify(events)).not.toContain(sentinel)
    expect(events.every(event => !('details' in event))).toBe(true)
  })

  it('attributes a fatal failure to the exact latest send_message activation', async () => {
    const cwd = await createTempDir()
    const sessionId = 'sess-send-message-attempt'
    const sink = await createCliRuntimeEventSink({
      adapter: 'codex',
      cwd,
      sessionId
    })
    await sink.recordStartup([
      {
        protocolVersion: '1.0.0',
        id: 'cmd_start_old',
        ts: 1,
        sessionId,
        type: 'start',
        priority: 20,
        source: 'web',
        content: 'old prompt',
        message: 'old prompt'
      },
      {
        protocolVersion: '1.0.0',
        id: 'cmd_agent_room_message',
        ts: 2,
        sessionId,
        type: 'send_message',
        priority: 20,
        source: 'agent-room',
        content: 'new room turn',
        message: 'new room turn'
      }
    ])
    await sink.handleAdapterEvent({
      type: 'error',
      data: {
        code: 'adapter_runtime_failed',
        fatal: true,
        message: 'Room turn failed'
      }
    })
    await sink.flush()

    expect((await readRuntimeEvents(cwd, sessionId)).find(event =>
      event.type === 'session_failed'
    )).toEqual(expect.objectContaining({
      causedByCommandId: 'cmd_agent_room_message',
      code: 'adapter_runtime_failed'
    }))
  })
})
