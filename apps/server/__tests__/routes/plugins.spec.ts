/* eslint-disable max-lines -- plugin route coverage shares one Koa fixture across scoped runtime scenarios. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import Router from '@koa/router'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { pluginsRouter } from '#~/routes/plugins.js'
import { getPluginManager, resetPluginManagerForTests } from '#~/services/plugins/index.js'

const mocks = vi.hoisted(() => ({
  listLauncherWorkspaceRuntimeEndpoints: vi.fn<() => Promise<unknown[]>>(async () => []),
  loadConfigState: vi.fn()
}))

vi.mock('#~/services/config/index.js', () => ({
  buildConfigJsonVariables: vi.fn(() => ({})),
  loadConfigState: mocks.loadConfigState
}))

vi.mock('#~/services/launcher/manager.js', () => ({
  listLauncherWorkspaceRuntimeEndpoints: mocks.listLauncherWorkspaceRuntimeEndpoints
}))

const createPlugin = async (
  root: string,
  manifest: Record<string, unknown>,
  serverEntry?: string
) => {
  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await mkdir(path.join(root, 'client'), { recursive: true })
  await writeFile(path.join(root, 'client', 'index.js'), 'export const plugin = true\n')
  if (serverEntry != null) {
    await writeFile(path.join(root, 'server.mjs'), serverEntry)
  }
}

describe('pluginsRouter', () => {
  let workspaceFolder = ''
  let server: http.Server | undefined
  let baseUrl = ''
  let devServers: http.Server[] = []

  beforeEach(async () => {
    vi.stubEnv('__ONEWORKS_PROJECT_DISABLE_DEFAULT_OFFICIAL_PLUGINS__', '1')
    vi.stubEnv('__ONEWORKS_PROJECT_DISABLE_GLOBAL_CONFIG__', '1')
    workspaceFolder = await fsMkdtemp('ow-plugin-routes-')
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
    await Promise.all(devServers.map(devServer =>
      new Promise<void>((resolve, reject) => {
        devServer.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    ))
    devServers = []
    await rm(workspaceFolder, { recursive: true, force: true })
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('supports disabling default official plugins for isolated runtimes', async () => {
    mockConfig([])

    const response = await fetch(`${baseUrl}/api/plugins`)
    const payload = await response.json() as {
      plugins: Array<{ packageId?: string; scope: string }>
      diagnostics: unknown[]
    }

    expect(response.status).toBe(200)
    expect(payload.diagnostics).toEqual([])
    expect(payload.plugins).toEqual([])
  })

  it('allows the default Relay plugin to be explicitly disabled', async () => {
    vi.stubEnv('__ONEWORKS_PROJECT_DISABLE_DEFAULT_OFFICIAL_PLUGINS__', '0')
    vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_DIR__', path.resolve('.'))
    mockConfig([{ enabled: false, id: '@oneworks/plugin-relay' }])

    const response = await fetch(`${baseUrl}/api/plugins`)
    const payload = await response.json() as {
      plugins: Array<{ enabled: boolean; packageId?: string; scope: string }>
      diagnostics: unknown[]
    }

    expect(response.status).toBe(200)
    expect(payload.diagnostics).toEqual([])
    expect(payload.plugins).toContainEqual(expect.objectContaining({
      enabled: false,
      packageId: '@oneworks/plugin-relay',
      scope: 'relay'
    }))
  })

  it('lists configured plugins and exposes client entries', async () => {
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'docs')
    await createPlugin(pluginRoot, {
      name: 'docs-plugin',
      displayName: 'Docs',
      plugin: {
        client: { entry: './client/index.js' },
        contributions: {
          navItems: [{ id: 'home', title: 'Docs' }]
        }
      }
    })
    mockConfig([{ id: pluginRoot, scope: 'docs' }])

    const response = await fetch(`${baseUrl}/api/plugins`)
    const payload = await response.json() as {
      plugins: Array<{ scope: string; client?: { clientEntryUrl?: string }; diagnostics: unknown[] }>
      diagnostics: unknown[]
    }

    expect(response.status).toBe(200)
    expect(payload.diagnostics).toEqual([])
    expect(payload.plugins).toMatchObject([
      {
        scope: 'docs',
        client: {
          clientEntryUrl: '/api/plugins/docs/client/index.js'
        },
        diagnostics: []
      }
    ])
  })

  it('does not auto-discover global plugins when merged config disables global config', async () => {
    const previousRealHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__
    const realHome = await fsMkdtemp('ow-plugin-global-home-')
    process.env.__ONEWORKS_PROJECT_REAL_HOME__ = realHome
    try {
      const globalPluginRoot = path.join(realHome, '.oneworks', 'global', 'plugins', 'global')
      await createPlugin(globalPluginRoot, {
        name: 'global',
        plugin: {
          client: { entry: './client/index.js' }
        }
      })
      mocks.loadConfigState.mockResolvedValue({
        workspaceFolder,
        globalConfig: undefined,
        globalSource: {
          resolvedConfig: { disableGlobalConfig: true }
        },
        mergedConfig: { disableGlobalConfig: true }
      })
      vi.stubEnv('__ONEWORKS_PROJECT_DISABLE_DEFAULT_OFFICIAL_PLUGINS__', '1')

      const response = await fetch(`${baseUrl}/api/plugins`)
      const payload = await response.json() as {
        plugins: Array<{ scope: string }>
      }

      expect(response.status).toBe(200)
      expect(payload.plugins).toEqual([])
    } finally {
      if (previousRealHome == null) {
        delete process.env.__ONEWORKS_PROJECT_REAL_HOME__
      } else {
        process.env.__ONEWORKS_PROJECT_REAL_HOME__ = previousRealHome
      }
      await rm(realHome, { recursive: true, force: true })
    }
  })

  it('toggles watch mode for a specific plugin scope', async () => {
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'watched')
    await createPlugin(pluginRoot, {
      name: 'watched',
      plugin: {
        client: { entry: './client/index.js' }
      }
    })
    mockConfig([{ id: pluginRoot, scope: 'watched' }])

    const initialResponse = await fetch(`${baseUrl}/api/plugins/watched/watch`)
    await expect(initialResponse.json()).resolves.toEqual({
      scope: 'watched',
      watch: { enabled: false }
    })

    const enableResponse = await fetch(`${baseUrl}/api/plugins/watched/watch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true })
    })
    await expect(enableResponse.json()).resolves.toEqual({
      scope: 'watched',
      watch: { enabled: true }
    })

    const listResponse = await fetch(`${baseUrl}/api/plugins`)
    const listPayload = await listResponse.json() as {
      plugins: Array<{
        diagnostics?: Array<{ code: string }>
        scope: string
        watch?: { enabled: boolean }
      }>
    }
    const watchedPlugin = listPayload.plugins.find(plugin => plugin.scope === 'watched')
    expect(watchedPlugin?.watch?.enabled).toEqual(expect.any(Boolean))
    if (watchedPlugin?.watch?.enabled === false) {
      expect(watchedPlugin.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'plugin_watch_failed' })
      ]))
    }

    const disableResponse = await fetch(`${baseUrl}/api/plugins/watched/watch`, { method: 'DELETE' })
    await expect(disableResponse.json()).resolves.toEqual({
      scope: 'watched',
      watch: { enabled: false }
    })
  })

  it('invokes scoped server commands', async () => {
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'tools')
    await createPlugin(
      pluginRoot,
      {
        name: 'tools',
        plugin: {
          server: { entry: './server.mjs', roles: ['workspace'] }
        }
      },
      `
      export async function activatePlugin(ctx) {
        ctx.registerCommand('echo', async payload => ({ scope: ctx.scope, payload }))
      }
    `
    )
    mockConfig([{ id: pluginRoot, scope: 'tools' }])

    const response = await fetch(`${baseUrl}/api/plugins/tools/commands/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: { text: 'hello' } })
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ scope: 'tools', payload: { text: 'hello' } })
  })

  it('invokes scoped runtime channels on the current runtime', async () => {
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'runtime')
    await createPlugin(
      pluginRoot,
      {
        name: 'runtime',
        plugin: {
          server: { entry: './server.mjs', roles: ['workspace'] }
        }
      },
      `
      export async function activatePlugin(ctx) {
        ctx.runtime.registerChannel('echo', async request => ({
          payload: request.payload,
          role: ctx.runtime.role,
          sourceRole: request.source.role,
          targetRole: request.target.role
        }))
      }
    `
    )
    mockConfig([{ id: pluginRoot, scope: 'runtime' }])

    const runtimeResponse = await fetch(`${baseUrl}/api/plugins/runtime`)
    const runtimePayload = await runtimeResponse.json() as {
      runtime: { projectHome?: string; role: string; workspaceFolder?: string }
    }
    expect(runtimePayload.runtime.role).toBe('workspace')
    expect(runtimePayload.runtime).not.toHaveProperty('projectHome')
    expect(runtimePayload.runtime).not.toHaveProperty('workspaceFolder')
    expect(JSON.stringify(runtimePayload)).not.toContain(workspaceFolder)

    const response = await fetch(`${baseUrl}/api/plugins/runtime/runtime/channels/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: { text: 'hello' } })
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      ok: true,
      payload: {
        payload: { text: 'hello' },
        role: 'workspace',
        sourceRole: 'workspace',
        targetRole: 'workspace'
      }
    })
  })

  it('does not run unresolved cross-workspace runtime targets on the current workspace', async () => {
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'runtime-target')
    await createPlugin(
      pluginRoot,
      {
        name: 'runtime-target',
        plugin: {
          server: { entry: './server.mjs', roles: ['workspace'] }
        }
      },
      `
      export async function activatePlugin(ctx) {
        ctx.runtime.registerChannel('echo', async request => ({
          local: true,
          payload: request.payload
        }))
        ctx.registerCommand('call-other-workspace', async payload => ctx.runtime.invokeChannel('echo', {
          payload,
          target: {
            role: 'workspace',
            workspaceId: 'other-workspace'
          }
        }))
      }
    `
    )
    mockConfig([{ id: pluginRoot, scope: 'runtime-target' }])

    const response = await fetch(`${baseUrl}/api/plugins/runtime-target/commands/call-other-workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: { text: 'hello' } })
    })
    const message = await response.text()

    expect(response.status).toBe(400)
    expect(message).toContain('requires target.serverBaseUrl or a known runtime endpoint')
  })

  it('lists the current workspace runtime endpoint', async () => {
    mockConfig([])

    const response = await fetch(`${baseUrl}/api/plugins/runtime/endpoints`)
    const payload = await response.json() as {
      endpoints: Array<{ current?: boolean; role: string; status?: string }>
    }

    expect(response.status).toBe(200)
    expect(payload.endpoints).toEqual([
      expect.objectContaining({
        current: true,
        role: 'workspace',
        status: 'online'
      })
    ])
  })

  it('lists the current manager runtime endpoint', async () => {
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_ROLE__', 'manager')
    mockConfig([])

    const response = await fetch(`${baseUrl}/api/plugins/runtime/endpoints`)
    const payload = await response.json() as {
      endpoints: Array<{ current?: boolean; role: string; status?: string }>
    }

    expect(response.status).toBe(200)
    expect(payload.endpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        current: true,
        role: 'manager',
        status: 'online'
      })
    ]))
  })

  it('omits malformed private runtime endpoint metadata from manager responses', async () => {
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_ROLE__', 'manager')
    const rawLauncherEndpoints: unknown[] = [
      {
        accessToken: 'credential-sentinel',
        id: 'workspace:private-metadata',
        role: 'workspace',
        serverBaseUrl: 'https://credential-sentinel:credential-sentinel@127.0.0.1:8787',
        startedAt: workspaceFolder,
        status: 'offline',
        workspaceFolder
      },
      {
        id: 'workspace:safe-metadata',
        role: 'workspace',
        serverBaseUrl: 'http://127.0.0.1:8787',
        startedAt: '2026-07-30T00:00:00.000Z',
        status: 'online'
      }
    ]
    mocks.listLauncherWorkspaceRuntimeEndpoints.mockResolvedValueOnce(rawLauncherEndpoints)
    mockConfig([])

    const response = await fetch(`${baseUrl}/api/plugins/runtime/endpoints`)
    const payload = await response.json() as { endpoints: Array<Record<string, unknown>> }
    const endpoint = payload.endpoints.find(item => item.id === 'workspace:private-metadata')

    expect(response.status).toBe(200)
    expect(endpoint).toEqual({
      id: 'workspace:private-metadata',
      role: 'workspace',
      status: 'offline'
    })
    expect(JSON.stringify(payload)).not.toContain(workspaceFolder)
    expect(JSON.stringify(payload)).not.toContain('credential-sentinel')
    expect(payload.endpoints).toContainEqual({
      id: 'workspace:safe-metadata',
      role: 'workspace',
      serverBaseUrl: 'http://127.0.0.1:8787',
      startedAt: '2026-07-30T00:00:00.000Z',
      status: 'online'
    })
  })

  it('serves client assets and rejects traversal', async () => {
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'assets')
    await createPlugin(pluginRoot, {
      name: 'assets',
      plugin: {
        client: { entry: './client/index.js' }
      }
    })
    mockConfig([{ id: pluginRoot, scope: 'assets' }])

    const assetResponse = await fetch(`${baseUrl}/api/plugins/assets/client/index.js`)
    expect(assetResponse.status).toBe(200)
    expect(assetResponse.headers.get('content-type')).toContain('text/javascript')
    await expect(assetResponse.text()).resolves.toContain('plugin = true')

    const traversalResponse = await fetch(`${baseUrl}/api/plugins/assets/client/..%2Fplugin.json`)
    expect(traversalResponse.status).toBe(404)
  })

  it('serves plugin README.md and README assets inside the plugin root', async () => {
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'readme')
    await createPlugin(pluginRoot, {
      name: 'readme',
      plugin: {
        client: { entry: './client/index.js' }
      }
    })
    await mkdir(path.join(pluginRoot, 'assets'), { recursive: true })
    await writeFile(path.join(pluginRoot, 'README.md'), '# Readme Plugin\n\n![Logo](assets/logo.svg)\n')
    await writeFile(path.join(pluginRoot, 'assets', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" />')
    await writeFile(path.join(workspaceFolder, 'secret.txt'), 'outside')
    mockConfig([{ id: pluginRoot, scope: 'readme' }])

    const readmeResponse = await fetch(`${baseUrl}/api/plugins/readme/readme`)
    const readmePayload = await readmeResponse.json() as {
      readme: { content: string; path: string } | null
      scope: string
    }

    expect(readmeResponse.status).toBe(200)
    expect(readmePayload).toMatchObject({
      scope: 'readme',
      readme: {
        path: 'README.md',
        content: expect.stringContaining('# Readme Plugin')
      }
    })

    const assetResponse = await fetch(`${baseUrl}/api/plugins/readme/readme/assets/assets/logo.svg`)
    expect(assetResponse.status).toBe(200)
    expect(assetResponse.headers.get('content-type')).toContain('image/svg+xml')

    const traversalResponse = await fetch(`${baseUrl}/api/plugins/readme/readme/assets/..%2F..%2Fsecret.txt`)
    expect(traversalResponse.status).toBe(404)
  })

  it('proxies plugin dev assets through the same server route', async () => {
    const devServerUrl = await startDevServer('export const devPlugin = true\n')
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'dev')
    await createPlugin(pluginRoot, {
      name: 'dev',
      plugin: {
        client: { entry: './client/index.js', devServer: devServerUrl }
      }
    })
    mockConfig([{ id: pluginRoot, scope: 'dev' }])

    const listResponse = await fetch(`${baseUrl}/api/plugins`)
    const listPayload = await listResponse.json() as {
      plugins: Array<{ client?: { devClientEntryUrl?: string } }>
    }
    expect(listPayload.plugins[0]?.client?.devClientEntryUrl).toBe('/api/plugins/dev/dev/index.js')

    const devAssetResponse = await fetch(`${baseUrl}/api/plugins/dev/dev/index.js`)
    expect(devAssetResponse.status).toBe(200)
    await expect(devAssetResponse.text()).resolves.toContain('devPlugin = true')
  })

  it('keeps manifest-declared client and server paths inside the plugin root', async () => {
    await writeFile(path.join(workspaceFolder, 'outside-client.js'), 'export const outside = true\n')
    await writeFile(
      path.join(workspaceFolder, 'outside-server.mjs'),
      `
      export async function activatePlugin(ctx) {
        ctx.registerCommand('outside', () => 'outside')
      }
    `
    )
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'escape')
    await createPlugin(pluginRoot, {
      name: 'escape',
      plugin: {
        client: { entry: '../outside-client.js', root: '..' },
        server: { entry: '../outside-server.mjs', roles: ['workspace'] }
      }
    })
    mockConfig([{ id: pluginRoot, scope: 'escape' }])

    const assetResponse = await fetch(`${baseUrl}/api/plugins/escape/client/outside-client.js`)
    expect(assetResponse.status).toBe(404)

    const commandResponse = await fetch(`${baseUrl}/api/plugins/escape/commands/outside`, { method: 'POST' })
    expect(commandResponse.status).toBe(404)
  })

  it('runs registered in-process proxy handlers inside scope', async () => {
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'api')
    await createPlugin(
      pluginRoot,
      {
        name: 'api',
        plugin: {
          server: { entry: './server.mjs', roles: ['workspace'] }
        }
      },
      `
      export async function activatePlugin(ctx) {
        ctx.registerApi('local', {
          title: 'Local API',
          description: 'Echoes request metadata for plugin API tests.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' }
            },
            additionalProperties: true
          },
          outputSchema: {
            type: 'object',
            required: ['method', 'path', 'body'],
            properties: {
              method: { type: 'string' },
              path: { type: 'string' },
              body: { type: 'string' }
            }
          },
          headerSchema: {
            type: 'object',
            properties: {
              'content-type': { type: 'string' }
            },
            additionalProperties: true
          },
          handler: async request => ({
            status: 201,
            headers: { 'content-type': 'application/json' },
            body: { method: request.method, path: request.path, body: request.body.toString('utf8') }
          })
        })
      }
    `
    )
    mockConfig([{ id: pluginRoot, scope: 'api' }])

    const response = await fetch(`${baseUrl}/api/plugins/api/proxy/local/search?q=one`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'one' })
    })
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload).toEqual({
      method: 'POST',
      path: 'search',
      body: '{"query":"one"}'
    })

    const listResponse = await fetch(`${baseUrl}/api/plugins`)
    const listPayload = await listResponse.json() as {
      plugins: Array<{
        apis?: Array<{
          description?: string
          headerSchema?: Record<string, unknown>
          id: string
          inputSchema?: Record<string, unknown>
          mode: string
          outputSchema?: Record<string, unknown>
          target: string
          title?: string
        }>
        diagnostics: Array<{ code: string }>
        scope: string
      }>
    }
    const plugin = listPayload.plugins.find(item => item.scope === 'api')
    expect(plugin?.diagnostics).toEqual([])
    expect(plugin?.apis).toEqual([
      {
        description: 'Echoes request metadata for plugin API tests.',
        headerSchema: {
          type: 'object',
          properties: {
            'content-type': { type: 'string' }
          },
          additionalProperties: true
        },
        id: 'local',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' }
          },
          additionalProperties: true
        },
        mode: 'handler',
        outputSchema: {
          type: 'object',
          required: ['method', 'path', 'body'],
          properties: {
            method: { type: 'string' },
            path: { type: 'string' },
            body: { type: 'string' }
          }
        },
        target: '/api/plugins/api/proxy/local',
        title: 'Local API'
      }
    ])
  })

  it('rejects proxy paths that try to leave the plugin API scope', async () => {
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'proxy')
    await createPlugin(
      pluginRoot,
      {
        name: 'proxy',
        plugin: {
          server: { entry: './server.mjs', roles: ['workspace'] }
        }
      },
      `
      export async function activatePlugin(ctx) {
        ctx.registerApi('local', { proxy: { target: 'http://127.0.0.1:9/api/' } })
      }
    `
    )
    mockConfig([{ id: pluginRoot, scope: 'proxy' }])

    const response = await fetch(`${baseUrl}/api/plugins/proxy/proxy/local/..%2Fsecret`)
    expect(response.status).toBe(400)
  })

  it('runs manifest launcher providers through server commands', async () => {
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'launcher')
    await createPlugin(
      pluginRoot,
      {
        name: 'launcher',
        plugin: {
          server: { entry: './server.mjs', roles: ['workspace'] },
          contributions: {
            launcherSearchProviders: [
              { id: 'docs', title: 'Docs', command: 'search-docs' }
            ]
          }
        }
      },
      `
      export async function activatePlugin(ctx) {
        ctx.registerCommand('search-docs', async payload => {
          if (payload.action === 'invoke') return { invoked: payload.resultId }
          return [{ id: 'intro', title: 'Intro ' + payload.query }]
        })
      }
    `
    )
    mockConfig([{ id: pluginRoot, scope: 'launcher' }])

    const searchResponse = await fetch(`${baseUrl}/api/plugins/launcher/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'guide' })
    })
    const searchPayload = await searchResponse.json() as { results: Array<{ id: string; title: string }> }

    expect(searchPayload.results).toEqual([
      { id: 'launcher/docs/intro', title: 'Intro guide' }
    ])

    const invokeResponse = await fetch(`${baseUrl}/api/plugins/launcher/results/launcher%2Fdocs%2Fintro/invoke`, {
      method: 'POST'
    })
    await expect(invokeResponse.json()).resolves.toEqual({ invoked: 'launcher/docs/intro' })
  })

  it('filters launcher providers by contribution surface before invoking commands', async () => {
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'workspace-provider')
    await createPlugin(
      pluginRoot,
      {
        name: 'workspace-provider',
        plugin: {
          server: { entry: './server.mjs', roles: ['workspace'] },
          contributions: {
            surfaces: ['workspace'],
            launcherSearchProviders: [
              { id: 'workspace-only', title: 'Workspace Only', command: 'search-workspace' }
            ]
          }
        }
      },
      `
      export async function activatePlugin(ctx) {
        ctx.registerCommand('search-workspace', async payload => {
          if (payload.action === 'invoke') return { invoked: true }
          return [{ id: 'hidden', title: 'Hidden ' + payload.query }]
        })
      }
    `
    )
    mockConfig([{ id: pluginRoot, scope: 'workspace-provider' }])

    const searchResponse = await fetch(`${baseUrl}/api/plugins/launcher/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'guide' })
    })
    const searchPayload = await searchResponse.json() as { results: Array<{ id: string; title: string }> }

    expect(searchPayload.results).toEqual([])

    const invokeResponse = await fetch(
      `${baseUrl}/api/plugins/launcher/results/workspace-provider%2Fworkspace-only%2Fhidden/invoke`,
      { method: 'POST' }
    )
    expect(invokeResponse.status).toBe(404)
  })

  it('keeps activation failures isolated and reports diagnostics', async () => {
    const badPluginRoot = path.join(workspaceFolder, 'plugins', 'bad')
    const goodPluginRoot = path.join(workspaceFolder, 'plugins', 'good')
    await createPlugin(
      badPluginRoot,
      {
        name: 'bad',
        plugin: { server: { entry: './server.mjs', roles: ['workspace'] } }
      },
      `
      export async function activatePlugin() {
        throw new Error('boom')
      }
    `
    )
    await createPlugin(
      goodPluginRoot,
      {
        name: 'good',
        plugin: { server: { entry: './server.mjs', roles: ['workspace'] } }
      },
      `
      export async function activatePlugin(ctx) {
        ctx.registerCommand('ping', () => 'pong')
      }
    `
    )
    mockConfig([
      { id: badPluginRoot, scope: 'bad' },
      { id: goodPluginRoot, scope: 'good' }
    ])

    const listResponse = await fetch(`${baseUrl}/api/plugins`)
    const listPayload = await listResponse.json() as {
      plugins: Array<{ scope: string; enabled: boolean; diagnostics: Array<{ code: string }> }>
    }

    expect(listPayload.plugins.find(plugin => plugin.scope === 'bad')).toMatchObject({
      enabled: false,
      diagnostics: [{ code: 'plugin_activation_failed' }]
    })
    expect(listPayload.plugins.find(plugin => plugin.scope === 'good')).toMatchObject({ enabled: true })

    const commandResponse = await fetch(`${baseUrl}/api/plugins/good/commands/ping`, { method: 'POST' })
    await expect(commandResponse.text()).resolves.toBe('pong')
  })

  it('clears partial runtime registrations when activation fails', async () => {
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'flaky')
    await createPlugin(
      pluginRoot,
      {
        name: 'flaky',
        plugin: { server: { entry: './server.mjs', roles: ['workspace'] } }
      },
      `
      globalThis.__oneworksFlakyPluginActivationCount ??= 0
      export async function activatePlugin(ctx) {
        ctx.registerCommand('connect', () => 'connected')
        globalThis.__oneworksFlakyPluginActivationCount += 1
        if (globalThis.__oneworksFlakyPluginActivationCount === 1) {
          throw new Error('first activation failed')
        }
        ctx.registerCommand('ping', () => 'pong')
      }
    `
    )
    mockConfig([{ id: pluginRoot, scope: 'flaky' }])

    const listResponse = await fetch(`${baseUrl}/api/plugins`)
    const listPayload = await listResponse.json() as {
      plugins: Array<{ scope: string; enabled: boolean; diagnostics: Array<{ code: string }> }>
    }
    expect(listPayload.plugins.find(plugin => plugin.scope === 'flaky')).toMatchObject({
      enabled: false,
      diagnostics: [{ code: 'plugin_activation_failed' }]
    })

    const manager = getPluginManager()
    const record = manager.getRecord('flaky') as unknown as {
      apis: Map<string, unknown>
      commands: Map<string, unknown>
      instance: { enabled: boolean }
    }
    expect(record.commands.size).toBe(0)
    expect(record.apis.size).toBe(0)

    record.instance.enabled = true
    await (manager as unknown as {
      activateRecord: (runtimeRecord: unknown) => Promise<void>
    }).activateRecord(record)

    expect(record.instance.enabled).toBe(true)
    const commandResponse = await fetch(`${baseUrl}/api/plugins/flaky/commands/ping`, { method: 'POST' })
    await expect(commandResponse.text()).resolves.toBe('pong')
  })

  it('awaits asynchronous local services and disposes them during reload', async () => {
    const stateKey = '__oneworksAsyncLocalServiceState'
    const state = { disposes: 0, starts: 0 }
    ;(globalThis as unknown as Record<string, unknown>)[stateKey] = state
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'async-local-service')
    await createPlugin(
      pluginRoot,
      {
        name: 'async-local-service',
        plugin: { server: { entry: './server.mjs', roles: ['workspace'] } }
      },
      `
      const state = globalThis.${stateKey}
      export async function activatePlugin(ctx) {
        ctx.registerLocalService('bridge', async () => {
          state.starts += 1
          await Promise.resolve()
          return {
            async dispose() {
              await Promise.resolve()
              state.disposes += 1
            }
          }
        })
      }
    `
    )
    mockConfig([{ id: pluginRoot, scope: 'async-local-service' }])

    try {
      const initialResponse = await fetch(`${baseUrl}/api/plugins`)
      expect(initialResponse.status).toBe(200)
      expect(state).toEqual({ disposes: 0, starts: 1 })

      await getPluginManager().reload()

      expect(state).toEqual({ disposes: 1, starts: 2 })
    } finally {
      delete (globalThis as unknown as Record<string, unknown>)[stateKey]
    }
  })

  it('fails plugin activation when an asynchronous local service fails to start', async () => {
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'failed-local-service')
    await createPlugin(
      pluginRoot,
      {
        name: 'failed-local-service',
        plugin: { server: { entry: './server.mjs', roles: ['workspace'] } }
      },
      `
      export async function activatePlugin(ctx) {
        ctx.registerLocalService('bridge', async () => {
          await Promise.resolve()
          throw new Error('bridge startup failed')
        })
      }
    `
    )
    mockConfig([{ id: pluginRoot, scope: 'failed-local-service' }])

    const response = await fetch(`${baseUrl}/api/plugins`)
    const payload = await response.json() as {
      plugins: Array<{ diagnostics: Array<{ code: string; message: string }>; enabled: boolean; scope: string }>
    }

    expect(response.status).toBe(200)
    expect(payload.plugins.find(plugin => plugin.scope === 'failed-local-service')).toMatchObject({
      enabled: false,
      diagnostics: [{ code: 'plugin_activation_failed', message: 'bridge startup failed' }]
    })
  })

  it('rejects duplicate local service IDs and disposes the first service exactly once', async () => {
    const stateKey = '__oneworksDuplicateLocalServiceState'
    const state = { disposes: 0 }
    ;(globalThis as unknown as Record<string, unknown>)[stateKey] = state
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'duplicate-local-service')
    await createPlugin(
      pluginRoot,
      {
        name: 'duplicate-local-service',
        plugin: { server: { entry: './server.mjs', roles: ['workspace'] } }
      },
      `
      const state = globalThis.${stateKey}
      export async function activatePlugin(ctx) {
        ctx.registerLocalService('bridge', () => ({
          dispose() {
            state.disposes += 1
          }
        }))
        ctx.registerLocalService('bridge', () => ({ dispose() {} }))
      }
    `
    )
    mockConfig([{ id: pluginRoot, scope: 'duplicate-local-service' }])

    try {
      const response = await fetch(`${baseUrl}/api/plugins`)
      const payload = await response.json() as {
        plugins: Array<{ diagnostics: Array<{ code: string; message: string }>; enabled: boolean; scope: string }>
      }

      expect(response.status).toBe(200)
      expect(payload.plugins.find(plugin => plugin.scope === 'duplicate-local-service')).toMatchObject({
        enabled: false,
        diagnostics: [{
          code: 'plugin_activation_failed',
          message: 'Duplicate plugin local service "duplicate-local-service/bridge".'
        }]
      })
      expect(state.disposes).toBe(1)
    } finally {
      delete (globalThis as unknown as Record<string, unknown>)[stateKey]
    }
  })

  it('finishes a pending local service startup before dispose and allows a clean reload', async () => {
    const stateKey = '__oneworksPendingLocalServiceState'
    let releaseStart = () => {}
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve
    })
    let markStarted = () => {}
    const serviceStarted = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const state = {
      disposes: 0,
      markStarted,
      startGate,
      starts: 0
    }
    ;(globalThis as unknown as Record<string, unknown>)[stateKey] = state
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'pending-local-service')
    await createPlugin(
      pluginRoot,
      {
        name: 'pending-local-service',
        plugin: { server: { entry: './server.mjs', roles: ['workspace'] } }
      },
      `
      const state = globalThis.${stateKey}
      export async function activatePlugin(ctx) {
        ctx.registerLocalService('bridge', async () => {
          state.starts += 1
          state.markStarted()
          await state.startGate
          return {
            dispose() {
              state.disposes += 1
            }
          }
        })
      }
    `
    )
    mockConfig([{ id: pluginRoot, scope: 'pending-local-service' }])

    try {
      const manager = getPluginManager()
      const loading = manager.load()
      await serviceStarted
      const disposing = manager.dispose()
      releaseStart()
      await Promise.all([loading, disposing])

      expect(state.disposes).toBe(1)
      expect(manager.snapshot().plugins).toEqual([])

      await manager.load()

      expect(state.starts).toBe(2)
      expect(manager.snapshot().plugins).toEqual([
        expect.objectContaining({ enabled: true, scope: 'pending-local-service' })
      ])
    } finally {
      releaseStart()
      delete (globalThis as unknown as Record<string, unknown>)[stateKey]
    }
  })

  it('coalesces concurrent reloads so plugin activation does not register commands twice', async () => {
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'concurrent-reload')
    await createPlugin(
      pluginRoot,
      {
        name: 'concurrent-reload',
        plugin: { server: { entry: './server.mjs', roles: ['workspace'] } }
      },
      `
      globalThis.__oneworksConcurrentReloadActivationCount ??= 0
      export async function activatePlugin(ctx) {
        globalThis.__oneworksConcurrentReloadActivationCount += 1
        ctx.registerCommand('status', () => globalThis.__oneworksConcurrentReloadActivationCount)
        await new Promise(resolve => setTimeout(resolve, 25))
        ctx.registerCommand('ready', () => true)
      }
    `
    )
    mockConfig([{ id: pluginRoot, scope: 'concurrent-reload' }])

    const initialResponse = await fetch(`${baseUrl}/api/plugins`)
    expect(initialResponse.status).toBe(200)

    const manager = getPluginManager()
    await Promise.all([manager.reload(), manager.reload(), manager.reload()])

    const snapshot = manager.snapshot()
    expect(snapshot.plugins.find(plugin => plugin.scope === 'concurrent-reload')).toMatchObject({
      enabled: true,
      diagnostics: []
    })
    const commandResponse = await fetch(
      `${baseUrl}/api/plugins/concurrent-reload/commands/status`,
      { method: 'POST' }
    )
    await expect(commandResponse.json()).resolves.toBe(2)
  })

  it('reports duplicate scope diagnostics clearly', async () => {
    const firstRoot = path.join(workspaceFolder, 'plugins', 'first')
    const secondRoot = path.join(workspaceFolder, 'plugins', 'second')
    await createPlugin(firstRoot, { name: 'first', plugin: {} })
    await createPlugin(secondRoot, { name: 'second', plugin: {} })
    mockConfig([
      { id: firstRoot, scope: 'same' },
      { id: secondRoot, scope: 'same' }
    ])

    const response = await fetch(`${baseUrl}/api/plugins`)
    const payload = await response.json() as { diagnostics: Array<{ code: string; message: string }> }

    expect(response.status).toBe(200)
    expect(payload.diagnostics).toEqual([
      expect.objectContaining({
        code: 'plugin_discovery_failed',
        message: 'Failed to discover plugins.'
      })
    ])
  })

  it('serializes plugin metadata through a path-free public allowlist', async () => {
    vi.stubEnv('__ONEWORKS_PROJECT_DISABLE_DEFAULT_OFFICIAL_PLUGINS__', '1')
    vi.stubEnv('__ONEWORKS_PROJECT_DISABLE_GLOBAL_CONFIG__', '1')
    workspaceFolder = await fsMkdtemp('ow-plugin-public-serialization-')
    const pluginRoot = path.join(workspaceFolder, 'plugins', 'docs')
    const pluginFileUrl = pathToFileURL(pluginRoot).href
    const encodedPluginRoot = encodeURIComponent(pluginRoot)
    const credentialUrlKeys = [
      'clientsecretvalue',
      'CLIENTSECRETVALUE',
      'apiKeyValue',
      'oauth-client_secret.valueSuffix',
      '%2563lient%2553ecret%2556alue',
      'api%255Fkey%255Fvalue',
      'clientSecretValue%'
    ]
    const encodedAuthorizationValue = ['sk', '%252D', 'abcdefghijklmnop'].join('')
    const encodedCallbackValue = ['api', '%255F', 'key', '%253D', 'abcdefghijklmnop'].join('')
    const encodedTokenValue = ['ghp', '%252D', 'abcdefghijklmnop'].join('')
    await createPlugin(pluginRoot, {
      name: 'docs-plugin',
      description: `Loaded from ${pluginRoot}, ${pluginFileUrl}, and ${encodedPluginRoot}`,
      native: {
        adapter: 'codex',
        apps: [
          {
            id: 'docs',
            capabilities: ['read', 'WorkspaceConfigurationManagement', 'write'],
            authentication: {
              authorizationUrl:
                'https://example.test/oauth/authorize?client_id=docs&redirect_uri=%2Foauth%2Fcallback&redirect%255Furi=%2Fencoded&code_challenge=valid&login_hint=docs',
              callbackPath: '/oauth/callback',
              type: 'oauth2'
            },
            connectionRequirements: {
              endpoint: 'https://api.example.test/connect',
              required: true,
              type: 'oauth'
            },
            permissions: ['repository:read']
          },
          ...credentialUrlKeys.map((key, index) => ({
            authentication: {
              authorizationUrl: `https://example.test/oauth?${key}=must-not-leak`,
              type: 'oauth2'
            },
            id: `credential-key-${index}`
          })),
          {
            authentication: {
              authorizationUrl: 'https://example.test/oauth?clientSecretValue=must-not-leak',
              type: 'oauth2'
            },
            id: 'credential-url'
          },
          {
            authentication: {
              tokenUrl: 'https://example.test/token?oauthClientSecretValueSuffix=must-not-leak',
              type: 'oauth2'
            },
            id: 'credential-url-suffix'
          },
          {
            authentication: {
              authorizationUrl: `https://example.test/oauth?state=${encodedAuthorizationValue}`,
              type: 'oauth2'
            },
            id: 'encoded-authorization'
          },
          {
            authentication: {
              callbackPath: `/oauth/callback?state=${encodedCallbackValue}`,
              type: 'oauth2'
            },
            id: 'encoded-callback'
          },
          {
            authentication: {
              tokenUrl: `https://example.test/token?state=${encodedTokenValue}`,
              type: 'oauth2'
            },
            id: 'encoded-token'
          },
          {
            id: 'unknown-shape',
            metadata: { label: 'must-not-flow-to-public' }
          },
          {
            authentication: { type: 'Bearer must-not-leak-credential-value' },
            id: 'secret-shaped'
          },
          {
            id: `${pluginRoot}/attacker-selected-id`
          },
          {
            capabilities: ['read', `path=${pluginRoot}`],
            id: 'path-shaped-capability'
          },
          {
            id: 'connector_AKIAIOSFODNN7EXAMPLE'
          },
          {
            authentication: { type: 'AIzaSyD-abcdefghijklmnopqrstuvwxyz1234' },
            id: 'credential-type'
          },
          {
            authentication: { scopes: ['AIzaSyD-abcdefghijklmnopqrstuvwxyz1234'], type: 'oauth2' },
            id: 'credential-scope'
          },
          {
            id: 'opaque-permission',
            permissions: ['abcdefghijklmnopqrstuvwx.yz0123456789abcdefghijklmnop']
          }
        ],
        diagnostics: [{
          code: 'legacy_path',
          level: 'warning',
          message: `Legacy metadata referenced ${pluginRoot}, ${pluginFileUrl}, and ${encodedPluginRoot}.`
        }]
      },
      source: { adapter: 'codex', kind: 'directory' },
      plugin: {
        client: {
          devClientEntryKind: 'host-vite',
          devClientEntryUrl: `/@fs${pluginRoot}/client/index.ts`,
          entry: './client/index.js'
        },
        contributions: {
          navItems: [{ id: 'home', title: pluginRoot }]
        }
      }
    })
    mocks.loadConfigState.mockResolvedValue({
      workspaceFolder,
      mergedConfig: {
        plugins: [{
          id: pluginRoot,
          options: {
            [pluginRoot]: 'must-not-leak',
            cacheDir: `path=${pluginRoot}`,
            encodedRoot: encodedPluginRoot,
            fileRoot: pluginFileUrl,
            oauthCallback: '/oauth/callback',
            serviceUrl: 'https://example.test/oauth/callback'
          },
          scope: 'docs'
        }]
      }
    })

    const response = await fetch(`${baseUrl}/api/plugins`)
    const payload = await response.json() as { plugins: Array<Record<string, unknown>> }
    const plugin = payload.plugins[0] as {
      client?: { devClientEntryKind?: string; devClientEntryUrl?: string }
      manifest?: {
        native?: {
          apps?: Array<{
            authentication?: Record<string, unknown>
            capabilities?: string[]
            connectionRequirements?: Record<string, unknown>
            permissions?: string[]
          }>
          diagnostics?: Array<{ message: string }>
        }
      }
      name?: string
      options?: Record<string, unknown>
      requestId?: string
      source?: Record<string, unknown>
    }

    expect(plugin).toMatchObject({
      name: 'docs-plugin',
      requestId: 'docs-plugin',
      source: { adapter: 'codex', kind: 'directory' }
    })
    expect(plugin.manifest?.native?.apps?.[0]).toEqual({
      authentication: {
        authorizationUrl:
          'https://example.test/oauth/authorize?client_id=docs&redirect_uri=%2Foauth%2Fcallback&redirect%255Furi=%2Fencoded&code_challenge=valid&login_hint=docs',
        callbackPath: '/oauth/callback',
        type: 'oauth2'
      },
      capabilities: ['read', 'WorkspaceConfigurationManagement', 'write'],
      connectionRequirements: {
        endpoint: 'https://api.example.test/connect',
        required: true,
        type: 'oauth'
      },
      id: 'docs',
      permissions: ['repository:read']
    })
    expect(plugin.manifest?.native?.apps).toHaveLength(1)
    expect(plugin.manifest?.native?.diagnostics?.[0]?.message).toBe(
      'Native plugin metadata diagnostic was redacted.'
    )
    expect(plugin.options).toEqual({
      cacheDir: 'path=[local path]',
      encodedRoot: '[local path]',
      fileRoot: '[local path]',
      oauthCallback: '/oauth/callback',
      serviceUrl: 'https://example.test/oauth/callback'
    })
    expect(plugin.client).not.toHaveProperty('devClientEntryKind')
    expect(plugin.client).not.toHaveProperty('devClientEntryUrl')
    expect(plugin.client).not.toHaveProperty('root')
    expect(plugin.client).not.toHaveProperty('sourceRoot')
    expect(plugin).not.toHaveProperty('pluginRoot')
    expect(plugin).not.toHaveProperty('rootDir')
    const publicDiagnostics = (plugin as {
      diagnostics?: Array<Record<string, unknown>>
    }).diagnostics
    expect(publicDiagnostics?.every(diagnostic => !Object.hasOwn(diagnostic, 'pluginRoot'))).toBe(true)
    expect(JSON.stringify(plugin)).not.toContain(pluginRoot)
    expect(JSON.stringify(plugin)).not.toContain('must-not-leak')
    expect(JSON.stringify(plugin)).not.toContain('must-not-flow-to-public')
    expect(JSON.stringify(plugin)).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(JSON.stringify(plugin)).not.toContain('AIzaSyD-abcdefghijklmnopqrstuvwxyz1234')
    expect(JSON.stringify(plugin)).not.toContain('abcdefghijklmnopqrstuvwx.yz0123456789abcdefghijklmnop')
    expect(JSON.stringify(plugin)).not.toContain(workspaceFolder)
    expect(JSON.stringify(payload)).not.toContain(workspaceFolder)
  }, 5_000)

  function mockConfig(plugins: Array<{ enabled?: boolean; id: string; scope?: string }>) {
    mocks.loadConfigState.mockResolvedValue({
      workspaceFolder,
      mergedConfig: { plugins }
    })
  }

  async function startDevServer(source: string) {
    const devServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/javascript' })
      res.end(source)
    })
    devServers.push(devServer)
    await new Promise<void>((resolve) => {
      devServer.listen(0, '127.0.0.1', () => resolve())
    })
    const address = devServer.address()
    if (address == null || typeof address === 'string') {
      throw new Error('Failed to start plugin dev server')
    }
    return `http://127.0.0.1:${address.port}`
  }
})

const fsMkdtemp = (prefix: string) => mkdtemp(path.join(os.tmpdir(), prefix))
