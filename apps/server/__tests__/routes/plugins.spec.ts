/* eslint-disable max-lines -- plugin route coverage shares one Koa fixture across scoped runtime scenarios. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

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
      plugins: Array<{ scope: string; watch?: { enabled: boolean } }>
    }
    expect(listPayload.plugins.find(plugin => plugin.scope === 'watched')?.watch).toEqual({ enabled: true })

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
          server: { entry: './server.mjs' }
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
        server: { entry: '../outside-server.mjs' }
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
          server: { entry: './server.mjs' }
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
          server: { entry: './server.mjs' }
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
          server: { entry: './server.mjs' },
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

  it('keeps activation failures isolated and reports diagnostics', async () => {
    const badPluginRoot = path.join(workspaceFolder, 'plugins', 'bad')
    const goodPluginRoot = path.join(workspaceFolder, 'plugins', 'good')
    await createPlugin(
      badPluginRoot,
      {
        name: 'bad',
        plugin: { server: { entry: './server.mjs' } }
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
        plugin: { server: { entry: './server.mjs' } }
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
        message: expect.stringContaining('Conflicting plugin scope "same"')
      })
    ])
  })

  function mockConfig(plugins: Array<{ id: string; scope?: string }>) {
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
