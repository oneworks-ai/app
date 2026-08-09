import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { FileDiagnosticJournal } from '@oneworks/diagnostics/node'
import { resolveProjectHomePath } from '@oneworks/utils'

import { createCliDiagnostics } from '../src/cli-diagnostics'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(directory => fs.rm(directory, { force: true, recursive: true })))
})

describe('cli diagnostics', () => {
  it('records a bounded command lifecycle without storing prompt argv', async () => {
    const cwd = await fs.mkdtemp(path.join(tmpdir(), 'oneworks-cli-diagnostics-'))
    tempDirs.push(cwd)
    const env = {
      __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: path.join(cwd, '.projects')
    }
    const diagnostics = createCliDiagnostics(['private prompt with token'], { cwd, env })

    diagnostics.stage('plugins.loaded')
    diagnostics.succeed()
    await diagnostics.flush()

    const directory = resolveProjectHomePath(cwd, env, 'diagnostics', 'cli')
    const events = new FileDiagnosticJournal({ directory }).readEvents()

    expect(events.map(event => event.operation.stage)).toEqual([
      undefined,
      'command.run',
      'plugins.loaded',
      'plugins.loaded'
    ])
    expect(events.at(-1)?.operation.outcome).toBe('success')
    expect(JSON.stringify(events)).not.toContain('private prompt')
    expect(JSON.stringify(events)).not.toContain('token')
  })
})
