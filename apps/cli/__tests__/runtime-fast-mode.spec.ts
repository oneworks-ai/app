import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createRuntimeSession, readRuntimeCommands, readRuntimeStatus } from '#~/commands/agent/runtime-store.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })))
})

describe('runtime Fast mode metadata', () => {
  it('persists extended effort and Fast mode in metadata and the start command', async () => {
    const cwd = await fs.mkdtemp(path.join(tmpdir(), 'ow-runtime-fast-mode-'))
    tempDirs.push(cwd)
    await fs.writeFile(path.join(cwd, 'package.json'), '{"private":true}\n')
    const env = {
      ...process.env,
      __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: path.join(cwd, '.oneworks-projects')
    }

    await createRuntimeSession({
      cwd,
      env,
      entity: 'dev',
      effort: 'ultra',
      fastMode: true,
      message: 'Run in Fast mode',
      now: () => 100,
      sessionId: 'sess-fast-mode'
    })

    expect((await readRuntimeStatus(cwd, 'sess-fast-mode', env)).meta).toEqual(expect.objectContaining({
      effort: 'ultra',
      fastMode: true
    }))
    expect(await readRuntimeCommands(cwd, 'sess-fast-mode', env)).toEqual([
      expect.objectContaining({ effort: 'ultra', fastMode: true, type: 'start' })
    ])
  })
})
