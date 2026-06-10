import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { checkRuntimePackage, installRuntimePackage } from '../src/runtime-package'

describe('bootstrap runtime package commands', () => {
  const originalPath = process.env.PATH
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-bootstrap-runtime-'))
    vi.restoreAllMocks()
    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', tempDir)
    vi.stubEnv('ONEWORKS_BOOTSTRAP_DISABLE_BACKGROUND_REFRESH', '1')
    vi.stubEnv('ONEWORKS_BOOTSTRAP_PACKAGE_CACHE_FIRST', '0')
    await installFakeNpm()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await rm(tempDir, { force: true, recursive: true })
  })

  const writeCachedPackage = async (packageName: string, version: string) => {
    const sanitizedName = packageName.replace(/^@/, '').replace(/[\\/]/g, '__')
    const packageDir = path.join(
      tempDir,
      '.oneworks/bootstrap/npm',
      sanitizedName,
      version,
      'node_modules',
      ...packageName.split('/')
    )
    await mkdir(packageDir, { recursive: true })
    await writeFile(
      path.join(packageDir, 'package.json'),
      JSON.stringify({ name: packageName, version }),
      'utf8'
    )
  }

  const installFakeNpm = async () => {
    const binDir = path.join(tempDir, 'bin')
    const npmBin = path.join(binDir, 'npm')
    await mkdir(binDir, { recursive: true })
    await writeFile(
      npmBin,
      `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const version = process.env.ONEWORKS_TEST_NPM_VERSION || '2.0.0'
const parsePackageSpec = (spec) => {
  const lastAt = spec.lastIndexOf('@')
  return {
    packageName: spec.slice(0, lastAt),
    version: spec.slice(lastAt + 1)
  }
}
if (process.argv[2] === 'view') {
  process.stdout.write(JSON.stringify(version) + '\\n')
  process.exit(0)
}
if (process.argv[2] === 'install') {
  const prefix = process.argv[process.argv.indexOf('--prefix') + 1]
  const spec = process.argv[process.argv.length - 1]
  const parsed = parsePackageSpec(spec)
  const packageDir = path.join(prefix, 'node_modules', ...parsed.packageName.split('/'))
  fs.mkdirSync(packageDir, { recursive: true })
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({
    name: parsed.packageName,
    version: parsed.version
  }))
  process.exit(0)
}
process.exit(1)
`,
      'utf8'
    )
    await chmod(npmBin, 0o755)
    vi.stubEnv('PATH', [binDir, originalPath].filter(Boolean).join(path.delimiter))
  }

  it('checks the published CLI version against the bootstrap cache', async () => {
    await writeCachedPackage('@oneworks/cli', '1.0.0')
    vi.stubEnv('ONEWORKS_TEST_NPM_VERSION', '2.0.0')

    await expect(checkRuntimePackage('cli')).resolves.toMatchObject({
      installedVersion: '1.0.0',
      latestVersion: '2.0.0',
      packageName: '@oneworks/cli',
      updateAvailable: true
    })
  })

  it('checks the server runtime package target', async () => {
    await writeCachedPackage('@oneworks/server', '1.0.0')
    vi.stubEnv('ONEWORKS_TEST_NPM_VERSION', '2.0.0')

    await expect(checkRuntimePackage('server')).resolves.toMatchObject({
      installedVersion: '1.0.0',
      latestVersion: '2.0.0',
      packageName: '@oneworks/server',
      target: 'server',
      updateAvailable: true
    })
  })

  it('reports an empty runtime package cache without installing anything on check', async () => {
    vi.stubEnv('ONEWORKS_TEST_NPM_VERSION', '2.0.0')

    await expect(checkRuntimePackage('server')).resolves.toMatchObject({
      installed: false,
      latestInstalled: false,
      latestVersion: '2.0.0',
      packageName: '@oneworks/server',
      target: 'server',
      updateAvailable: true
    })
  })

  it('checks an explicit runtime package version without resolving latest', async () => {
    await writeCachedPackage('@oneworks/server', '1.0.0')
    vi.stubEnv('ONEWORKS_TEST_NPM_VERSION', '2.0.0')

    await expect(checkRuntimePackage('server', { version: '1.0.0' })).resolves.toMatchObject({
      installedVersion: '1.0.0',
      latestInstalled: true,
      latestVersion: '1.0.0',
      packageName: '@oneworks/server',
      requestedVersion: '1.0.0',
      target: 'server',
      updateAvailable: false
    })
  })

  it('installs the latest CLI version into the bootstrap cache', async () => {
    vi.stubEnv('ONEWORKS_TEST_NPM_VERSION', '2.1.0')

    await expect(installRuntimePackage('cli')).resolves.toMatchObject({
      installedVersion: '2.1.0',
      latestInstalled: true,
      latestVersion: '2.1.0',
      updateAvailable: false
    })
  })

  it('installs an explicit runtime package version into the bootstrap cache', async () => {
    vi.stubEnv('ONEWORKS_TEST_NPM_VERSION', '9.9.9')

    await expect(installRuntimePackage('client', { version: '2.2.0' })).resolves.toMatchObject({
      installedVersion: '2.2.0',
      latestInstalled: true,
      latestVersion: '2.2.0',
      packageName: '@oneworks/client',
      requestedVersion: '2.2.0',
      target: 'client',
      updateAvailable: false
    })
  })

  it('honors the configured package cache root for runtime packages', async () => {
    const packageCacheRoot = path.join(tempDir, 'package-cache')
    vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__', packageCacheRoot)
    vi.stubEnv('ONEWORKS_TEST_NPM_VERSION', '8.8.8')

    await expect(installRuntimePackage('server', { version: '2.2.0' })).resolves.toMatchObject({
      installedVersion: '2.2.0',
      latestInstalled: true,
      packageName: '@oneworks/server'
    })
    await expect(
      writeFile(
        path.join(
          packageCacheRoot,
          'npm',
          'oneworks__server',
          '2.2.0',
          'node_modules',
          '@oneworks',
          'server',
          'probe'
        ),
        'ok'
      )
    ).resolves.toBeUndefined()
  })

  it('installs the latest client runtime package target', async () => {
    vi.stubEnv('ONEWORKS_TEST_NPM_VERSION', '2.2.0')

    await expect(installRuntimePackage('client')).resolves.toMatchObject({
      installedVersion: '2.2.0',
      latestInstalled: true,
      latestVersion: '2.2.0',
      packageName: '@oneworks/client',
      target: 'client',
      updateAvailable: false
    })
  })

  it('rejects non-exact runtime package versions', async () => {
    await expect(checkRuntimePackage('cli', { version: 'latest' })).rejects.toThrow(
      'Runtime package version must be an exact semver version'
    )
  })
})
