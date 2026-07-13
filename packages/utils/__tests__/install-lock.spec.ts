import { lstat, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { describe, expect, it } from 'vitest'

import { DirectoryInstallLockBusyError, withDirectoryInstallLock } from '../src/install-lock'

describe('directory install lock', () => {
  it('keeps a fresh owner lock when a fail-fast contender cannot see metadata yet', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'oneworks-install-lock-'))
    const lockDir = path.join(root, 'locks', 'skill-import')

    try {
      await mkdir(lockDir, { recursive: true })
      await delay(25)
      let contenderEntered = false

      const error = await withDirectoryInstallLock({
        lockDir,
        waitTimeoutMs: 0
      }, async () => {
        contenderEntered = true
      }).then(
        () => undefined,
        reason => reason
      )

      expect(error).toBeInstanceOf(DirectoryInstallLockBusyError)
      expect(error).toMatchObject({ lockDir })
      expect(contenderEntered).toBe(false)
      expect((await lstat(lockDir)).isDirectory()).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
