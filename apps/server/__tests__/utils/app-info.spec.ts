import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getServerAppInfo
} from '#~/utils/app-info.js'

const tempDirectories: string[] = []

const createPackageDirectory = async (packageInfo: Record<string, unknown>) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'oneworks-app-info-'))
  tempDirectories.push(directory)
  await writeFile(path.join(directory, 'package.json'), JSON.stringify(packageInfo), 'utf8')
  vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_DIR__', directory)
  return directory
}

describe.sequential('server app info', () => {
  afterEach(async () => {
    vi.unstubAllEnvs()
    await Promise.all(tempDirectories.splice(0).map(directory =>
      rm(directory, { force: true, recursive: true })
    ))
  })

  it('accepts whitespace-padded 0.0.0 package versions and falls through invalid candidates', async () => {
    await createPackageDirectory({ version: ' 0.0.0 ' })
    await expect(getServerAppInfo()).resolves.toMatchObject({ version: '0.0.0' })

    await createPackageDirectory({ version: ' 00.0.0 ' })
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_VERSION__', '2.3.4')
    await expect(getServerAppInfo()).resolves.toMatchObject({ version: '2.3.4' })
  })

  it('returns explicit reproducible build metadata through the public contract', async () => {
    await createPackageDirectory({ version: '1.2.3' })
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_COMMIT_HASH__', 'abcdef0123456789abcdef0123456789abcdef01')
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_BUILD_TIME__', '2026-07-30T08:09:10+08:00')

    await expect(getServerAppInfo()).resolves.toEqual({
      version: '1.2.3',
      build: {
        version: '1.2.3',
        commit: 'abcdef0123456789abcdef0123456789abcdef01',
        buildTime: '2026-07-30T00:09:10.000Z',
        buildTimeSource: 'build'
      }
    })
  })

  it('keeps legacy version while rejecting unsafe package metadata', async () => {
    await createPackageDirectory({
      version: '2.0.0',
      gitHead: '/Users/example/private/repository',
      oneworksBuild: {
        buildTime: 'token=super-secret'
      }
    })

    await expect(getServerAppInfo()).resolves.toEqual({
      version: '2.0.0',
      build: {
        version: '2.0.0',
        commit: null,
        buildTime: null,
        buildTimeSource: 'unavailable'
      }
    })
  })

  it('falls through invalid high-priority values to valid CI and package metadata', async () => {
    await createPackageDirectory({ version: '2.3.4' })
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_VERSION__', '01.2.3')
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_COMMIT_HASH__', 'not-a-commit')
    vi.stubEnv('ONEWORKS_SERVER_COMMIT_HASH', 'still-not-a-commit')
    vi.stubEnv('GITHUB_SHA', 'abcdef0123456789abcdef0123456789abcdef01')
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_BUILD_TIME__', '2026-02-30T00:00:00Z')
    vi.stubEnv('ONEWORKS_SERVER_BUILD_TIME', 'not-a-time')
    vi.stubEnv('SOURCE_DATE_EPOCH', '1785370150')

    await expect(getServerAppInfo()).resolves.toEqual({
      version: '2.3.4',
      build: {
        version: '2.3.4',
        commit: 'abcdef0123456789abcdef0123456789abcdef01',
        buildTime: '2026-07-30T00:09:10.000Z',
        buildTimeSource: 'build'
      }
    })
  })

  it('falls through invalid package build fields to a valid package gitHead', async () => {
    await createPackageDirectory({
      version: '2.3.4',
      gitHead: 'abcdef0123456789abcdef0123456789abcdef01',
      oneworksBuild: {
        buildTime: '2026-02-30T00:00:00Z',
        commit: 'not-a-commit'
      }
    })
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_COMMIT_HASH__', '')
    vi.stubEnv('ONEWORKS_SERVER_COMMIT_HASH', '')
    vi.stubEnv('GITHUB_SHA', '')
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_BUILD_TIME__', '')
    vi.stubEnv('ONEWORKS_SERVER_BUILD_TIME', '')
    vi.stubEnv('SOURCE_DATE_EPOCH', '')

    await expect(getServerAppInfo()).resolves.toMatchObject({
      version: '2.3.4',
      build: {
        version: '2.3.4',
        commit: 'abcdef0123456789abcdef0123456789abcdef01',
        buildTime: null,
        buildTimeSource: 'unavailable'
      }
    })
  })

})
