import { mkdtempSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os, { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  appVersion: '0.0.0',
  appPath: undefined as string | undefined,
  isPackaged: false
}))

vi.mock('electron', () => ({
  app: {
    getAppPath: () => electronMock.appPath ?? path.resolve(__dirname, '..'),
    getPath: () => path.join('/tmp', 'oneworks-desktop-test'),
    getVersion: () => electronMock.appVersion,
    get isPackaged() {
      return electronMock.isPackaged
    }
  }
}))

const bundledBootstrapPattern = /(?:oneworks|apps[\\/]bootstrap)[\\/]cli\.js$/

afterEach(() => {
  electronMock.appVersion = '0.0.0'
  electronMock.appPath = undefined
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

  it('shares the desktop Vite source roots with development server children', async () => {
    const customRoot = path.join(tmpdir(), 'oneworks-desktop-custom-client-root')
    vi.stubEnv('__ONEWORKS_PROJECT_CLIENT_FS_ALLOW__', JSON.stringify([customRoot]))
    const { resolveDesktopDevClientFsAllowEnv } = await import('../src/main/workspace-service-manager')
    const { repoRoot } = await import('../src/main/paths')

    const runtimeEnv = resolveDesktopDevClientFsAllowEnv(process.env)
    expect(JSON.parse(runtimeEnv.__ONEWORKS_PROJECT_CLIENT_FS_ALLOW__ ?? '[]')).toEqual([
      repoRoot,
      path.resolve(customRoot)
    ])

    electronMock.isPackaged = true
    vi.resetModules()
    const packaged = await import('../src/main/workspace-service-manager')
    expect(packaged.resolveDesktopDevClientFsAllowEnv(process.env)).toEqual({})
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
          runtimePackageBuildFingerprint: 'build-packaged',
          runtimePackageCacheVersion: 'local-cache'
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
        __ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION__: 'local-cache',
        __ONEWORKS_DESKTOP_RUNTIME_PACKAGE_BUILD_FINGERPRINT__: 'build-packaged',
        __ONEWORKS_DESKTOP_TRUST_DEV_RUNTIME_CACHE_MANIFEST__: '1',
        __ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION__: 'local-cache'
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

  it('keeps the immutable package fingerprint when an env override replaces the cache version', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'oneworks-desktop-runtime-version-override-'))
    const previousResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
    try {
      await writeFile(
        path.join(tempDir, 'desktop-build-source.json'),
        JSON.stringify({
          branch: 'local',
          buildTime: '2026-06-22T01:02:03.000Z',
          gitHash: 'abcdef1234567890',
          runtimePackageBuildFingerprint: 'build-packaged',
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

      expect(resolveDesktopDevRuntimeVersionEnv({
        __ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION__: 'dev-worktree'
      })).toEqual({
        __ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION__: 'dev-worktree',
        __ONEWORKS_DESKTOP_RUNTIME_PACKAGE_BUILD_FINGERPRINT__: 'build-packaged',
        __ONEWORKS_DESKTOP_TRUST_DEV_RUNTIME_CACHE_MANIFEST__: '1',
        __ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION__: 'dev-worktree'
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

  it('uses the tagged packaged app version as the release runtime cache version', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'oneworks-desktop-release-runtime-version-'))
    const previousResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
    try {
      const appDir = path.join(tempDir, 'app')
      const resourcesDir = path.join(tempDir, 'resources')
      await mkdir(appDir, { recursive: true })
      await mkdir(resourcesDir, { recursive: true })
      await writeFile(
        path.join(appDir, 'package.json'),
        JSON.stringify({ name: '@oneworks/desktop', version: '9.8.7-beta.0' }),
        'utf8'
      )
      Object.defineProperty(process, 'resourcesPath', {
        configurable: true,
        value: resourcesDir
      })
      electronMock.appVersion = '9.8.7-beta.1'
      electronMock.appPath = appDir
      electronMock.isPackaged = true
      vi.resetModules()

      const { resolveDesktopDevRuntimeVersionEnv } = await import('../src/main/workspace-service-manager')

      expect(resolveDesktopDevRuntimeVersionEnv({})).toEqual({
        __ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION__: '9.8.7-beta.1',
        __ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION__: '9.8.7-beta.1'
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
          runtimePackageBuildFingerprint: 'build-packaged',
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
        __ONEWORKS_DESKTOP_RUNTIME_PACKAGE_BUILD_FINGERPRINT__: 'build-packaged',
        __ONEWORKS_DESKTOP_TRUST_DEV_RUNTIME_CACHE_MANIFEST__: '1',
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

  it('isolates the desktop manager server from workspace and fixed-port state', async () => {
    const homeProjectsDir = mkdtempSync(path.join(tmpdir(), 'oneworks-desktop-manager-projects-'))
    const launchCwd = mkdtempSync(path.join(tmpdir(), 'oneworks-desktop-manager-cwd-'))
    const workspaceFolder = mkdtempSync(path.join(tmpdir(), 'oneworks-desktop-manager-workspace-'))
    const clientOrigin = 'http://127.0.0.1:53124'
    vi.stubEnv('__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__', homeProjectsDir)

    const { createManagerRuntimeEnv } = await import('../src/main/manager-service-manager')
    const runtimeEnv = createManagerRuntimeEnv({
      clientOrigin,
      env: {
        ...process.env,
        __ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__: workspaceFolder,
        __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspaceFolder,
        __ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__: workspaceFolder
      },
      launchCwd,
      port: 54321
    })
    const escapedHomeProjectsDir = homeProjectsDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    expect(runtimeEnv).toMatchObject({
      __ONEWORKS_PROJECT_CLIENT_MODE__: 'none',
      __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: 'manager',
      __ONEWORKS_PROJECT_SERVER_ALLOW_CORS__: 'true',
      __ONEWORKS_PROJECT_SERVER_CORS_ORIGIN__: clientOrigin,
      __ONEWORKS_PROJECT_SERVER_HOST__: '127.0.0.1',
      __ONEWORKS_PROJECT_SERVER_PORT__: '54321',
      __ONEWORKS_PROJECT_SERVER_ROLE__: 'manager',
      __ONEWORKS_PROJECT_WEB_AUTH_ENABLED__: 'false',
      DB_PATH: expect.stringMatching(new RegExp(`${escapedHomeProjectsDir}.*\\.local[\\/]server[\\/]db\\.sqlite$`))
    })
    expect(runtimeEnv.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__).toBeUndefined()
    expect(runtimeEnv.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__).toBeUndefined()
    expect(runtimeEnv.__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__).toBeUndefined()
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
