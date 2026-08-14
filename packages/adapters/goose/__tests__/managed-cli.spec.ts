import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

import type { AdapterCtx } from '@oneworks/types'

import {
  assertArchiveEntriesAreContained,
  assertArchiveEntryTypesAreSafe,
  ensureGooseCli,
  installManagedGooseCli,
  probeGooseBinary,
  resolveInstalledGooseCli
} from '../src/managed-cli'
import { normalizeGooseReleaseVersion, resolveGooseManagedBinaryPath, resolveGooseReleaseTarget } from '../src/paths'

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const createContext = (root: string) =>
  ({
    cwd: root,
    env: { __ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__: resolve(root, 'cache') },
    logger: {
      debug: () => undefined,
      error: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      stream: process.stderr
    }
  }) as Pick<AdapterCtx, 'env' | 'logger'>

const makeReleaseArchive = async (root: string) => {
  const payloadDir = resolve(root, 'release-payload')
  const binaryPath = resolve(payloadDir, 'goose')
  const archivePath = resolve(root, 'goose-release.tar.bz2')
  await mkdir(payloadDir)
  await writeFile(binaryPath, '#!/bin/sh\necho "goose 1.46.0"\n', 'utf8')
  await chmod(binaryPath, 0o755)
  await execFileAsync('tar', ['-cjf', archivePath, '-C', payloadDir, 'goose'])
  const digest = createHash('sha256').update(await readFile(archivePath)).digest('hex')
  return { archivePath, digest }
}

