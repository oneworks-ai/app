import { mkdtempSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os, { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  isPackaged: false
}))

vi.mock('electron', () => ({
  app: {
    getAppPath: () => path.resolve(__dirname, '..'),
    getPath: () => path.join('/tmp', 'oneworks-desktop-test'),
    get isPackaged() {
      return electronMock.isPackaged
    }
  }
}))

const bundledBootstrapPattern = /(?:oneworks|apps[\\/]bootstrap)[\\/]cli\.js$/

afterEach(() => {
  electronMock.isPackaged = false
  vi.resetModules()
  vi.unstubAllEnvs()
})

describe('desktop runtime consumer bootstrap path', () => {
  it('resolves the bundled One Works bootstrap entrypoint', async () => {
    const { resolveBundledRuntimeConsumerBootstrapPath } = await import('../src/main/paths')

    expect(resolveBundledRuntimeConsumerBootstrapPath()).toMatch(bundledBootstrapPattern)
  })

  it('passes the bundled bootstrap path to workspace server children as fallback only', async () => {
    const { resolveRuntimeConsumerBootstrapEnv } = await import('../src/main/workspace-service-manager')

    expect(resolveRuntimeConsumerBootstrapEnv()).toEqual({
      __ONEWORKS_RUNTIME_PROTOCOL_FALLBACK_BOOTSTRAP_PATH__: expect.stringMatching(bundledBootstrapPattern)
    })
  })

  it('prefers the bundled bootstrap path for packaged workspace server children', async () => {
    electronMock.isPackaged = true
    vi.resetModules()
    const { resolveRuntimeConsumerBootstrapEnv } = await import('../src/main/workspace-service-manager')

    expect(resolveRuntimeConsumerBootstrapEnv()).toEqual({
      __ONEWORKS_RUNTIME_PROTOCOL_CONSUMER_CLI_PATH__: expect.stringMatching(bundledBootstrapPattern),
      __ONEWORKS_RUNTIME_PROTOCOL_FALLBACK_BOOTSTRAP_PATH__: expect.stringMatching(bundledBootstrapPattern)
    })
  })

  it('adds common POSIX CLI paths for packaged workspace server children', async () => {
    electronMock.isPackaged = true
    vi.resetModules()
    const { resolvePackagedCliPathEnv } = await import('../src/main/cli-path-env')

    expect(resolvePackagedCliPathEnv({ PATH: '/usr/bin:/bin' })).toEqual({
      PATH: [
        '/opt/homebrew/bin',
        '/opt/homebrew/sbin',
        '/opt/homebrew/opt/node/bin',
        '/opt/homebrew/opt/node@24/bin',
        '/opt/homebrew/opt/node@22/bin',
        '/usr/local/bin',
        '/usr/local/sbin',
        '/usr/local/opt/node/bin',
        '/usr/local/opt/node@24/bin',
        '/usr/local/opt/node@22/bin',
        '/usr/bin',
        '/bin'
      ].join(path.delimiter)
    })
  })

  it('normalizes a public desktop dev runtime version for workspace server children', async () => {
    const { resolveDesktopDevRuntimeVersionEnv } = await import('../src/main/workspace-service-manager')

    expect(resolveDesktopDevRuntimeVersionEnv({
      ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION: ' dev-local '
    })).toEqual({
      __ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION__: 'dev-local',
      __ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION__: 'dev-local'
    })
  })

  it('uses packaged build metadata as the default runtime cache version', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'oneworks-desktop-build-source-'))
    const previousResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
    try {
      await writeFile(
        path.join(tempDir, 'desktop-build-source.json'),
        JSON.stringify({
          branch: 'local',
          buildTime: '2026-06-22T01:02:03.000Z',
          gitHash: 'abcdef1234567890',
          runtimePackageCacheVersion: 'dev-packaged'
        }),
        'utf8'
      )
      Object.defineProperty(process, 'resourcesPath', {
        configurable: true,
        value: tempDir
      })
      electronMock.isPackaged = true
      vi.resetModules()

      const { resolveDesktopDevRuntimeVersionEnv } = await import('../src/main/workspace-service-manager')

      expect(resolveDesktopDevRuntimeVersionEnv({})).toEqual({
        __ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION__: 'dev-packaged',
        __ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION__: 'dev-packaged'
      })
    } finally {
      if (previousResourcesPath == null) {
        delete (process as { resourcesPath?: string }).resourcesPath
      } else {
        Object.defineProperty(process, 'resourcesPath', previousResourcesPath)
      }
      await rm(tempDir, { force: true, recursive: true })
    }
  })

  it('passes packaged build metadata to the shared launcher client', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'oneworks-desktop-launcher-client-build-source-'))
    const previousResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
    try {
      await writeFile(
        path.join(tempDir, 'desktop-build-source.json'),
        JSON.stringify({
          branch: 'local',
          buildTime: '2026-06-22T01:02:03.000Z',
          gitHash: 'abcdef1234567890',
          runtimePackageCacheVersion: 'dev-packaged'
        }),
        'utf8'
      )
      Object.defineProperty(process, 'resourcesPath', {
        configurable: true,
        value: tempDir
      })
      electronMock.isPackaged = true
      vi.resetModules()

      const { resolvePackagedLauncherClientRuntimeEnv } = await import('../src/main/launcher-client-service')

      expect(resolvePackagedLauncherClientRuntimeEnv({})).toEqual({
        __ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION__: 'dev-packaged',
        __ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION__: 'dev-packaged'
      })
    } finally {
      if (previousResourcesPath == null) {
        delete (process as { resourcesPath?: string }).resourcesPath
      } else {
        Object.defineProperty(process, 'resourcesPath', previousResourcesPath)
      }
      await rm(tempDir, { force: true, recursive: true })
    }
  })

  it('places workspace server data under project home instead of Electron userData', async () => {
    const workspaceFolder = mkdtempSync(path.join(tmpdir(), 'oneworks-desktop-workspace-'))
    const homeProjectsDir = mkdtempSync(path.join(tmpdir(), 'oneworks-desktop-home-projects-'))
    vi.stubEnv('__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__', homeProjectsDir)
    vi.stubEnv('__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__', path.join(tmpdir(), 'unrelated-primary'))

    const { getWorkspaceServiceDataPaths } = await import('../src/main/workspace-service-manager')
    const escapedHomeProjectsDir = homeProjectsDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    expect(getWorkspaceServiceDataPaths(workspaceFolder)).toEqual({
      dataDir: expect.stringMatching(new RegExp(`${escapedHomeProjectsDir}.*server[\\/]data$`)),
      dbPath: expect.stringMatching(new RegExp(`${escapedHomeProjectsDir}.*\\.local[\\/]server[\\/]db\\.sqlite$`)),
      logDir: expect.stringMatching(new RegExp(`${escapedHomeProjectsDir}.*logs[\\/]server$`))
    })
  })

  it('passes cached server package dirs to workspace server children only in packaged mode', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'oneworks-desktop-server-cache-'))
    try {
      const packageDir = path.join(
        tempDir,
        '.oneworks/bootstrap/npm/oneworks__server/3.4.0/node_modules/@oneworks/server'
      )
      await mkdir(packageDir, { recursive: true })
      await writeFile(
        path.join(packageDir, 'package.json'),
        JSON.stringify({ name: '@oneworks/server', version: '3.4.0' }),
        'utf8'
      )
      vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', tempDir)

      const { resolveCachedServerPackageEnv } = await import('../src/main/paths')
      expect(resolveCachedServerPackageEnv()).toEqual({})

      electronMock.isPackaged = true
      expect(resolveCachedServerPackageEnv()).toEqual({
        __ONEWORKS_DESKTOP_SERVER_PACKAGE_DIR__: packageDir
      })
    } finally {
      await rm(tempDir, { force: true, recursive: true })
    }
  })

  it('falls back to bundled server code when selected dev runtime cache is missing', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'oneworks-desktop-server-dev-cache-miss-'))
    try {
      const packageDir = path.join(
        tempDir,
        '.oneworks/bootstrap/npm/oneworks__server/3.4.0/node_modules/@oneworks/server'
      )
      await mkdir(packageDir, { recursive: true })
      await writeFile(
        path.join(packageDir, 'package.json'),
        JSON.stringify({ name: '@oneworks/server', version: '3.4.0' }),
        'utf8'
      )
      vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', tempDir)
      vi.stubEnv('__ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION__', 'dev-local')

      const { resolveCachedServerPackageEnv } = await import('../src/main/paths')
      electronMock.isPackaged = true

      expect(resolveCachedServerPackageEnv()).toEqual({})
    } finally {
      await rm(tempDir, { force: true, recursive: true })
    }
  })

  it('resolves cached server packages from the provided runtime cache env', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'oneworks-desktop-server-provided-cache-'))
    try {
      const packageDir = path.join(
        tempDir,
        '.oneworks/bootstrap/npm/oneworks__server/dev-packaged/node_modules/@oneworks/server'
      )
      await mkdir(packageDir, { recursive: true })
      await writeFile(
        path.join(packageDir, 'package.json'),
        JSON.stringify({ name: '@oneworks/server', version: '3.4.0' }),
        'utf8'
      )

      const { resolveCachedServerPackageEnv } = await import('../src/main/paths')
      electronMock.isPackaged = true

      expect(resolveCachedServerPackageEnv({
        __ONEWORKS_PROJECT_REAL_HOME__: tempDir,
        __ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION__: 'dev-packaged'
      })).toEqual({
        __ONEWORKS_DESKTOP_SERVER_PACKAGE_DIR__: packageDir
      })
    } finally {
      await rm(tempDir, { force: true, recursive: true })
    }
  })

  it('falls back to bundled server and client assets when packaged cache is empty', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'oneworks-desktop-empty-runtime-cache-'))
    const previousResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
    try {
      const distDir = path.join(tempDir, 'resources', 'dist')
      await mkdir(distDir, { recursive: true })
      await writeFile(path.join(distDir, 'index.html'), '<!doctype html>', 'utf8')
      Object.defineProperty(process, 'resourcesPath', {
        configurable: true,
        value: path.dirname(distDir)
      })
      vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', path.join(tempDir, 'home'))

      const { resolveCachedServerPackageEnv, resolveClientDistPath } = await import('../src/main/paths')
      electronMock.isPackaged = true

      expect(resolveCachedServerPackageEnv()).toEqual({})
      expect(resolveClientDistPath()).toBe(distDir)
    } finally {
      if (previousResourcesPath == null) {
        delete (process as { resourcesPath?: string }).resourcesPath
      } else {
        Object.defineProperty(process, 'resourcesPath', previousResourcesPath)
      }
      await rm(tempDir, { force: true, recursive: true })
    }
  })

  it('prefers cached client dist in packaged mode', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'oneworks-desktop-client-cache-'))
    try {
      const packageDir = path.join(
        tempDir,
        '.oneworks/bootstrap/npm/oneworks__client/3.4.0/node_modules/@oneworks/client'
      )
      const distDir = path.join(packageDir, 'dist')
      await mkdir(distDir, { recursive: true })
      await writeFile(
        path.join(packageDir, 'package.json'),
        JSON.stringify({ name: '@oneworks/client', version: '3.4.0' }),
        'utf8'
      )
      await writeFile(path.join(distDir, 'index.html'), '<!doctype html>', 'utf8')
      vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', tempDir)

      const { resolveClientDistPath } = await import('../src/main/paths')
      electronMock.isPackaged = true
      expect(resolveClientDistPath()).toBe(distDir)
    } finally {
      await rm(tempDir, { force: true, recursive: true })
    }
  })

  it('resolves cached client dist from the provided runtime cache env', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'oneworks-desktop-client-provided-cache-'))
    try {
      const packageDir = path.join(
        tempDir,
        '.oneworks/bootstrap/npm/oneworks__client/dev-packaged/node_modules/@oneworks/client'
      )
      const distDir = path.join(packageDir, 'dist')
      await mkdir(distDir, { recursive: true })
      await writeFile(
        path.join(packageDir, 'package.json'),
        JSON.stringify({ name: '@oneworks/client', version: '3.4.0' }),
        'utf8'
      )
      await writeFile(path.join(distDir, 'index.html'), '<!doctype html>', 'utf8')

      const { resolveClientDistPath } = await import('../src/main/paths')
      electronMock.isPackaged = true

      expect(resolveClientDistPath({
        __ONEWORKS_PROJECT_REAL_HOME__: tempDir,
        __ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION__: 'dev-packaged'
      })).toBe(distDir)
    } finally {
      await rm(tempDir, { force: true, recursive: true })
    }
  })
})
