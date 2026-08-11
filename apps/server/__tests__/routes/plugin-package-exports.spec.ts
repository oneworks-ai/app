import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import Router from '@koa/router'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { pluginsRouter } from '#~/routes/plugins.js'
import { LOCAL_WORKSPACE_REQUEST_PRINCIPAL, setWorkspaceRequestPrincipal } from '#~/services/auth/index.js'
import { getPluginManager, resetPluginManagerForTests } from '#~/services/plugins/index.js'

const mocks = vi.hoisted(() => ({
  loadConfigState: vi.fn()
}))

vi.mock('#~/services/config/index.js', () => ({
  buildConfigJsonVariables: vi.fn(() => ({})),
  loadConfigState: mocks.loadConfigState
}))

describe('plugin package export conventions', () => {
  let workspaceFolder = ''
  let server: http.Server | undefined
  let baseUrl = ''
  let devServer: http.Server | undefined

  const toHostViteFsPath = async (filePath: string, basePath = '') => {
    const realFilePath = await realpath(filePath)
    return `${basePath}/@fs/${encodeURI(realFilePath.split(path.sep).join('/').replace(/^\/+/, ''))}`
  }

  beforeEach(async () => {
    vi.stubEnv('__ONEWORKS_PROJECT_DISABLE_DEFAULT_OFFICIAL_PLUGINS__', '1')
    workspaceFolder = await mkdtemp(path.join(os.tmpdir(), 'ow-plugin-package-exports-'))
    const app = new Koa()
    const rootRouter = new Router({ prefix: '/api/plugins' })
    const router = pluginsRouter()
    rootRouter.use(router.routes())
    rootRouter.use(router.allowedMethods())
    app.use(bodyParser())
    app.use((ctx, next) => {
      setWorkspaceRequestPrincipal(ctx, LOCAL_WORKSPACE_REQUEST_PRINCIPAL)
      return next()
    })
    app.use(rootRouter.routes())
    app.use(rootRouter.allowedMethods())

    server = http.createServer(app.callback())
    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (address == null || typeof address === 'string') {
      throw new Error('Failed to start test server')
    }
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    await resetPluginManagerForTests()
    await closeServer(server)
    await closeServer(devServer)
    server = undefined
    devServer = undefined
    await rm(workspaceFolder, { recursive: true, force: true })
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('uses package exports for Vite source, built client, and built server entries', async () => {
    const devServerUrl = await startDevServer('export const devPlugin = true\n')
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'vite')
    await mkdir(path.join(pluginRoot, 'client', 'dist'), { recursive: true })
    await mkdir(path.join(pluginRoot, 'client', 'shared'), { recursive: true })
    await mkdir(path.join(pluginRoot, 'server', 'dist'), { recursive: true })
    await mkdir(path.join(pluginRoot, 'server', 'src'), { recursive: true })
    await writeFile(
      path.join(pluginRoot, 'client', 'dist', 'index.js'),
      "import { sharedValue } from '../shared/constants.js'\nexport const builtPlugin = sharedValue\n"
    )
    await writeFile(path.join(pluginRoot, 'client', 'shared', 'constants.js'), 'export const sharedValue = true\n')
    await writeFile(
      path.join(pluginRoot, 'server', 'src', 'index.ts'),
      `
      export async function activatePlugin(ctx: { registerCommand: (id: string, handler: () => string) => void }) {
        ctx.registerCommand('ping', () => 'pong-source')
      }
    `
    )
    await writeFile(
      path.join(pluginRoot, 'server', 'dist', 'index.mjs'),
      `
      export async function activatePlugin(ctx) {
        ctx.registerCommand('ping', () => 'pong-built')
      }
    `
    )
    await writeFile(
      path.join(pluginRoot, 'package.json'),
      JSON.stringify(
        {
          name: '@local/plugin-vite',
          version: '0.1.0',
          exports: {
            './client': {
              source: './client/src/index.tsx',
              default: './client/dist/index.js'
            },
            './server': {
              source: './server/src/index.ts',
              default: './server/dist/index.mjs'
            },
            './package.json': './package.json'
          }
        },
        null,
        2
      )
    )
    await writeFile(
      path.join(pluginRoot, 'plugin.json'),
      JSON.stringify(
        {
          plugin: {
            client: { devServer: devServerUrl },
            contributions: {
              navItems: [{ id: 'home', title: 'Vite Plugin' }]
            },
            server: { roles: ['workspace'] }
          }
        },
        null,
        2
      )
    )
    mocks.loadConfigState.mockResolvedValue({
      workspaceFolder,
      mergedConfig: { plugins: [{ id: pluginRoot, scope: 'vite' }] }
    })

    const listResponse = await fetch(`${baseUrl}/api/plugins`)
    const listPayload = await listResponse.json() as {
      plugins: Array<{ client?: { clientEntryUrl?: string; devClientEntryUrl?: string }; name?: string }>
    }
    expect(listPayload.plugins[0]).toMatchObject({
      client: {
        clientEntryUrl: '/api/plugins/vite/client/dist/index.js',
        devClientEntryUrl: '/api/plugins/vite/dev/src/index.tsx'
      },
      name: '@local/plugin-vite'
    })

    const staticAssetResponse = await fetch(`${baseUrl}/api/plugins/vite/client/dist/index.js`)
    expect(staticAssetResponse.status).toBe(200)
    await expect(staticAssetResponse.text()).resolves.toContain('builtPlugin = sharedValue')

    const sharedAssetResponse = await fetch(`${baseUrl}/api/plugins/vite/shared/constants.js`)
    const sharedAssetText = await sharedAssetResponse.text()
    expect(sharedAssetResponse.status, sharedAssetText).toBe(200)
    expect(sharedAssetText).toContain('sharedValue = true')

    const devAssetResponse = await fetch(`${baseUrl}/api/plugins/vite/dev/src/index.tsx`)
    expect(devAssetResponse.status).toBe(200)
    await expect(devAssetResponse.text()).resolves.toContain('devPlugin = true')

    const commandResponse = await fetch(`${baseUrl}/api/plugins/vite/commands/ping`, { method: 'POST' })
    await expect(commandResponse.text()).resolves.toBe('pong-built')
  })

  it('uses package exports source server entries for watched local plugins', async () => {
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'server-source')
    await mkdir(path.join(pluginRoot, 'server', 'src'), { recursive: true })
    await mkdir(path.join(pluginRoot, 'server', 'dist'), { recursive: true })
    await writeFile(
      path.join(pluginRoot, 'server', 'src', 'index.ts'),
      `
      export async function activatePlugin(ctx: { registerCommand: (id: string, handler: () => string) => void }) {
        ctx.registerCommand('ping', () => 'pong-source')
      }
    `
    )
    await writeFile(
      path.join(pluginRoot, 'server', 'dist', 'index.mjs'),
      `
      export async function activatePlugin(ctx) {
        ctx.registerCommand('ping', () => 'pong-built')
      }
    `
    )
    await writeFile(
      path.join(pluginRoot, 'package.json'),
      JSON.stringify(
        {
          name: '@local/plugin-server-source',
          exports: {
            './server': {
              source: './server/src/index.ts',
              default: './server/dist/index.mjs'
            },
            './package.json': './package.json'
          }
        },
        null,
        2
      )
    )
    await writeFile(
      path.join(pluginRoot, 'plugin.json'),
      JSON.stringify(
        {
          displayName: 'Server Source',
          displayNameI18n: {
            en: 'Server Source',
            'zh-Hans': '服务端源码'
          },
          icon: './assets/icon.svg',
          plugin: { server: { roles: ['workspace'] } }
        },
        null,
        2
      )
    )
    const pluginConfig = { id: pluginRoot, scope: 'server-source', watch: true }
    mocks.loadConfigState.mockResolvedValue({
      workspaceFolder,
      mergedConfig: { plugins: [pluginConfig] },
      projectSource: { resolvedConfig: { plugins: [pluginConfig] } }
    })

    const commandResponse = await fetch(`${baseUrl}/api/plugins/server-source/commands/ping`, { method: 'POST' })
    await expect(commandResponse.text()).resolves.toBe('pong-source')

    const listResponse = await fetch(`${baseUrl}/api/plugins`)
    const listPayload = await listResponse.json() as {
      plugins: Array<{
        displayNameI18n?: Record<string, string>
        icon?: string
        sourceGroup?: string
      }>
    }
    expect(listPayload.plugins[0]).toMatchObject({
      displayNameI18n: {
        en: 'Server Source',
        'zh-Hans': '服务端源码'
      },
      icon: './assets/icon.svg',
      sourceGroup: 'project'
    })
  })

  it('falls back to a package source server entry when built output is missing', async () => {
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'server-source-fallback')
    await mkdir(path.join(pluginRoot, 'server', 'src'), { recursive: true })
    await writeFile(
      path.join(pluginRoot, 'server', 'src', 'index.ts'),
      `
      export async function activatePlugin(ctx: { registerCommand: (id: string, handler: () => string) => void }) {
        ctx.registerCommand('ping', () => 'pong-source-fallback')
      }
    `
    )
    await writeFile(
      path.join(pluginRoot, 'package.json'),
      JSON.stringify(
        {
          name: '@local/plugin-server-source-fallback',
          exports: {
            './server': {
              source: './server/src/index.ts',
              default: './server/dist/index.mjs'
            },
            './package.json': './package.json'
          }
        },
        null,
        2
      )
    )
    await writeFile(
      path.join(pluginRoot, 'plugin.json'),
      JSON.stringify({ plugin: { server: { roles: ['workspace'] } } }, null, 2)
    )
    mocks.loadConfigState.mockResolvedValue({
      workspaceFolder,
      mergedConfig: {
        plugins: [{ id: pluginRoot, scope: 'server-source-fallback', watch: false }]
      }
    })

    const commandResponse = await fetch(
      `${baseUrl}/api/plugins/server-source-fallback/commands/ping`,
      { method: 'POST' }
    )
    await expect(commandResponse.text()).resolves.toBe('pong-source-fallback')

    const listResponse = await fetch(`${baseUrl}/api/plugins`)
    const listPayload = await listResponse.json() as {
      plugins: Array<{ diagnostics?: unknown[]; enabled?: boolean; watch?: { enabled?: boolean } }>
    }
    expect(listPayload.plugins[0]).toMatchObject({
      diagnostics: [],
      enabled: true,
      watch: { enabled: false }
    })
  })

  it('keeps explicitly configured package plugins on built client output in packaged runtimes', async () => {
    vi.stubEnv('__ONEWORKS_PROJECT_CLIENT_MODE__', 'desktop')
    const pluginRoot = path.join(
      workspaceFolder,
      'node_modules',
      '@example',
      'plugin-logger'
    )
    await mkdir(path.join(pluginRoot, 'client', 'src'), { recursive: true })
    await mkdir(path.join(pluginRoot, 'client', 'dist'), { recursive: true })
    await writeFile(path.join(pluginRoot, 'client', 'src', 'index.ts'), 'export const sourceOnly = true\n')
    await writeFile(path.join(pluginRoot, 'client', 'dist', 'index.js'), 'export const builtOnly = true\n')
    await writeFile(
      path.join(pluginRoot, 'package.json'),
      JSON.stringify({
        name: '@example/plugin-logger',
        version: '0.1.0',
        exports: {
          './client': {
            source: './client/src/index.ts',
            default: './client/dist/index.js'
          },
          './package.json': './package.json'
        }
      })
    )
    await writeFile(
      path.join(pluginRoot, 'plugin.json'),
      JSON.stringify({
        displayName: 'Logger',
        name: '@example/plugin-logger'
      })
    )
    const pluginConfig = { id: '@example/plugin-logger', scope: 'logger', watch: true }
    mocks.loadConfigState.mockResolvedValue({
      workspaceFolder,
      mergedConfig: { plugins: [pluginConfig] },
      projectSource: { resolvedConfig: { plugins: [pluginConfig] } }
    })

    const listResponse = await fetch(`${baseUrl}/api/plugins`)
    const listPayload = await listResponse.json() as {
      plugins: Array<{
        client?: {
          clientEntryUrl?: string
          devClientEntryKind?: string
          devClientEntryUrl?: string
        }
        packageId?: string
        sourceGroup?: string
      }>
    }
    expect(listPayload.plugins[0]).toMatchObject({
      client: {
        clientEntryUrl: '/api/plugins/logger/client/dist/index.js'
      },
      packageId: '@example/plugin-logger',
      sourceGroup: 'project'
    })
    expect(listPayload.plugins[0]?.client?.devClientEntryKind).toBeUndefined()
    expect(listPayload.plugins[0]?.client?.devClientEntryUrl).toBeUndefined()
    const sourceResponse = await fetch(
      `${baseUrl}/api/plugins/logger/client-source/client/src/index.ts`
    )
    expect(sourceResponse.status).toBe(404)
  })

  it('requires package export server entries to declare runtime roles', async () => {
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'workspace-default-server')
    await mkdir(path.join(pluginRoot, 'server', 'dist'), { recursive: true })
    await writeFile(
      path.join(pluginRoot, 'server', 'dist', 'index.mjs'),
      `
      export async function activatePlugin(ctx) {
        ctx.registerCommand('ping', () => ctx.runtime.role)
      }
    `
    )
    await writeFile(
      path.join(pluginRoot, 'package.json'),
      JSON.stringify(
        {
          name: '@local/plugin-workspace-default-server',
          exports: {
            './server': './server/dist/index.mjs',
            './package.json': './package.json'
          }
        },
        null,
        2
      )
    )
    await writeFile(path.join(pluginRoot, 'plugin.json'), JSON.stringify({ plugin: {} }, null, 2))
    mocks.loadConfigState.mockResolvedValue({
      workspaceFolder,
      mergedConfig: { plugins: [{ id: pluginRoot, scope: 'workspace-default-server' }] }
    })

    const listResponse = await fetch(`${baseUrl}/api/plugins`)
    const listPayload = await listResponse.json() as {
      diagnostics: Array<{ code?: string; message?: string; scope?: string }>
      plugins: Array<{ manifest?: { plugin?: { server?: { entry?: string; roles?: string[] } } } }>
    }
    expect(listPayload.plugins).toEqual([])
    expect(listPayload.diagnostics).toEqual([
      expect.objectContaining({
        code: 'plugin_register_failed',
        message: expect.stringContaining('plugin.server.roles'),
        scope: 'workspace-default-server'
      })
    ])

    const commandResponse = await fetch(`${baseUrl}/api/plugins/workspace-default-server/commands/ping`, {
      method: 'POST'
    })
    expect(commandResponse.status).toBe(404)
  })

  it('skips workspace-only package export server entries on the manager runtime', async () => {
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_ROLE__', 'manager')
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'manager-skips-workspace-server')
    await mkdir(path.join(pluginRoot, 'server', 'dist'), { recursive: true })
    await writeFile(
      path.join(pluginRoot, 'server', 'dist', 'index.mjs'),
      `
      export async function activatePlugin(ctx) {
        ctx.registerCommand('ping', () => 'manager-should-not-load-this')
      }
    `
    )
    await writeFile(
      path.join(pluginRoot, 'package.json'),
      JSON.stringify(
        {
          name: '@local/plugin-manager-skips-workspace-server',
          exports: {
            './server': './server/dist/index.mjs',
            './package.json': './package.json'
          }
        },
        null,
        2
      )
    )
    await writeFile(
      path.join(pluginRoot, 'plugin.json'),
      JSON.stringify({ plugin: { server: { roles: ['workspace'] } } }, null, 2)
    )
    mocks.loadConfigState.mockResolvedValue({
      workspaceFolder,
      mergedConfig: { plugins: [{ id: pluginRoot, scope: 'manager-skips-workspace-server' }] }
    })

    const commandResponse = await fetch(`${baseUrl}/api/plugins/manager-skips-workspace-server/commands/ping`, {
      method: 'POST'
    })
    expect(commandResponse.status).toBe(404)
  })

  it('allows package exports to fill manager-only server entries declared by roles', async () => {
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_ROLE__', 'manager')
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'manager-only-server')
    await mkdir(path.join(pluginRoot, 'server', 'dist'), { recursive: true })
    await writeFile(
      path.join(pluginRoot, 'server', 'dist', 'index.mjs'),
      `
      export async function activatePlugin(ctx) {
        ctx.registerCommand('ping', () => ctx.runtime.role)
      }
    `
    )
    await writeFile(
      path.join(pluginRoot, 'package.json'),
      JSON.stringify(
        {
          name: '@local/plugin-manager-only-server',
          exports: {
            './server': './server/dist/index.mjs',
            './package.json': './package.json'
          }
        },
        null,
        2
      )
    )
    await writeFile(
      path.join(pluginRoot, 'plugin.json'),
      JSON.stringify({ plugin: { server: { roles: ['manager'] } } }, null, 2)
    )
    mocks.loadConfigState.mockResolvedValue({
      workspaceFolder,
      mergedConfig: { plugins: [{ id: pluginRoot, scope: 'manager-only-server' }] }
    })

    const commandResponse = await fetch(`${baseUrl}/api/plugins/manager-only-server/commands/ping`, {
      method: 'POST'
    })
    await expect(commandResponse.text()).resolves.toBe('manager')
  })

  it('re-resolves package export server entries when watch mode is toggled', async () => {
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'server-watch-toggle')
    await mkdir(path.join(pluginRoot, 'server', 'src'), { recursive: true })
    await mkdir(path.join(pluginRoot, 'server', 'dist'), { recursive: true })
    await writeFile(
      path.join(pluginRoot, 'server', 'src', 'index.ts'),
      `
      export async function activatePlugin(ctx: { registerCommand: (id: string, handler: () => string) => void }) {
        ctx.registerCommand('ping', () => 'pong-source')
      }
    `
    )
    await writeFile(
      path.join(pluginRoot, 'server', 'dist', 'index.mjs'),
      `
      export async function activatePlugin(ctx) {
        ctx.registerCommand('ping', () => 'pong-built')
      }
    `
    )
    await writeFile(
      path.join(pluginRoot, 'package.json'),
      JSON.stringify(
        {
          name: '@local/plugin-server-watch-toggle',
          exports: {
            './server': {
              source: './server/src/index.ts',
              default: './server/dist/index.mjs'
            },
            './package.json': './package.json'
          }
        },
        null,
        2
      )
    )
    await writeFile(
      path.join(pluginRoot, 'plugin.json'),
      JSON.stringify({ plugin: { server: { roles: ['workspace'] } } }, null, 2)
    )
    mocks.loadConfigState.mockResolvedValue({
      workspaceFolder,
      mergedConfig: { plugins: [{ id: pluginRoot, scope: 'server-watch-toggle' }] }
    })

    const builtResponse = await fetch(`${baseUrl}/api/plugins/server-watch-toggle/commands/ping`, { method: 'POST' })
    await expect(builtResponse.text()).resolves.toBe('pong-built')

    const enableWatchResponse = await fetch(`${baseUrl}/api/plugins/server-watch-toggle/watch`, {
      body: JSON.stringify({ enabled: true }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    })
    await expect(enableWatchResponse.json()).resolves.toEqual({
      scope: 'server-watch-toggle',
      watch: { enabled: true }
    })

    const sourceResponse = await fetch(`${baseUrl}/api/plugins/server-watch-toggle/commands/ping`, { method: 'POST' })
    await expect(sourceResponse.text()).resolves.toBe('pong-source')
  })

  it('prefers the directory manifest over cached package export manifests in watch mode', async () => {
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'manifest-watch-toggle')
    await mkdir(pluginRoot, { recursive: true })
    await mkdir(path.join(workspaceFolder, 'node_modules', '@local'), { recursive: true })
    await symlink(
      pluginRoot,
      path.join(workspaceFolder, 'node_modules', '@local', 'plugin-manifest-watch-toggle'),
      'dir'
    )
    await writeFile(
      path.join(pluginRoot, 'package.json'),
      JSON.stringify(
        {
          name: '@local/plugin-manifest-watch-toggle',
          exports: {
            '.': './plugin.json',
            './package.json': './package.json'
          }
        },
        null,
        2
      )
    )
    await writeFile(
      path.join(pluginRoot, 'plugin.json'),
      JSON.stringify(
        {
          displayName: 'Relay',
          plugin: {
            contributions: {
              navItems: [{ id: 'home', title: 'Relay', icon: 'hub' }]
            }
          }
        },
        null,
        2
      )
    )
    mocks.loadConfigState.mockResolvedValue({
      workspaceFolder,
      mergedConfig: { plugins: [{ id: '@local/plugin-manifest-watch-toggle', scope: 'manifest-watch-toggle' }] }
    })

    const initialResponse = await fetch(`${baseUrl}/api/plugins`)
    const initialPayload = await initialResponse.json() as {
      plugins: Array<{ contributions?: { navItems?: unknown[] }; displayName?: string }>
    }
    expect(initialPayload.plugins[0]).toMatchObject({
      contributions: {
        navItems: [{ id: 'home', title: 'Relay', icon: 'hub' }]
      },
      displayName: 'Relay'
    })

    await writeFile(
      path.join(pluginRoot, 'plugin.json'),
      JSON.stringify(
        {
          displayName: 'Account',
          plugin: {
            contributions: {
              navFooterBefore: [{ id: 'home', title: 'Account', icon: 'account_circle' }]
            }
          }
        },
        null,
        2
      )
    )

    const enableWatchResponse = await fetch(`${baseUrl}/api/plugins/manifest-watch-toggle/watch`, {
      body: JSON.stringify({ enabled: true }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    })
    await expect(enableWatchResponse.json()).resolves.toEqual({
      scope: 'manifest-watch-toggle',
      watch: { enabled: true }
    })

    const watchedResponse = await fetch(`${baseUrl}/api/plugins`)
    const watchedPayload = await watchedResponse.json() as {
      plugins: Array<{
        contributions?: {
          navFooterBefore?: unknown[]
          navItems?: unknown[]
        }
        displayName?: string
      }>
    }
    expect(watchedPayload.plugins[0]).toMatchObject({
      contributions: {
        navFooterBefore: [{ id: 'home', title: 'Account', icon: 'account_circle' }]
      },
      displayName: 'Account'
    })
    expect(watchedPayload.plugins[0]?.contributions?.navItems).toBeUndefined()
  })

  it('uses the bounded source route for workspace-routed local client source exports', async () => {
    const previousBase = process.env.__ONEWORKS_PROJECT_CLIENT_BASE__
    process.env.__ONEWORKS_PROJECT_CLIENT_BASE__ = '/ui/w/w_12345678/'
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'host-vite')
    try {
      await mkdir(path.join(pluginRoot, 'client', 'src'), { recursive: true })
      await mkdir(path.join(pluginRoot, 'client', 'dist'), { recursive: true })
      await writeFile(path.join(pluginRoot, 'client', 'src', 'index.tsx'), 'export const sourcePlugin = true\n')
      await writeFile(path.join(pluginRoot, 'client', 'dist', 'index.js'), 'export const builtPlugin = true\n')
      await writeFile(
        path.join(pluginRoot, 'package.json'),
        JSON.stringify(
          {
            name: '@local/plugin-host-vite',
            exports: {
              './client': {
                source: './client/src/index.tsx',
                default: './client/dist/index.js'
              },
              './package.json': './package.json'
            }
          },
          null,
          2
        )
      )
      await writeFile(path.join(pluginRoot, 'plugin.json'), JSON.stringify({ plugin: {} }, null, 2))
      mocks.loadConfigState.mockResolvedValue({
        workspaceFolder,
        mergedConfig: { plugins: [{ id: pluginRoot, scope: 'host-vite', watch: true }] }
      })

      const listResponse = await fetch(`${baseUrl}/api/plugins`)
      const listPayload = await listResponse.json() as {
        plugins: Array<{ client?: { clientEntryUrl?: string; devClientEntryUrl?: string }; name?: string }>
      }
      expect(listPayload.plugins[0]).toMatchObject({
        client: {
          clientEntryUrl: '/api/plugins/host-vite/client/dist/index.js',
          devClientEntryUrl: '/api/plugins/host-vite/client-source/client/src/index.tsx'
        },
        name: '@local/plugin-host-vite'
      })
    } finally {
      if (previousBase == null) {
        delete process.env.__ONEWORKS_PROJECT_CLIENT_BASE__
      } else {
        process.env.__ONEWORKS_PROJECT_CLIENT_BASE__ = previousBase
      }
    }
  })

  it('compiles watched local client source for packaged desktop runtimes', async () => {
    vi.stubEnv('__ONEWORKS_PROJECT_CLIENT_MODE__', 'desktop')
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'packaged-source')
    await mkdir(path.join(pluginRoot, 'client', 'src'), { recursive: true })
    await writeFile(
      path.join(pluginRoot, 'client', 'src', 'theme.css'),
      ':root { --packaged-source-color: #123456; }\n'
    )
    await writeFile(
      path.join(pluginRoot, 'client', 'src', 'theme.ts'),
      "import css from './theme.css?inline'\nexport const packagedSourceCss: string = css\n"
    )
    await writeFile(
      path.join(pluginRoot, 'client', 'src', 'peer.ts'),
      "export const peerValue = 'compiled-peer-v1'\n"
    )
    await mkdir(path.join(pluginRoot, 'server'), { recursive: true })
    const serverSecretPath = path.join(pluginRoot, 'server', 'secret.ts')
    await writeFile(serverSecretPath, "export const secret = 'server-only'\n")
    await symlink(serverSecretPath, path.join(pluginRoot, 'client', 'src', 'leak.ts'))
    await writeFile(
      path.join(pluginRoot, 'client', 'src', 'index.ts'),
      `
        import { packagedSourceCss } from './theme'
        const importPeer = (request: string) => import(/* @vite-ignore */ request)
        export const readPeerValue = async () => (await importPeer('./peer.js')).peerValue
        export async function activatePlugin(ctx: { themes: { register: (theme: unknown) => unknown } }) {
          const peerValue = await readPeerValue()
          return ctx.themes.register({ id: 'packaged-source', css: packagedSourceCss, peerValue })
        }
      `
    )
    await writeFile(
      path.join(pluginRoot, 'package.json'),
      JSON.stringify(
        {
          name: '@local/plugin-packaged-source',
          exports: {
            './client': {
              source: './client/src/index.ts',
              default: './client/dist/index.js'
            },
            './package.json': './package.json'
          }
        },
        null,
        2
      )
    )
    await writeFile(path.join(pluginRoot, 'plugin.json'), JSON.stringify({ plugin: {} }, null, 2))
    mocks.loadConfigState.mockResolvedValue({
      workspaceFolder,
      mergedConfig: { plugins: [{ id: pluginRoot, scope: 'packaged-source', watch: true }] }
    })

    const listResponse = await fetch(`${baseUrl}/api/plugins`)
    const listPayload = await listResponse.json() as {
      plugins: Array<{
        client?: {
          clientEntryUrl?: string
          devClientEntryKind?: string
          devClientEntryUrl?: string
        }
      }>
    }
    expect(listPayload.plugins[0]).toMatchObject({
      client: {
        clientEntryUrl: '/api/plugins/packaged-source/client-source/client/src/index.ts',
        devClientEntryKind: 'runtime-source',
        devClientEntryUrl: '/api/plugins/packaged-source/client-source/client/src/index.ts'
      }
    })

    const sourceModuleBase = '/api/plugins/packaged-source/client-source/@v/1/client/src'
    const sourceResponse = await fetch(
      `${baseUrl}${sourceModuleBase}/index.ts`
    )
    const sourceText = await sourceResponse.text()
    expect(sourceResponse.status, sourceText).toBe(200)
    expect(sourceResponse.headers.get('content-type')).toContain('text/javascript')
    expect(sourceText).toContain('activatePlugin')
    expect(sourceText).toContain('--packaged-source-color')
    expect(sourceText).not.toContain("from './theme'")

    const peerResponse = await fetch(
      `${baseUrl}${sourceModuleBase}/peer.js`
    )
    const peerText = await peerResponse.text()
    expect(peerResponse.status, peerText).toBe(200)
    expect(peerResponse.headers.get('content-type')).toContain('text/javascript')
    expect(peerText).toContain('compiled-peer-v1')

    const moduleRoot = path.join(workspaceFolder, 'runtime-modules')
    const versionOneRoot = path.join(moduleRoot, 'v1')
    await mkdir(versionOneRoot, { recursive: true })
    await writeFile(path.join(versionOneRoot, 'package.json'), JSON.stringify({ type: 'module' }))
    await writeFile(path.join(versionOneRoot, 'index.mjs'), sourceText)
    await writeFile(path.join(versionOneRoot, 'peer.js'), peerText)
    const versionOneModule = await import(pathToFileURL(path.join(versionOneRoot, 'index.mjs')).href)
    await expect(versionOneModule.readPeerValue()).resolves.toBe('compiled-peer-v1')

    const siblingServerResponse = await fetch(
      `${baseUrl}/api/plugins/packaged-source/client-source/@v/1/server/secret.ts`
    )
    expect(siblingServerResponse.status).toBe(404)
    const symlinkEscapeResponse = await fetch(
      `${baseUrl}/api/plugins/packaged-source/client-source/@v/1/client/src/leak.ts`
    )
    expect(symlinkEscapeResponse.status).toBe(404)
    const invalidVersionResponse = await fetch(
      `${baseUrl}/api/plugins/packaged-source/client-source/@v/not%20valid/client/src/index.ts`
    )
    expect(invalidVersionResponse.status).toBe(404)

    await writeFile(
      path.join(pluginRoot, 'client', 'src', 'peer.ts'),
      "export const peerValue = 'compiled-peer-v2'\n"
    )
    const manager = getPluginManager()
    const changedEvent = new Promise<{ path?: string; scope?: string; type?: string }>((resolve) => {
      const unsubscribe = manager.subscribeWatchEvents({
        send: (data) => {
          const event = JSON.parse(data) as { path?: string; scope?: string; type?: string }
          if (event.type !== 'plugin.changed' || event.scope !== 'packaged-source') return
          unsubscribe()
          resolve(event)
        }
      }, 'packaged-source')
    })
    const managerReload = manager as unknown as {
      scheduleRecordReload: (record: unknown, relativePath: string) => void
    }
    const packagedSourceRecord = manager.getRecord('packaged-source')
    expect(packagedSourceRecord).toBeDefined()
    managerReload.scheduleRecordReload(
      packagedSourceRecord,
      'client/src/peer.ts'
    )
    await expect(changedEvent).resolves.toMatchObject({
      path: 'client/src/peer.ts',
      scope: 'packaged-source',
      type: 'plugin.changed'
    })
    const versionTwoModuleBase = '/api/plugins/packaged-source/client-source/@v/2/client/src'
    const versionTwoEntryResponse = await fetch(`${baseUrl}${versionTwoModuleBase}/index.ts`)
    const versionTwoEntry = await versionTwoEntryResponse.text()
    expect(versionTwoEntryResponse.status, versionTwoEntry).toBe(200)
    const versionTwoPeerResponse = await fetch(`${baseUrl}${versionTwoModuleBase}/peer.js`)
    const versionTwoPeer = await versionTwoPeerResponse.text()
    expect(versionTwoPeerResponse.status, versionTwoPeer).toBe(200)
    const versionTwoRoot = path.join(moduleRoot, 'v2')
    await mkdir(versionTwoRoot, { recursive: true })
    await writeFile(path.join(versionTwoRoot, 'package.json'), JSON.stringify({ type: 'module' }))
    await writeFile(path.join(versionTwoRoot, 'index.mjs'), versionTwoEntry)
    await writeFile(path.join(versionTwoRoot, 'peer.js'), versionTwoPeer)
    const versionTwoModule = await import(pathToFileURL(path.join(versionTwoRoot, 'index.mjs')).href)
    await expect(versionTwoModule.readPeerValue()).resolves.toBe('compiled-peer-v2')
    await expect(versionOneModule.readPeerValue()).resolves.toBe('compiled-peer-v1')
  })

  it('uses built client output when a local directory plugin has watch disabled', async () => {
    vi.stubEnv('__ONEWORKS_PROJECT_CLIENT_MODE__', 'desktop')
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'packaged-built')
    await mkdir(path.join(pluginRoot, 'client', 'src'), { recursive: true })
    await mkdir(path.join(pluginRoot, 'client', 'dist'), { recursive: true })
    await writeFile(path.join(pluginRoot, 'client', 'src', 'index.ts'), 'export const sourceOnly = true\n')
    await writeFile(path.join(pluginRoot, 'client', 'dist', 'index.js'), 'export const builtOnly = true\n')
    await writeFile(
      path.join(pluginRoot, 'package.json'),
      JSON.stringify(
        {
          name: '@local/plugin-packaged-built',
          exports: {
            './client': {
              source: './client/src/index.ts',
              default: './client/dist/index.js'
            },
            './package.json': './package.json'
          }
        },
        null,
        2
      )
    )
    await writeFile(path.join(pluginRoot, 'plugin.json'), JSON.stringify({ plugin: {} }, null, 2))
    mocks.loadConfigState.mockResolvedValue({
      workspaceFolder,
      mergedConfig: { plugins: [{ id: pluginRoot, scope: 'packaged-built', watch: false }] }
    })

    const listResponse = await fetch(`${baseUrl}/api/plugins`)
    const listPayload = await listResponse.json() as {
      plugins: Array<{
        client?: {
          clientEntryUrl?: string
          devClientEntryKind?: string
          devClientEntryUrl?: string
        }
      }>
    }
    expect(listPayload.plugins[0]?.client).toMatchObject({
      clientEntryUrl: '/api/plugins/packaged-built/client/dist/index.js'
    })
    expect(listPayload.plugins[0]?.client?.devClientEntryKind).toBeUndefined()
    expect(listPayload.plugins[0]?.client?.devClientEntryUrl).toBeUndefined()
    const sourceResponse = await fetch(
      `${baseUrl}/api/plugins/packaged-built/client-source/client/src/index.ts`
    )
    expect(sourceResponse.status).toBe(404)
  })

  it.each(['desktop', 'independent', 'standalone', 'static'])(
    'falls back to bounded client source in %s mode when built output is missing and watch is disabled',
    async (clientMode) => {
      vi.stubEnv('__ONEWORKS_PROJECT_CLIENT_MODE__', clientMode)
      const pluginRoot = path.join(workspaceFolder, 'plugins', 'packaged-source-fallback')
      await mkdir(path.join(pluginRoot, 'src', 'client'), { recursive: true })
      await mkdir(path.join(pluginRoot, 'src', 'shared'), { recursive: true })
      await writeFile(
        path.join(pluginRoot, 'src', 'shared', 'value.ts'),
        'export const sharedFallback = true\n'
      )
      await writeFile(
        path.join(pluginRoot, 'index.js'),
        'export const unrelatedRootEntry = true\n'
      )
      await writeFile(
        path.join(pluginRoot, 'src', 'client', 'index.ts'),
        [
          "import { sharedFallback } from '../shared/value'",
          'export const sourceFallback = sharedFallback',
          'export const activatePlugin = () => undefined'
        ].join('\n')
      )
      await writeFile(
        path.join(pluginRoot, 'package.json'),
        JSON.stringify(
          {
            name: '@local/plugin-packaged-source-fallback',
            exports: {
              './client': {
                source: './src/client/index.ts',
                default: './dist/client/index.js'
              },
              './package.json': './package.json'
            }
          },
          null,
          2
        )
      )
      await writeFile(
        path.join(pluginRoot, 'plugin.json'),
        JSON.stringify({ plugin: { client: { sourceRoot: 'src' } } }, null, 2)
      )
      mocks.loadConfigState.mockResolvedValue({
        workspaceFolder,
        mergedConfig: {
          plugins: [{ id: pluginRoot, scope: 'packaged-source-fallback', watch: false }]
        }
      })

      const listResponse = await fetch(`${baseUrl}/api/plugins`)
      const listPayload = await listResponse.json() as {
        plugins: Array<{
          client?: {
            clientEntryUrl?: string
            devClientEntryKind?: string
            devClientEntryUrl?: string
          }
          diagnostics?: unknown[]
          watch?: { enabled?: boolean }
        }>
      }
      const fallbackEntry = '/api/plugins/packaged-source-fallback/client-source/src/client/index.ts'
      expect(listPayload.plugins[0]).toMatchObject({
        client: {
          clientEntryUrl: fallbackEntry,
          devClientEntryKind: 'runtime-source',
          devClientEntryUrl: fallbackEntry
        },
        diagnostics: [],
        watch: { enabled: false }
      })

      const sourceResponse = await fetch(`${baseUrl}${fallbackEntry}`)
      const sourceText = await sourceResponse.text()
      expect(sourceResponse.status, sourceText).toBe(200)
      expect(sourceResponse.headers.get('content-type')).toContain('text/javascript')
      expect(sourceText).toContain('activatePlugin')
      expect(sourceText).toContain('sourceFallback')
      expect(sourceText).not.toContain('unrelatedRootEntry')
    }
  )

  it('falls back to client source when a built entry symlink escapes its asset root', async () => {
    vi.stubEnv('__ONEWORKS_PROJECT_CLIENT_MODE__', 'desktop')
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'symlinked-built-entry')
    const outsideEntry = path.join(workspaceFolder, 'outside-built-entry.js')
    await mkdir(path.join(pluginRoot, 'client', 'src'), { recursive: true })
    await mkdir(path.join(pluginRoot, 'client', 'dist'), { recursive: true })
    await writeFile(outsideEntry, 'export const escapedBuiltEntry = true\n')
    await symlink(outsideEntry, path.join(pluginRoot, 'client', 'dist', 'index.js'))
    await writeFile(
      path.join(pluginRoot, 'client', 'src', 'index.ts'),
      'export const safeSourceFallback = true\n'
    )
    await writeFile(
      path.join(pluginRoot, 'package.json'),
      JSON.stringify(
        {
          name: '@local/plugin-symlinked-built-entry',
          exports: {
            './client': {
              source: './client/src/index.ts',
              default: './client/dist/index.js'
            },
            './package.json': './package.json'
          }
        },
        null,
        2
      )
    )
    await writeFile(path.join(pluginRoot, 'plugin.json'), JSON.stringify({ plugin: {} }, null, 2))
    mocks.loadConfigState.mockResolvedValue({
      workspaceFolder,
      mergedConfig: {
        plugins: [{ id: pluginRoot, scope: 'symlinked-built-entry', watch: false }]
      }
    })

    const listResponse = await fetch(`${baseUrl}/api/plugins`)
    const listPayload = await listResponse.json() as {
      plugins: Array<{ client?: { clientEntryUrl?: string }; diagnostics?: unknown[] }>
    }
    const fallbackEntry = '/api/plugins/symlinked-built-entry/client-source/client/src/index.ts'
    expect(listPayload.plugins[0]).toMatchObject({
      client: { clientEntryUrl: fallbackEntry },
      diagnostics: []
    })

    const builtResponse = await fetch(
      `${baseUrl}/api/plugins/symlinked-built-entry/client/dist/index.js`
    )
    expect(builtResponse.status).toBe(404)
    const sourceResponse = await fetch(`${baseUrl}${fallbackEntry}`)
    const sourceText = await sourceResponse.text()
    expect(sourceResponse.status, sourceText).toBe(200)
    expect(sourceText).toContain('safeSourceFallback')
    expect(sourceText).not.toContain('escapedBuiltEntry')
  })

  it('does not expose host Vite source entries outside allowed local roots', async () => {
    const pluginRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-plugin-host-vite-outside-'))
    try {
      await mkdir(path.join(pluginRoot, 'client', 'src'), { recursive: true })
      await mkdir(path.join(pluginRoot, 'client', 'dist'), { recursive: true })
      await writeFile(path.join(pluginRoot, 'client', 'src', 'index.tsx'), 'export const sourcePlugin = true\n')
      await writeFile(path.join(pluginRoot, 'client', 'dist', 'index.js'), 'export const builtPlugin = true\n')
      await writeFile(
        path.join(pluginRoot, 'package.json'),
        JSON.stringify(
          {
            name: '@local/plugin-host-vite-outside',
            exports: {
              './client': {
                source: './client/src/index.tsx',
                default: './client/dist/index.js'
              },
              './package.json': './package.json'
            }
          },
          null,
          2
        )
      )
      await writeFile(path.join(pluginRoot, 'plugin.json'), JSON.stringify({ plugin: {} }, null, 2))
      mocks.loadConfigState.mockResolvedValue({
        workspaceFolder,
        mergedConfig: { plugins: [{ id: pluginRoot, scope: 'host-vite-outside', watch: true }] }
      })

      const listResponse = await fetch(`${baseUrl}/api/plugins`)
      const listPayload = await listResponse.json() as {
        plugins: Array<{ client?: { clientEntryUrl?: string; devClientEntryUrl?: string }; name?: string }>
      }
      expect(listPayload.plugins[0]).toMatchObject({
        client: {
          clientEntryUrl: '/api/plugins/host-vite-outside/client/dist/index.js'
        },
        name: '@local/plugin-host-vite-outside'
      })
      expect(listPayload.plugins[0]?.client?.devClientEntryUrl).toBeUndefined()
    } finally {
      await rm(pluginRoot, { recursive: true, force: true })
    }
  })

  it('uses configured allow roots for bounded external local plugin source exports', async () => {
    const previousAllow = process.env.__ONEWORKS_PROJECT_CLIENT_FS_ALLOW__
    const previousBase = process.env.__ONEWORKS_PROJECT_CLIENT_BASE__
    process.env.__ONEWORKS_PROJECT_CLIENT_BASE__ = '/ui/'
    const pluginRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-plugin-host-vite-allowed-'))
    process.env.__ONEWORKS_PROJECT_CLIENT_FS_ALLOW__ = JSON.stringify([pluginRoot])
    try {
      await mkdir(path.join(pluginRoot, 'client', 'src'), { recursive: true })
      await mkdir(path.join(pluginRoot, 'client', 'dist'), { recursive: true })
      await writeFile(path.join(pluginRoot, 'client', 'src', 'index.tsx'), 'export const sourcePlugin = true\n')
      await writeFile(path.join(pluginRoot, 'client', 'dist', 'index.js'), 'export const builtPlugin = true\n')
      await writeFile(
        path.join(pluginRoot, 'package.json'),
        JSON.stringify(
          {
            name: '@local/plugin-host-vite-allowed',
            exports: {
              './client': {
                source: './client/src/index.tsx',
                default: './client/dist/index.js'
              },
              './package.json': './package.json'
            }
          },
          null,
          2
        )
      )
      await writeFile(path.join(pluginRoot, 'plugin.json'), JSON.stringify({ plugin: {} }, null, 2))
      mocks.loadConfigState.mockResolvedValue({
        workspaceFolder,
        mergedConfig: { plugins: [{ id: pluginRoot, scope: 'host-vite-allowed', watch: true }] }
      })

      const listResponse = await fetch(`${baseUrl}/api/plugins`)
      const listPayload = await listResponse.json() as {
        plugins: Array<{ client?: { clientEntryUrl?: string; devClientEntryUrl?: string }; name?: string }>
      }
      expect(listPayload.plugins[0]).toMatchObject({
        client: {
          clientEntryUrl: '/api/plugins/host-vite-allowed/client/dist/index.js',
          devClientEntryUrl: '/api/plugins/host-vite-allowed/client-source/client/src/index.tsx'
        },
        name: '@local/plugin-host-vite-allowed'
      })
    } finally {
      if (previousAllow == null) {
        delete process.env.__ONEWORKS_PROJECT_CLIENT_FS_ALLOW__
      } else {
        process.env.__ONEWORKS_PROJECT_CLIENT_FS_ALLOW__ = previousAllow
      }
      if (previousBase == null) {
        delete process.env.__ONEWORKS_PROJECT_CLIENT_BASE__
      } else {
        process.env.__ONEWORKS_PROJECT_CLIENT_BASE__ = previousBase
      }
      await rm(pluginRoot, { recursive: true, force: true })
    }
  })

  it('uses an allowed bounded source when external built output is missing and watch is disabled', async () => {
    const previousAllow = process.env.__ONEWORKS_PROJECT_CLIENT_FS_ALLOW__
    const previousBase = process.env.__ONEWORKS_PROJECT_CLIENT_BASE__
    process.env.__ONEWORKS_PROJECT_CLIENT_BASE__ = '/ui/'
    const pluginRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-plugin-host-vite-fallback-'))
    process.env.__ONEWORKS_PROJECT_CLIENT_FS_ALLOW__ = JSON.stringify([pluginRoot])
    try {
      await mkdir(path.join(pluginRoot, 'client', 'src'), { recursive: true })
      await writeFile(
        path.join(pluginRoot, 'client', 'src', 'index.tsx'),
        'export const sourceFallback = true\n'
      )
      await writeFile(
        path.join(pluginRoot, 'package.json'),
        JSON.stringify(
          {
            name: '@local/plugin-host-vite-fallback',
            exports: {
              './client': {
                source: './client/src/index.tsx',
                default: './client/dist/index.js'
              },
              './package.json': './package.json'
            }
          },
          null,
          2
        )
      )
      await writeFile(path.join(pluginRoot, 'plugin.json'), JSON.stringify({ plugin: {} }, null, 2))
      mocks.loadConfigState.mockResolvedValue({
        workspaceFolder,
        mergedConfig: {
          plugins: [{ id: pluginRoot, scope: 'host-vite-fallback', watch: false }]
        }
      })

      const listResponse = await fetch(`${baseUrl}/api/plugins`)
      const listPayload = await listResponse.json() as {
        plugins: Array<{
          client?: {
            clientEntryUrl?: string
            devClientEntryKind?: string
            devClientEntryUrl?: string
          }
          diagnostics?: unknown[]
        }>
      }
      const fallbackEntry = '/api/plugins/host-vite-fallback/client-source/client/src/index.tsx'
      expect(listPayload.plugins[0]).toMatchObject({
        client: {
          clientEntryUrl: fallbackEntry,
          devClientEntryKind: 'runtime-source',
          devClientEntryUrl: fallbackEntry
        },
        diagnostics: []
      })
    } finally {
      if (previousAllow == null) {
        delete process.env.__ONEWORKS_PROJECT_CLIENT_FS_ALLOW__
      } else {
        process.env.__ONEWORKS_PROJECT_CLIENT_FS_ALLOW__ = previousAllow
      }
      if (previousBase == null) {
        delete process.env.__ONEWORKS_PROJECT_CLIENT_BASE__
      } else {
        process.env.__ONEWORKS_PROJECT_CLIENT_BASE__ = previousBase
      }
      await rm(pluginRoot, { recursive: true, force: true })
    }
  })

  async function startDevServer(source: string) {
    devServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/javascript' })
      res.end(source)
    })
    await new Promise<void>((resolve) => {
      devServer!.listen(0, '127.0.0.1', () => resolve())
    })
    const address = devServer.address()
    if (address == null || typeof address === 'string') {
      throw new Error('Failed to start plugin dev server')
    }
    return `http://127.0.0.1:${address.port}`
  }
})

const closeServer = async (server: http.Server | undefined) => {
  await new Promise<void>((resolve, reject) => {
    if (server == null) {
      resolve()
      return
    }
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}
