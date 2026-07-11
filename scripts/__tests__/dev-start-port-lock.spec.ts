import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { withDevStartLifecycleLock, withDevStartPortLock, withDevStartPreparationLock } from '../dev-start/port-lock'

describe('dev-start global port lock', () => {
  const previousRealHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__
  let tempDir = ''

  afterEach(async () => {
    if (previousRealHome == null) delete process.env.__ONEWORKS_PROJECT_REAL_HOME__
    else process.env.__ONEWORKS_PROJECT_REAL_HOME__ = previousRealHome
    if (tempDir !== '') await rm(tempDir, { recursive: true, force: true })
  })

  it('keeps concurrent port allocation serialized', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'oneworks-port-lock-'))
    process.env.__ONEWORKS_PROJECT_REAL_HOME__ = tempDir
    let active = 0
    let maximumActive = 0
    const run = async () => {
      await withDevStartPortLock(async () => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await new Promise(resolve => setTimeout(resolve, 30))
        active -= 1
      })
    }
    await Promise.all([run(), run()])
    expect(maximumActive).toBe(1)
  })

  it('serializes worktree preparation across different targets', async () => {
    let active = 0
    let maximumActive = 0
    const run = async () => {
      await withDevStartPreparationLock(async () => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await new Promise(resolve => setTimeout(resolve, 30))
        active -= 1
      })
    }
    await Promise.all([run(), run()])
    expect(maximumActive).toBe(1)
  })

  it('keeps each worktree mutation lifecycle in one source consistency boundary', async () => {
    let active = 0
    let maximumActive = 0
    const run = async () => {
      await withDevStartLifecycleLock(async () => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await new Promise(resolve => setTimeout(resolve, 30))
        active -= 1
      })
    }
    await Promise.all([run(), run()])
    expect(maximumActive).toBe(1)
  })
})
