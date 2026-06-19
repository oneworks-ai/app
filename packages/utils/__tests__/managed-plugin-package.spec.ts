import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  Arborist: vi.fn(),
  manifest: vi.fn()
}))

vi.mock('pacote', () => ({
  default: {
    manifest: mocks.manifest
  }
}))

vi.mock('@npmcli/arborist', () => ({
  default: mocks.Arborist
}))

const {
  ensureManagedPluginPackage,
  resolveExistingManagedPluginPackage,
  resolveManagedPluginPackageCacheDir,
  resolveManagedPluginPackageInstallDir
} = await import('#~/managed-plugin-package.js')

const tempDirs: string[] = []

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200 })))
  mocks.manifest.mockResolvedValue({
    dist: {
      integrity: 'sha512-registry-integrity',
      tarball: 'https://registry.example.test/@oneworks/plugin-logger/-/plugin-logger-3.2.1.tgz'
    },
    name: '@oneworks/plugin-logger',
    version: '3.2.1'
  })
  mocks.Arborist.mockImplementation((options: { path: string }) => ({
    reify: async (reifyOptions: unknown) => {
      const [spec] = (reifyOptions as { add?: string[] }).add ?? ['@oneworks/plugin-logger@3.2.1']
      const version = spec.slice(spec.lastIndexOf('@') + 1)
      const packageDir = join(options.path, 'node_modules', '@oneworks', 'plugin-logger')
      await mkdir(packageDir, { recursive: true })
      await writeFile(
        join(packageDir, 'package.json'),
        JSON.stringify({
          name: '@oneworks/plugin-logger',
          version
        })
      )
      return reifyOptions
    }
  }))
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('managed plugin package installer', () => {
  it('resolves dist tags to an exact version cache entry and records an install manifest', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-managed-plugin-package-'))
    tempDirs.push(tempDir)

    const workspace = join(tempDir, 'workspace')
    const realHome = join(tempDir, 'home')
    const env = { __ONEWORKS_PROJECT_REAL_HOME__: realHome }
    await mkdir(workspace, { recursive: true })

    const packageDir = await ensureManagedPluginPackage({
      cwd: workspace,
      env,
      packageName: '@oneworks/plugin-logger'
    })

    expect(packageDir).toBe(resolveManagedPluginPackageInstallDir({
      env,
      packageName: '@oneworks/plugin-logger',
      version: '3.2.1'
    }))
    expect(mocks.manifest).toHaveBeenCalledWith(
      '@oneworks/plugin-logger@latest',
      expect.objectContaining({
        fullMetadata: true,
        ignoreScripts: true
      })
    )
    expect(mocks.Arborist).toHaveBeenCalledWith(expect.objectContaining({
      ignoreScripts: true,
      path: expect.stringContaining('3.2.1.tmp-')
    }))

    const cacheDir = resolveManagedPluginPackageCacheDir('@oneworks/plugin-logger', '3.2.1', env)
    const installManifest = JSON.parse(
      await readFile(join(cacheDir, '.oneworks-plugin-package.json'), 'utf8')
    ) as { integrity?: string; requestedVersion?: string; version?: string }
    expect(installManifest).toMatchObject({
      integrity: 'sha512-registry-integrity',
      requestedVersion: 'latest',
      version: '3.2.1'
    })
  })

  it('probes registries and uses npmmirror when the default registry is unavailable', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-managed-plugin-package-'))
    tempDirs.push(tempDir)

    const workspace = join(tempDir, 'workspace')
    const realHome = join(tempDir, 'home')
    const env = { __ONEWORKS_PROJECT_REAL_HOME__: realHome }
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockRejectedValueOnce(new Error('registry timeout'))
        .mockResolvedValueOnce({ status: 200 })
    )
    mocks.manifest.mockReset()
    mocks.manifest.mockResolvedValueOnce({
      dist: {
        integrity: 'sha512-npmmirror-integrity',
        tarball: 'https://registry.npmmirror.com/@oneworks/plugin-logger/-/plugin-logger-4.0.0.tgz'
      },
      name: '@oneworks/plugin-logger',
      version: '4.0.0'
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const packageDir = await ensureManagedPluginPackage({
      cwd: workspace,
      env,
      packageName: '@oneworks/plugin-logger'
    })

    expect(packageDir).toBe(resolveManagedPluginPackageInstallDir({
      env,
      packageName: '@oneworks/plugin-logger',
      version: '4.0.0'
    }))
    expect(mocks.manifest).toHaveBeenNthCalledWith(
      1,
      '@oneworks/plugin-logger@latest',
      expect.objectContaining({
        registry: 'https://registry.npmmirror.com'
      })
    )
    expect(mocks.Arborist).toHaveBeenCalledWith(expect.objectContaining({
      registry: 'https://registry.npmmirror.com'
    }))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Registry probe failed'))

    const cacheDir = resolveManagedPluginPackageCacheDir('@oneworks/plugin-logger', '4.0.0', env)
    const installManifest = JSON.parse(
      await readFile(join(cacheDir, '.oneworks-plugin-package.json'), 'utf8')
    ) as { registry?: string }
    expect(installManifest.registry).toBe('https://registry.npmmirror.com')
  })

  it('uses explicit fallback registries when the primary registry is configured', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-managed-plugin-package-'))
    tempDirs.push(tempDir)

    const workspace = join(tempDir, 'workspace')
    const realHome = join(tempDir, 'home')
    const env = {
      __ONEWORKS_PROJECT_REAL_HOME__: realHome,
      NPM_CONFIG_REGISTRY: 'https://registry.company.test',
      ONEWORKS_NPM_REGISTRY_FALLBACKS: 'https://registry.backup.test'
    }
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200 })))
    mocks.manifest.mockReset()
    mocks.manifest
      .mockRejectedValueOnce(Object.assign(new Error('registry 502'), { statusCode: 502 }))
      .mockResolvedValueOnce({
        dist: {
          integrity: 'sha512-backup-integrity',
          tarball: 'https://registry.backup.test/@oneworks/plugin-logger/-/plugin-logger-4.1.0.tgz'
        },
        name: '@oneworks/plugin-logger',
        version: '4.1.0'
      })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(ensureManagedPluginPackage({
      cwd: workspace,
      env,
      packageName: '@oneworks/plugin-logger'
    })).resolves.toBe(resolveManagedPluginPackageInstallDir({
      env,
      packageName: '@oneworks/plugin-logger',
      version: '4.1.0'
    }))
    expect(mocks.manifest).toHaveBeenNthCalledWith(
      1,
      '@oneworks/plugin-logger@latest',
      expect.objectContaining({
        registry: 'https://registry.company.test'
      })
    )
    expect(mocks.manifest).toHaveBeenNthCalledWith(
      2,
      '@oneworks/plugin-logger@latest',
      expect.objectContaining({
        registry: 'https://registry.backup.test'
      })
    )
  })

  it('does not use a built-in public fallback when the primary registry is explicitly configured', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-managed-plugin-package-'))
    tempDirs.push(tempDir)

    const workspace = join(tempDir, 'workspace')
    const realHome = join(tempDir, 'home')
    const env = {
      __ONEWORKS_PROJECT_REAL_HOME__: realHome,
      NPM_CONFIG_REGISTRY: 'https://registry.company.test'
    }
    mocks.manifest.mockReset()
    mocks.manifest.mockRejectedValueOnce(Object.assign(new Error('registry timeout'), { code: 'ETIMEDOUT' }))

    await expect(ensureManagedPluginPackage({
      cwd: workspace,
      env,
      packageName: '@oneworks/plugin-logger'
    })).rejects.toThrow('registry timeout')
    expect(mocks.manifest).toHaveBeenCalledTimes(1)
  })

  it('reads scoped registry and auth token from project npmrc', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-managed-plugin-package-'))
    tempDirs.push(tempDir)

    const workspace = join(tempDir, 'workspace')
    const realHome = join(tempDir, 'home')
    const env = {
      __ONEWORKS_PROJECT_REAL_HOME__: realHome,
      ONEWORKS_PLUGIN_TOKEN: 'project-token'
    }
    await mkdir(workspace, { recursive: true })
    await writeFile(
      join(workspace, '.npmrc'),
      [
        '@oneworks:registry=https://registry.project.test/',
        `//registry.project.test/:_authToken=$${'{ONEWORKS_PLUGIN_TOKEN}'}`,
        'always-auth=true'
      ].join('\n')
    )
    mocks.manifest.mockResolvedValueOnce({
      dist: {
        integrity: 'sha512-project-integrity',
        tarball: 'https://registry.project.test/@oneworks/plugin-logger/-/plugin-logger-4.2.0.tgz'
      },
      name: '@oneworks/plugin-logger',
      version: '4.2.0'
    })

    await expect(ensureManagedPluginPackage({
      cwd: workspace,
      env,
      packageName: '@oneworks/plugin-logger'
    })).resolves.toBe(resolveManagedPluginPackageInstallDir({
      env,
      packageName: '@oneworks/plugin-logger',
      version: '4.2.0'
    }))
    expect(mocks.manifest).toHaveBeenCalledWith(
      '@oneworks/plugin-logger@latest',
      expect.objectContaining({
        '@oneworks:registry': 'https://registry.project.test/',
        '//registry.project.test/:_authToken': 'project-token',
        'always-auth': true,
        registry: 'https://registry.project.test'
      })
    )
    expect(mocks.Arborist).toHaveBeenCalledWith(expect.objectContaining({
      '//registry.project.test/:_authToken': 'project-token',
      registry: 'https://registry.project.test'
    }))
  })

  it('uses the user npmrc registry when the project does not override it', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-managed-plugin-package-'))
    tempDirs.push(tempDir)

    const workspace = join(tempDir, 'workspace')
    const realHome = join(tempDir, 'home')
    const env = { __ONEWORKS_PROJECT_REAL_HOME__: realHome }
    await mkdir(realHome, { recursive: true })
    await writeFile(join(realHome, '.npmrc'), 'registry=https://registry.user.test\n')
    mocks.manifest.mockResolvedValueOnce({
      dist: {
        integrity: 'sha512-user-integrity',
        tarball: 'https://registry.user.test/@oneworks/plugin-logger/-/plugin-logger-4.3.0.tgz'
      },
      name: '@oneworks/plugin-logger',
      version: '4.3.0'
    })

    await expect(ensureManagedPluginPackage({
      cwd: workspace,
      env,
      packageName: '@oneworks/plugin-logger'
    })).resolves.toBe(resolveManagedPluginPackageInstallDir({
      env,
      packageName: '@oneworks/plugin-logger',
      version: '4.3.0'
    }))
    expect(mocks.manifest).toHaveBeenCalledWith(
      '@oneworks/plugin-logger@latest',
      expect.objectContaining({
        registry: 'https://registry.user.test'
      })
    )
  })

  it('lets npm registry environment variables override npmrc files', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-managed-plugin-package-'))
    tempDirs.push(tempDir)

    const workspace = join(tempDir, 'workspace')
    const realHome = join(tempDir, 'home')
    const env = {
      __ONEWORKS_PROJECT_REAL_HOME__: realHome,
      NPM_CONFIG_REGISTRY: 'https://registry.env.test'
    }
    await mkdir(workspace, { recursive: true })
    await mkdir(realHome, { recursive: true })
    await writeFile(join(realHome, '.npmrc'), 'registry=https://registry.user.test\n')
    await writeFile(join(workspace, '.npmrc'), 'registry=https://registry.project.test\n')
    mocks.manifest.mockResolvedValueOnce({
      dist: {
        integrity: 'sha512-env-integrity',
        tarball: 'https://registry.env.test/@oneworks/plugin-logger/-/plugin-logger-4.4.0.tgz'
      },
      name: '@oneworks/plugin-logger',
      version: '4.4.0'
    })

    await expect(ensureManagedPluginPackage({
      cwd: workspace,
      env,
      packageName: '@oneworks/plugin-logger'
    })).resolves.toBe(resolveManagedPluginPackageInstallDir({
      env,
      packageName: '@oneworks/plugin-logger',
      version: '4.4.0'
    }))
    expect(mocks.manifest).toHaveBeenCalledWith(
      '@oneworks/plugin-logger@latest',
      expect.objectContaining({
        registry: 'https://registry.env.test'
      })
    )
  })

  it('resolves latest each time instead of pinning it to a synthetic cache directory', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-managed-plugin-package-'))
    tempDirs.push(tempDir)

    const workspace = join(tempDir, 'workspace')
    const realHome = join(tempDir, 'home')
    const env = { __ONEWORKS_PROJECT_REAL_HOME__: realHome }
    mocks.manifest.mockReset()
    mocks.manifest
      .mockResolvedValueOnce({
        dist: {
          integrity: 'sha512-registry-integrity-1',
          tarball: 'https://registry.example.test/@oneworks/plugin-logger/-/plugin-logger-1.0.0.tgz'
        },
        name: '@oneworks/plugin-logger',
        version: '1.0.0'
      })
      .mockResolvedValueOnce({
        dist: {
          integrity: 'sha512-registry-integrity-2',
          tarball: 'https://registry.example.test/@oneworks/plugin-logger/-/plugin-logger-2.0.0.tgz'
        },
        name: '@oneworks/plugin-logger',
        version: '2.0.0'
      })

    await expect(ensureManagedPluginPackage({
      cwd: workspace,
      env,
      packageName: '@oneworks/plugin-logger'
    })).resolves.toBe(resolveManagedPluginPackageInstallDir({
      env,
      packageName: '@oneworks/plugin-logger',
      version: '1.0.0'
    }))
    await expect(ensureManagedPluginPackage({
      cwd: workspace,
      env,
      packageName: '@oneworks/plugin-logger'
    })).resolves.toBe(resolveManagedPluginPackageInstallDir({
      env,
      packageName: '@oneworks/plugin-logger',
      version: '2.0.0'
    }))
    expect(mocks.manifest).toHaveBeenCalledTimes(2)
  })

  it('reuses an exact cached version without resolving the registry', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-managed-plugin-package-'))
    tempDirs.push(tempDir)

    const workspace = join(tempDir, 'workspace')
    const realHome = join(tempDir, 'home')
    const env = { __ONEWORKS_PROJECT_REAL_HOME__: realHome }
    const packageDir = resolveManagedPluginPackageInstallDir({
      env,
      packageName: '@oneworks/plugin-logger',
      version: '1.0.0'
    })
    await mkdir(packageDir, { recursive: true })
    await writeFile(
      join(packageDir, 'package.json'),
      JSON.stringify({ name: '@oneworks/plugin-logger', version: '1.0.0' })
    )

    await expect(ensureManagedPluginPackage({
      cwd: workspace,
      env,
      packageName: '@oneworks/plugin-logger',
      version: '1.0.0'
    })).resolves.toBe(packageDir)
    expect(mocks.manifest).not.toHaveBeenCalled()
    expect(mocks.Arborist).not.toHaveBeenCalled()
  })

  it('selects a cached package satisfying a semver range when automatic install is disabled', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-managed-plugin-package-'))
    tempDirs.push(tempDir)

    const workspace = join(tempDir, 'workspace')
    const realHome = join(tempDir, 'home')
    const env = {
      __ONEWORKS_PROJECT_PLUGIN_AUTO_INSTALL__: 'false',
      __ONEWORKS_PROJECT_REAL_HOME__: realHome
    }
    for (const version of ['1.0.0', '1.2.0', '2.0.0']) {
      const packageDir = resolveManagedPluginPackageInstallDir({
        env,
        packageName: '@oneworks/plugin-logger',
        version
      })
      await mkdir(packageDir, { recursive: true })
      await writeFile(
        join(packageDir, 'package.json'),
        JSON.stringify({ name: '@oneworks/plugin-logger', version })
      )
    }

    await expect(ensureManagedPluginPackage({
      cwd: workspace,
      env,
      packageName: '@oneworks/plugin-logger',
      version: '^1.0.0'
    })).resolves.toBe(resolveManagedPluginPackageInstallDir({
      env,
      packageName: '@oneworks/plugin-logger',
      version: '1.2.0'
    }))
    await expect(resolveExistingManagedPluginPackage({
      env,
      packageName: '@oneworks/plugin-logger',
      version: 'latest'
    })).resolves.toBe(resolveManagedPluginPackageInstallDir({
      env,
      packageName: '@oneworks/plugin-logger',
      version: '2.0.0'
    }))
    expect(mocks.manifest).not.toHaveBeenCalled()
    expect(mocks.Arborist).not.toHaveBeenCalled()
  })
})
