import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import Router from '@koa/router'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { pluginsRouter } from '#~/routes/plugins.js'
import { resetPluginManagerForTests } from '#~/services/plugins/index.js'

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
    workspaceFolder = await mkdtemp(path.join(os.tmpdir(), 'ow-plugin-package-exports-'))
    const app = new Koa()
    const rootRouter = new Router({ prefix: '/api/plugins' })
    const router = pluginsRouter()
    rootRouter.use(router.routes())
    rootRouter.use(router.allowedMethods())
    app.use(bodyParser())
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

  it('keeps bundled official packages in the built-in source group when enabled by project config', async () => {
    const pluginRoot = path.join(
      workspaceFolder,
      'node_modules',
      '@oneworks',
      'plugin-logger'
    )
    await mkdir(pluginRoot, { recursive: true })
    await writeFile(
      path.join(pluginRoot, 'package.json'),
      JSON.stringify({
        name: '@oneworks/plugin-logger',
        version: '0.1.0'
      })
    )
    await writeFile(
      path.join(pluginRoot, 'plugin.json'),
      JSON.stringify({
        displayName: 'Logger',
        name: '@oneworks/plugin-logger'
      })
    )
    const pluginConfig = { id: '@oneworks/plugin-logger', scope: 'logger' }
    mocks.loadConfigState.mockResolvedValue({
      workspaceFolder,
      mergedConfig: { plugins: [pluginConfig] },
      projectSource: { resolvedConfig: { plugins: [pluginConfig] } }
    })

    const listResponse = await fetch(`${baseUrl}/api/plugins`)
    const listPayload = await listResponse.json() as {
      plugins: Array<{ packageId?: string; sourceGroup?: string }>
    }
    expect(listPayload.plugins[0]).toMatchObject({
      packageId: '@oneworks/plugin-logger',
      sourceGroup: 'builtIn'
    })
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

  it('uses the host Vite dev server entry for local client source exports', async () => {
    const previousBase = process.env.__ONEWORKS_PROJECT_CLIENT_BASE__
    process.env.__ONEWORKS_PROJECT_CLIENT_BASE__ = '/ui/'
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
          devClientEntryUrl: await toHostViteFsPath(path.join(pluginRoot, 'client', 'src', 'index.tsx'), '/ui')
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

  it('uses configured host Vite allow roots for external local plugin source exports', async () => {
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
          devClientEntryUrl: await toHostViteFsPath(path.join(pluginRoot, 'client', 'src', 'index.tsx'), '/ui')
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
