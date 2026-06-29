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
})