const createInstallDependencies = (archivePath: string, digest: string) => ({
  arch: 'arm64' as const,
  platform: 'darwin' as const,
  fetch: async () =>
    new Response(
      JSON.stringify({
        assets: [{
          name: 'goose-aarch64-apple-darwin.tar.bz2',
          browser_download_url:
            'https://github.com/aaif-goose/goose/releases/download/v1.46.0/goose-aarch64-apple-darwin.tar.bz2',
          digest: `sha256:${digest}`
        }]
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    ),
  execFile: async (command: string, args: readonly string[], options: unknown) => {
    if (command === 'curl') {
      const outputIndex = args.indexOf('--output')
      await cp(archivePath, String(args[outputIndex + 1]))
      return { stdout: '', stderr: '' }
    }
    return await execFileAsync(command, [...args], options as never)
  }
})

const readVersionsDir = async (root: string) => (
  await readdir(resolve(root, 'cache', 'native', 'goose', 'versions')).catch(() => [])
)

describe('goose official release installer', () => {
  it('validates safe versions and official platform/architecture/variant mappings', () => {
    expect(normalizeGooseReleaseVersion('v1.46.0')).toBe('1.46.0')
    for (const invalid of ['latest', '../1.46.0', '1.46.0/next', '/1.46.0', '1.46.0\\next']) {
      expect(() => normalizeGooseReleaseVersion(invalid)).toThrow('Invalid Goose CLI version')
    }
    expect(resolveGooseReleaseTarget({ platform: 'darwin', arch: 'arm64' }).assetName)
      .toBe('goose-aarch64-apple-darwin.tar.bz2')
    expect(resolveGooseReleaseTarget({ platform: 'linux', arch: 'x64', variant: 'musl' }).assetName)
      .toBe('goose-x86_64-unknown-linux-musl.tar.bz2')
    expect(resolveGooseReleaseTarget({ platform: 'win32', arch: 'x64', variant: 'cuda' }).assetName)
      .toBe('goose-x86_64-pc-windows-msvc-cuda.zip')
    expect(() => resolveGooseReleaseTarget({ platform: 'win32', arch: 'arm64' })).toThrow('unsupported')
    expect(() => resolveGooseReleaseTarget({ platform: 'darwin', arch: 'arm64', variant: 'musl' }))
      .toThrow('unsupported')
  })

  it('preserves prerelease identity exactly and ignores only reported build metadata', async () => {
    const probe = (reported: string, expectedVersion: string) =>
      probeGooseBinary({
        binaryPath: '/fixture/goose',
        env: {},
        exec: (async () => ({ stdout: `goose ${reported}\n`, stderr: '' })) as never,
        expectedVersion
      })

    await expect(probe('1.46.0-rc.1', '1.46.0-rc.1')).resolves.toBe('1.46.0-rc.1')
    await expect(probe('1.46.0', '1.46.0-rc.1')).resolves.toBeUndefined()
    await expect(probe('1.46.0-rc.2', '1.46.0-rc.1')).resolves.toBeUndefined()
    await expect(probe('1.46.0+official.7', '1.46.0')).resolves.toBe('1.46.0')
    expect(() => normalizeGooseReleaseVersion('1.46.0+build.7')).toThrow('Invalid Goose CLI version')
  })

  it('rejects absolute and parent-traversal archive entries before extraction', () => {
    expect(() => assertArchiveEntriesAreContained('goose\nassets/readme.txt\n')).not.toThrow()
    expect(() => assertArchiveEntriesAreContained('../goose\n')).toThrow('unsafe path')
    expect(() => assertArchiveEntriesAreContained('/tmp/goose\n')).toThrow('unsafe path')
    expect(() => assertArchiveEntriesAreContained('C:\\temp\\goose.exe\n')).toThrow('unsafe path')
    expect(() => assertArchiveEntryTypesAreSafe('-rwxr-xr-x 0 user group 0 Aug 13 12:00 goose\n')).not.toThrow()
    expect(() => assertArchiveEntryTypesAreSafe('lrwxr-xr-x 0 user group 0 Aug 13 12:00 goose -> /bin/true\n'))
      .toThrow('link or special file')
  })

  it('verifies the official digest, probes the binary, and atomically installs the staged directory', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'oneworks-goose-install-'))
    tempDirs.push(root)
    const release = await makeReleaseArchive(root)
    const ctx = createContext(root)
    const dependencies = createInstallDependencies(release.archivePath, release.digest)
    const finalBinary = resolveGooseManagedBinaryPath({
      env: ctx.env,
      target: resolveGooseReleaseTarget({ platform: 'darwin', arch: 'arm64' }),
      version: '1.46.0'
    })
    await mkdir(dirname(finalBinary), { recursive: true })
    await writeFile(finalBinary, '#!/bin/sh\necho "goose 1.45.0"\n', 'utf8')
    await chmod(finalBinary, 0o755)

    const binaryPath = await installManagedGooseCli({
      ctx,
      dependencies: dependencies as never,
      version: '1.46.0'
    })

    expect(binaryPath).toBe(finalBinary)
    expect((await execFileAsync(binaryPath, ['--version'])).stdout.trim()).toBe('goose 1.46.0')
    expect((await readdir(dirname(binaryPath))).includes('goose')).toBe(true)
    expect((await readdir(dirname(dirname(dirname(binaryPath))))).some(name => name.startsWith('.goose-install-')))
      .toBe(false)
    expect((await readdir(dirname(dirname(binaryPath)))).some(name => name.includes('.previous-'))).toBe(false)
  })

  it.each([
    ['missing assets array', { unexpected: true }, 'invalid asset metadata'],
    ['asset name mismatch', { assets: [{ name: 'goose-wrong.tar.bz2' }] }, 'does not contain'],
    ['missing digest', {
      assets: [{
        name: 'goose-aarch64-apple-darwin.tar.bz2',
        browser_download_url:
          'https://github.com/aaif-goose/goose/releases/download/v1.46.0/goose-aarch64-apple-darwin.tar.bz2'
      }]
    }, 'did not publish a valid sha256 digest'],
    ['invalid digest', {
      assets: [{
        name: 'goose-aarch64-apple-darwin.tar.bz2',
        browser_download_url:
          'https://github.com/aaif-goose/goose/releases/download/v1.46.0/goose-aarch64-apple-darwin.tar.bz2',
        digest: 'sha256:not-a-digest'
      }]
    }, 'did not publish a valid sha256 digest'],
    ['untrusted asset URL', {
      assets: [{
        name: 'goose-aarch64-apple-darwin.tar.bz2',
        browser_download_url: 'https://example.com/goose.tar.bz2',
        digest: `sha256:${'0'.repeat(64)}`
      }]
    }, 'untrusted download URL'],
    ['mismatched trusted asset URL', {
      assets: [{
        name: 'goose-aarch64-apple-darwin.tar.bz2',
        browser_download_url:
          'https://github.com/aaif-goose/goose/releases/download/v1.45.0/goose-aarch64-apple-darwin.tar.bz2',
        digest: `sha256:${'0'.repeat(64)}`
      }]
    }, 'untrusted download URL']
  ])('fails closed on %s release metadata', async (_label, metadata, expected) => {
    const root = await mkdtemp(resolve(tmpdir(), 'oneworks-goose-metadata-'))
    tempDirs.push(root)
    const ctx = createContext(root)
    await expect(installManagedGooseCli({
      ctx,
      dependencies: {
        arch: 'arm64',
        platform: 'darwin',
        fetch: async () => new Response(JSON.stringify(metadata), { status: 200 })
      },
      version: '1.46.0'
    })).rejects.toThrow(expected)
    expect(await readVersionsDir(root)).toEqual([])
  })

  it('cleans staging and leaves no final binary when checksum verification fails', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'oneworks-goose-bad-digest-'))
    tempDirs.push(root)
    const release = await makeReleaseArchive(root)
    const ctx = createContext(root)
    const dependencies = createInstallDependencies(release.archivePath, '0'.repeat(64))

    await expect(installManagedGooseCli({
      ctx,
      dependencies: dependencies as never,
      version: '1.46.0'
    })).rejects.toThrow('checksum mismatch')

    expect(await readVersionsDir(root)).toEqual([])
  })

  it('cleans a partial download and never extracts it', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'oneworks-goose-partial-download-'))
    tempDirs.push(root)
    const release = await makeReleaseArchive(root)
    const ctx = createContext(root)
    const base = createInstallDependencies(release.archivePath, release.digest)
    let extractionAttempted = false
    await expect(installManagedGooseCli({
      ctx,
      dependencies: {
        ...base,
        execFile: async (command: string, args: readonly string[], options: unknown) => {
          if (command === 'curl') {
            const outputIndex = args.indexOf('--output')
            await writeFile(String(args[outputIndex + 1]), 'partial', 'utf8')
            throw new Error('connection interrupted')
          }
          if (command === 'tar') extractionAttempted = true
          return await execFileAsync(command, [...args], options as never)
        }
      } as never,
      version: '1.46.0'
    })).rejects.toThrow('connection interrupted')
    expect(extractionAttempted).toBe(false)
    expect(await readVersionsDir(root)).toEqual([])
  })

  it('rejects an archive traversal listing before extraction and cleans staging', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'oneworks-goose-traversal-'))
    tempDirs.push(root)
    const release = await makeReleaseArchive(root)
    const ctx = createContext(root)
    const base = createInstallDependencies(release.archivePath, release.digest)
    let extractionAttempted = false
    await expect(installManagedGooseCli({
      ctx,
      dependencies: {
        ...base,
        execFile: async (command: string, args: readonly string[], options: unknown) => {
          if (command === 'curl') return await base.execFile(command, args, options)
          if (command === 'tar' && args[0] === '-tf') return { stdout: '../goose\n', stderr: '' }
          if (command === 'tar' && args[0] === '-xf') extractionAttempted = true
          return await execFileAsync(command, [...args], options as never)
        }
      } as never,
      version: '1.46.0'
    })).rejects.toThrow('unsafe path')
    expect(extractionAttempted).toBe(false)
    expect(await readVersionsDir(root)).toEqual([])
  })

  it('rejects symlinks from an otherwise contained archive before extraction', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'oneworks-goose-symlink-'))
    tempDirs.push(root)
    const payloadDir = resolve(root, 'symlink-payload')
    const archivePath = resolve(root, 'goose-symlink.tar.bz2')
    await mkdir(payloadDir)
    await symlink('/usr/bin/true', resolve(payloadDir, 'goose'))
    await execFileAsync('tar', ['-cjf', archivePath, '-C', payloadDir, 'goose'])
    const digest = createHash('sha256').update(await readFile(archivePath)).digest('hex')
    const ctx = createContext(root)
    const base = createInstallDependencies(archivePath, digest)
    let extractionAttempted = false

    await expect(installManagedGooseCli({
      ctx,
      dependencies: {
        ...base,
        execFile: async (command: string, args: readonly string[], options: unknown) => {
          if (command === 'tar' && args[0] === '-xf') extractionAttempted = true
          return await base.execFile(command, args, options)
        }
      } as never,
      version: '1.46.0'
    })).rejects.toThrow('link or special file')
    expect(extractionAttempted).toBe(false)
    expect(await readVersionsDir(root)).toEqual([])
  })

  it('serializes concurrent prepares and downloads one verified release', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'oneworks-goose-concurrent-'))
    tempDirs.push(root)
    const release = await makeReleaseArchive(root)
    const ctx = createContext(root)
    const base = createInstallDependencies(release.archivePath, release.digest)
    let downloadCount = 0
    const dependencies = {
      ...base,
      execFile: async (command: string, args: readonly string[], options: unknown) => {
        if (command === 'curl') downloadCount += 1
        return await base.execFile(command, args, options)
      }
    }

    const results = await Promise.all([
      installManagedGooseCli({ ctx, dependencies: dependencies as never, version: '1.46.0' }),
      installManagedGooseCli({ ctx, dependencies: dependencies as never, version: '1.46.0' })
    ])
    expect(results[0]).toBe(results[1])
    expect(downloadCount).toBe(1)
  }, 15_000)

  it('rolls an invalid final replacement back to the previous installation', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'oneworks-goose-rollback-'))
    tempDirs.push(root)
    const release = await makeReleaseArchive(root)
    const ctx = createContext(root)
    const target = resolveGooseReleaseTarget({ platform: 'darwin', arch: 'arm64' })
    const finalBinary = resolveGooseManagedBinaryPath({ env: ctx.env, target, version: '1.46.0' })
    await mkdir(dirname(finalBinary), { recursive: true })
    await writeFile(finalBinary, '#!/bin/sh\necho "goose 1.45.0"\n', 'utf8')
    await chmod(finalBinary, 0o755)
    const base = createInstallDependencies(release.archivePath, release.digest)

    await expect(installManagedGooseCli({
      ctx,
      dependencies: {
        ...base,
        execFile: async (command: string, args: readonly string[], options: unknown) => {
          if (command === finalBinary && args[0] === '--version') {
            return { stdout: 'goose 1.45.0\n', stderr: '' }
          }
          return await base.execFile(command, args, options)
        }
      } as never,
      version: '1.46.0'
    })).rejects.toThrow('final version verification')
    expect((await execFileAsync(finalBinary, ['--version'])).stdout.trim()).toBe('goose 1.45.0')
    expect((await readdir(dirname(dirname(finalBinary)))).some(name => name.includes('.previous-'))).toBe(false)
  })

  it('accepts an absolute path source only after the minimum-version probe', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'oneworks-goose-path-'))
    tempDirs.push(root)
    const binaryPath = resolve(root, 'goose')
    await writeFile(binaryPath, '#!/bin/sh\necho "goose 1.46.0"\n', 'utf8')
    await chmod(binaryPath, 0o755)
    const ctx = {
      ...createContext(root),
      cache: { get: async () => undefined, set: async () => ({ cachePath: '' }) },
      configs: []
    } as unknown as AdapterCtx

    await expect(ensureGooseCli({ config: { source: 'path', path: 'goose' }, ctx }))
      .rejects.toThrow('must be absolute')
    await expect(ensureGooseCli({ config: { source: 'path', path: binaryPath }, ctx }))
      .resolves.toBe(await realpath(binaryPath))
  })

  it('resolves managed, system, and path history binaries without installing', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'oneworks-goose-readonly-'))
    tempDirs.push(root)
    const env = createContext(root).env
    const target = resolveGooseReleaseTarget({ platform: 'darwin', arch: 'arm64' })
    const managedBinary = resolveGooseManagedBinaryPath({ env, target, version: '1.46.0' })
    await mkdir(dirname(managedBinary), { recursive: true })
    await writeFile(managedBinary, '#!/bin/sh\necho "goose 1.46.0"\n', 'utf8')
    await chmod(managedBinary, 0o755)

    await expect(resolveInstalledGooseCli({
      cwd: root,
      dependencies: { arch: 'arm64', platform: 'darwin' },
      env
    })).resolves.toBe(managedBinary)
    await expect(resolveInstalledGooseCli({
      config: { source: 'system' },
      cwd: root,
      dependencies: {
        execFile: (async () => ({ stdout: 'goose 1.46.0\n', stderr: '' })) as never,
        resolveSystemBinary: (async () => '/usr/local/bin/goose') as never
      },
      env
    })).resolves.toBe('/usr/local/bin/goose')
    await expect(resolveInstalledGooseCli({
      config: { source: 'path', path: managedBinary },
      cwd: root,
      env
    })).resolves.toBe(await realpath(managedBinary))
  })

  it.each(['version', 'target', 'binary'])(
    'rejects a pre-existing symlinked managed %s before probing',
    async (kind) => {
      const root = await mkdtemp(resolve(tmpdir(), `oneworks-goose-cache-${kind}-`))
      tempDirs.push(root)
      const env = createContext(root).env
      const outsideDir = resolve(root, 'outside')
      const outsideBinary = resolve(outsideDir, 'goose')
      const target = resolveGooseReleaseTarget({ platform: 'darwin', arch: 'arm64' })
      const managedBinary = resolveGooseManagedBinaryPath({ env, target, version: '1.46.0' })
      await mkdir(outsideDir, { recursive: true })
      await writeFile(outsideBinary, '#!/bin/sh\necho "goose 1.46.0"\n', 'utf8')
      await chmod(outsideBinary, 0o755)

      if (kind === 'version') {
        await mkdir(dirname(dirname(dirname(managedBinary))), { recursive: true })
        await symlink(outsideDir, dirname(dirname(managedBinary)))
      } else if (kind === 'target') {
        await mkdir(dirname(dirname(managedBinary)), { recursive: true })
        await symlink(outsideDir, dirname(managedBinary))
      } else {
        await mkdir(dirname(managedBinary), { recursive: true })
        await symlink(outsideBinary, managedBinary)
      }
      let probeCount = 0
      await expect(resolveInstalledGooseCli({
        cwd: root,
        dependencies: {
          arch: 'arm64',
          execFile: (async () => {
            probeCount += 1
            return { stdout: 'goose 1.46.0\n', stderr: '' }
          }) as never,
          platform: 'darwin'
        },
        env
      })).rejects.toThrow(/unsafe directory entry|not a regular file/u)
      expect(probeCount).toBe(0)
    }
  )
})
