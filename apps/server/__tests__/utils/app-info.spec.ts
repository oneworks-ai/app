import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { getServerAppInfo } from '#~/utils/app-info.js'

const tempDirs: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

describe('server app-info package identity', () => {
  it('reads metadata only from the exact whitespace-bearing package directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-app-info-'))
    tempDirs.push(root)
    const exactPackageDir = join(root, 'server ')
    const adjacentPackageDir = join(root, 'server')
    await mkdir(exactPackageDir)
    await mkdir(adjacentPackageDir)
    await writeFile(
      join(exactPackageDir, 'package.json'),
      JSON.stringify({ version: '9.1.0', lastReleaseAt: '2026-08-11T00:00:00.000Z' })
    )
    await writeFile(
      join(adjacentPackageDir, 'package.json'),
      JSON.stringify({ version: '0.0.1', lastReleaseAt: '2000-01-01T00:00:00.000Z' })
    )
    vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_DIR__', exactPackageDir)

    await expect(getServerAppInfo()).resolves.toEqual({
      version: '9.1.0',
      lastReleaseAt: '2026-08-11T00:00:00.000Z'
    })
  })
})
