import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

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

  it('keeps cumulative usage and final cost on the terminal runtime event', async () => {
    const cwd = await createTempDir()
    const sessionId = 'sess-stop-usage'
    const sink = await createCliRuntimeEventSink({
      adapter: 'claude-code',
      cwd,
      model: 'kimi-api,kimi-k2.5',
      sessionId,
      title: 'Stop usage'
    })

    await sink.handleAdapterEvent({
      type: 'stop',
      data: {
        id: 'claude-stop',
        role: 'assistant',
        content: 'done',
        createdAt: 1_800_000_000_000,
        model: 'kimi-k2.5',
        usage: {
          input_tokens: 120,
          output_tokens: 30,
          aggregation_mode: 'cumulative',
          quality: 'provider_reported',
          total_cost_usd: 0.42
        }
      }
    })
    await sink.flush()

    expect(await readRuntimeEvents(cwd, sessionId)).toEqual([
      expect.objectContaining({
        type: 'session_completed',
        model: 'kimi-k2.5',
        usage: expect.objectContaining({
          aggregationMode: 'cumulative',
          costUsd: 0.42,
          inputTokens: 120,
          model: 'kimi-k2.5',
          modelService: 'kimi-api',
          outputTokens: 30,
          quality: 'provider_reported'
        })
      })
    ])
  })
})
