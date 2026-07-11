import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it } from 'vitest'

import { runWithCrossProcessLockSync } from '../dev-start/file-lock'
import { repoRoot } from '../dev-start/paths'

describe('dev service state CAS', () => {
  let tempDir = ''

  afterEach(async () => {
    if (tempDir !== '') await rm(tempDir, { recursive: true, force: true })
  })

  it('does not let a stale readiness revision overwrite a newer failed phase', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'oneworks-state-cas-'))
    const path = join(tempDir, 'state.json')
    const helper = join(repoRoot, 'scripts/dev-start/state-mutation-helper.mjs')
    const mutate = (input: Record<string, unknown>) =>
      JSON.parse(runWithCrossProcessLockSync({
        args: [helper],
        command: process.execPath,
        input: JSON.stringify({
          mode: 'merge',
          path,
          root: repoRoot,
          scope: 'worktree',
          target: 'daemon',
          ...input
        }),
        path: `${path}.mutation`
      })) as { matched: boolean; state?: { revision: number } }

    const starting = mutate({
      value: { generation: 'generation-1', phase: 'ready', servicePid: 123 }
    })
    expect(starting.state?.revision).toBe(1)
    const failed = mutate({
      expected: { generation: 'generation-1', phase: 'ready', revision: 1 },
      value: { phase: 'failed' }
    })
    expect(failed.state?.revision).toBe(2)
    const staleReady = mutate({
      expected: { generation: 'generation-1', phase: 'ready', revision: 1 },
      value: { phase: 'ready' }
    })
    expect(staleReady.matched).toBe(false)
    const state = JSON.parse(await readFile(path, 'utf8')) as { phase: string; revision: number }
    expect(state).toMatchObject({ phase: 'failed', revision: 2 })
  })
})
