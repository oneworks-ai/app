/* eslint-disable max-lines -- provider route coverage shares one HTTP server harness. */
import http from 'node:http'

import Router from '@koa/router'
import type { Context, Next } from 'koa'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { modelProvidersRouter, modelServicesRouter } from '#~/routes/model-providers.js'
import { HttpError } from '#~/utils/http.js'

const mocks = vi.hoisted(() => ({
  codexDiscover: vi.fn(),
  composeWorkspaceConfigSchemaBundle: vi.fn(),
  customDiscover: vi.fn(),
  loadAdapterModelProviderImportCapability: vi.fn(),
  loadConfigState: vi.fn(),
  tryLoadAdapterModelProviderImportCapability: vi.fn(),
  updateConfigFile: vi.fn()
}))

vi.mock('@oneworks/types', async importOriginal => ({
  ...await importOriginal<typeof import('@oneworks/types')>(),
  loadAdapterModelProviderImportCapability: mocks.loadAdapterModelProviderImportCapability,
  tryLoadAdapterModelProviderImportCapability: mocks.tryLoadAdapterModelProviderImportCapability
}))

vi.mock('@oneworks/config', async importOriginal => ({
  ...await importOriginal<typeof import('@oneworks/config')>(),
  composeWorkspaceConfigSchemaBundle: mocks.composeWorkspaceConfigSchemaBundle,
  updateConfigFile: mocks.updateConfigFile
}))

vi.mock('#~/services/config/index.js', () => ({
  loadConfigState: mocks.loadConfigState
}))

describe('model provider routes', () => {
  let server: http.Server | undefined
  let baseUrl = ''
  let request: typeof fetch

  beforeEach(async () => {
    const resolveCapability = (specifier: string) => {
      if (specifier === 'codex') {
        return {
          descriptor: {
            title: 'Codex config.toml',
            supportedSources: ['global', 'project']
          },
          discover: mocks.codexDiscover
        }
      }
      if (specifier === '@acme/adapter-native-import') {
        return {
          descriptor: {
            title: 'Acme native config',
            description: 'Acme provider settings',
            supportedSources: ['global', 'project', 'user']
          },
          discover: mocks.customDiscover
        }
      }
      return undefined
    }
    mocks.tryLoadAdapterModelProviderImportCapability.mockImplementation(async specifier => (
      resolveCapability(specifier)
    ))
    mocks.loadAdapterModelProviderImportCapability.mockImplementation(async specifier => {
      const capability = resolveCapability(specifier)
      if (capability == null) throw new TypeError('Unsupported adapter import capability')
      return capability
    })
    mocks.composeWorkspaceConfigSchemaBundle.mockResolvedValue({
      extensions: { adapters: ['codex', 'nativeImport'] }
    })
    mocks.updateConfigFile.mockImplementation(async ({ resolveValue, source }) => {
      const currentConfig = source === 'project'
        ? {
          modelServices: {
            projectKimi: { provider: 'moonshot-cn', apiKey: 'secret-project' }
          }
        }
        : source === 'user'
        ? {
          modelServices: {
            kimi: { provider: 'moonshot-cn', apiKey: 'secret-kimi' },
            sibling: { apiBaseUrl: 'https://sibling.example.com/v1', apiKey: 'secret-sibling' }
          }
        }
        : {}
      return {
        updatedConfig: {
          ...currentConfig,
          modelServices: resolveValue(currentConfig)
        }
      }
    })
    request = globalThis.fetch.bind(globalThis)
    const app = new Koa()
    const providerRouter = new Router({ prefix: '/api/model-providers' })
    const providerRoutes = modelProvidersRouter()
    providerRouter.use(providerRoutes.routes())
    providerRouter.use(providerRoutes.allowedMethods())
    const serviceRouter = new Router({ prefix: '/api/model-services' })
    const serviceRoutes = modelServicesRouter()
    serviceRouter.use(serviceRoutes.routes())
    serviceRouter.use(serviceRoutes.allowedMethods())
    app.use(async (ctx: Context, next: Next) => {
      try {
        await next()
      } catch (error) {
        const httpError = error instanceof HttpError ? error : undefined
        ctx.status = httpError?.status ?? 500
        ctx.body = {
          error: {
            code: httpError?.code ?? 'internal_error',
            message: httpError?.message ?? 'Internal server error'
          }
        }
      }
    })
    app.use(bodyParser())
    app.use(providerRouter.routes())
    app.use(providerRouter.allowedMethods())
    app.use(serviceRouter.routes())
    app.use(serviceRouter.allowedMethods())

    server = http.createServer(app.callback())
    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (address == null || typeof address === 'string') {
      throw new Error('Failed to start test server')
    }
    baseUrl = `http://127.0.0.1:${address.port}`
    mocks.loadConfigState.mockResolvedValue({
      workspaceFolder: '/workspace',
      mergedConfig: {
        adapters: {
          nativeImport: {
            packageId: '@acme/adapter-native-import'
          }
        },
        modelServices: {
          kimi: {
            provider: 'moonshot-cn',
            apiKey: 'secret-kimi'
          },
          deepseek: {
            provider: 'deepseek',
            apiKey: 'secret-deepseek'
          },
          kimiCode: {
            provider: 'kimi-code',
            apiKey: 'secret-kimi-code'
          },
          micu: {
            apiBaseUrl: 'https://www.micuapi.ai/v1',
            apiKey: '',
            management: {
              apiKey: 'secret-management',
              headers: {
                'New-Api-User': '42647'
              }
            },
            provider: 'micu'
          },
          projectKimi: {
            provider: 'moonshot-cn',
            apiKey: 'secret-merged-user'
          }
        }
      },
      projectSource: {
        rawConfig: {},
        resolvedConfig: {
          modelServices: {
            projectKimi: {
              provider: 'moonshot-cn',
              apiKey: 'secret-project'
            }
          }
        }
      },
      userSource: {
        rawConfig: {
          modelServices: {
            kimi: {
              provider: 'moonshot-cn',
              apiKey: 'secret-kimi'
            },
            sibling: {
              apiBaseUrl: 'https://sibling.example.com/v1',
              apiKey: 'secret-sibling'
            }
          }
        }
      }
    })
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      if (server == null) {
        resolve()
        return
      }
      server.close(error => error ? reject(error) : resolve())
    })
    server = undefined
    baseUrl = ''
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('lists provider registry without service secrets', async () => {
    const response = await request(`${baseUrl}/api/model-providers`)
    const payload = await response.json() as {
      providers?: Array<{
        id: string
        codingPlan?: {
          defaultModels?: string[]
          protocols?: {
            anthropic?: { baseUrl?: string }
            openai?: { baseUrl?: string }
          }
        }
        capabilities?: { balance?: string; listModels?: string }
        portal?: { homepage?: string }
      }>
    }
    const qwenCodingPlan = payload.providers?.find(provider => provider.id === 'qwen-coding-plan')
    const kimiCode = payload.providers?.find(provider => provider.id === 'kimi-code')

    expect(response.status).toBe(200)
    expect(payload.providers?.some(provider => provider.id === 'moonshot-cn')).toBe(true)
    expect(qwenCodingPlan?.codingPlan?.protocols?.openai?.baseUrl).toBe('https://coding.dashscope.aliyuncs.com/v1')
    expect(qwenCodingPlan?.codingPlan?.protocols?.anthropic?.baseUrl).toBe(
      'https://coding.dashscope.aliyuncs.com/apps/anthropic'
    )
    expect(qwenCodingPlan?.codingPlan?.defaultModels).toContain('qwen3-coder-plus')
    expect(kimiCode?.capabilities).toMatchObject({
      balance: 'api',
      listModels: 'api'
    })
    expect(JSON.stringify(payload)).not.toContain('secret-kimi')
  })

  it('lists model service importers discovered from adapter package capabilities', async () => {
    const response = await request(`${baseUrl}/api/model-services/importers`)
    const payload = await response.json() as {
      importers?: Array<{
        adapterKey: string
        description?: string
        runtimeAdapter: string
        supportedSources: string[]
        title: string
      }>
    }

    expect(response.status).toBe(200)
    expect(payload.importers).toEqual([
      {
        adapterKey: 'codex',
        runtimeAdapter: 'codex',
        supportedSources: ['global', 'project'],
        title: 'Codex config.toml'
      },
      {
        adapterKey: 'nativeImport',
        description: 'Acme provider settings',
        runtimeAdapter: '@acme/adapter-native-import',
        supportedSources: ['global', 'project', 'user'],
        title: 'Acme native config'
      }
    ])
    expect(JSON.stringify(payload)).not.toContain('packageId')
    expect(JSON.stringify(payload)).not.toContain('/workspace')
    expect(JSON.stringify(payload)).not.toContain('secret')
  })

  it('imports Codex providers into the requested project source without overwriting or returning secrets', async () => {
    mocks.codexDiscover.mockResolvedValue({
      found: true,
      skippedProviderIds: [],
      modelServices: {
        projectKimi: { provider: 'moonshot-cn', apiKey: 'secret-native-collision' },
        'project-provider': { apiBaseUrl: 'https://project.example.com/v1', apiKey: 'secret-native' }
      }
    })

    const response = await request(`${baseUrl}/api/model-services/import/codex`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'project' })
    })
    const payload = await response.json() as {
      adapterKey?: string
      existingServiceKeys?: string[]
      importedServiceKeys?: string[]
    }

    expect(response.status).toBe(200)
    expect(payload.adapterKey).toBe('codex')
    expect(payload.existingServiceKeys).toEqual(['projectKimi'])
    expect(payload.importedServiceKeys).toEqual(['project-provider'])
    expect(mocks.codexDiscover).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/workspace',
      source: 'project'
    }))
    expect(mocks.tryLoadAdapterModelProviderImportCapability).toHaveBeenCalledWith('codex', { cwd: '/workspace' })
    expect(mocks.updateConfigFile).toHaveBeenCalledWith(expect.objectContaining({
      section: 'modelServices',
      source: 'project',
      workspaceFolder: '/workspace'
    }))
    expect(JSON.stringify(payload)).not.toContain('secret-project')
    expect(JSON.stringify(payload)).not.toContain('secret-native')
  })

  it('keeps additions-only semantics when a service appears during the locked write', async () => {
    mocks.codexDiscover.mockResolvedValue({
      found: true,
      modelServices: {
        'project-provider': { apiBaseUrl: 'https://project.example.com/v1', apiKey: 'secret-native' }
      },
      skippedProviderIds: []
    })
    mocks.updateConfigFile.mockImplementationOnce(async ({ resolveValue }) => {
      const currentConfig = {
        modelServices: {
          projectKimi: { provider: 'moonshot-cn' },
          'project-provider': { provider: 'existing-concurrent', apiKey: 'secret-concurrent' }
        }
      }
      return {
        updatedConfig: {
          ...currentConfig,
          modelServices: resolveValue(currentConfig)
        }
      }
    })

    const response = await request(`${baseUrl}/api/model-services/import/codex`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'project' })
    })
    const payload = await response.json() as {
      existingServiceKeys?: string[]
      importedServiceKeys?: string[]
    }

    expect(response.status).toBe(200)
    expect(payload.importedServiceKeys).toEqual([])
    expect(payload.existingServiceKeys).toEqual(['project-provider'])
    expect(JSON.stringify(payload)).not.toContain('secret-concurrent')
  })

  it('rejects import when the selected adapter does not support the current source', async () => {
    const response = await request(`${baseUrl}/api/model-services/import/codex`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'user' })
    })
    const payload = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(400)
    expect(payload.error?.code).toBe('invalid_import_source')
    expect(mocks.codexDiscover).not.toHaveBeenCalled()
    expect(mocks.updateConfigFile).not.toHaveBeenCalled()
  })

  it('imports through a configured third-party adapter capability including its user source', async () => {
    mocks.customDiscover.mockResolvedValue({
      found: true,
      skippedProviderIds: ['unsupported-native-provider'],
      modelServices: {
        kimi: { provider: 'moonshot-cn', apiKey: 'secret-collision' },
        acme: { apiBaseUrl: 'https://acme.example.com/v1', apiKey: 'secret-acme' }
      }
    })

    const response = await request(`${baseUrl}/api/model-services/import/nativeImport`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'user' })
    })
    const payload = await response.json() as {
      adapterKey?: string
      existingServiceKeys?: string[]
      importedServiceKeys?: string[]
      skippedProviderIds?: string[]
    }

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      adapterKey: 'nativeImport',
      existingServiceKeys: ['kimi'],
      importedServiceKeys: ['acme'],
      skippedProviderIds: ['unsupported-native-provider']
    })
    expect(mocks.tryLoadAdapterModelProviderImportCapability).toHaveBeenCalledWith(
      '@acme/adapter-native-import',
      { cwd: '/workspace' }
    )
    expect(mocks.customDiscover).toHaveBeenCalledWith(expect.objectContaining({ source: 'user' }))
    expect(JSON.stringify(payload)).not.toContain('secret-acme')
  })

  it('adapts runtime-supported model services to a configured adapter instance alias', async () => {
    const state = await mocks.loadConfigState()
    mocks.loadConfigState.mockResolvedValueOnce({
      ...state,
      mergedConfig: {
        ...state.mergedConfig,
        adapters: {
          ...state.mergedConfig.adapters,
          fast: { packageId: 'codex' }
        }
      }
    })
    mocks.codexDiscover.mockResolvedValue({
      found: true,
      skippedProviderIds: [],
      modelServices: {
        fastNative: {
          apiBaseUrl: 'https://fast.example.com/v1',
          apiKey: 'secret-fast',
          supportedAdapters: ['codex']
        }
      }
    })
    let writtenModelServices: Record<string, unknown> | undefined
    mocks.updateConfigFile.mockImplementationOnce(async ({ resolveValue }) => {
      writtenModelServices = resolveValue({})
      return { updatedConfig: { modelServices: writtenModelServices } }
    })

    const response = await request(`${baseUrl}/api/model-services/import/fast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'project' })
    })

    expect(response.status).toBe(200)
    expect(writtenModelServices).toMatchObject({
      fastNative: {
        supportedAdapters: ['codex', 'fast']
      }
    })
    expect(JSON.stringify(await response.json())).not.toContain('secret-fast')
  })

  it('rejects arbitrary adapter package or path input outside the server allowlist', async () => {
    const adapterKey = encodeURIComponent('/tmp/untrusted-adapter')
    const response = await request(`${baseUrl}/api/model-services/import/${adapterKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'project' })
    })
    const payload = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(404)
    expect(payload.error?.code).toBe('model_service_importer_not_found')
    expect(mocks.tryLoadAdapterModelProviderImportCapability).not.toHaveBeenCalled()
  })

  it('rejects malformed adapter discovery output without writing or returning it', async () => {
    mocks.codexDiscover.mockResolvedValue({
      found: true,
      modelServices: {
        leaked: 'secret-invalid-result'
      },
      skippedProviderIds: []
    })

    const response = await request(`${baseUrl}/api/model-services/import/codex`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'project' })
    })
    const payload = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(500)
    expect(payload.error?.code).toBe('invalid_model_service_import_result')
    expect(mocks.updateConfigFile).not.toHaveBeenCalled()
    expect(JSON.stringify(payload)).not.toContain('secret-invalid-result')
  })

  it('rejects invalid nested model service config from an adapter before writing', async () => {
    mocks.customDiscover.mockResolvedValue({
      found: true,
      modelServices: {
        invalid: {
          kind: 'evil',
          models: 'not-an-array',
          timeoutMs: -1,
          management: {
            headers: { Authorization: 42 }
          }
        }
      },
      skippedProviderIds: []
    })

    const response = await request(`${baseUrl}/api/model-services/import/nativeImport`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'project' })
    })
    const payload = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(500)
    expect(payload.error?.code).toBe('invalid_model_service_import_result')
    expect(mocks.updateConfigFile).not.toHaveBeenCalled()
  })

  it('probes provider identity from draft service host', async () => {
    const response = await request(`${baseUrl}/api/model-providers/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: {
          apiBaseUrl: 'https://api.moonshot.ai/v1/chat/completions',
          apiKey: 'secret-draft'
        }
      })
    })
    const payload = await response.json() as { identity?: { provider?: string; confidence?: string } }

    expect(response.status).toBe(200)
    expect(payload.identity).toMatchObject({
      provider: 'moonshot-intl',
      confidence: 'host_match'
    })
    expect(JSON.stringify(payload)).not.toContain('secret-draft')
  })

  it('lists remote models for configured services without returning the api key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: 'kimi-k2', owned_by: 'moonshot' }]
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const response = await request(`${baseUrl}/api/model-services/kimi/models/list`, { method: 'POST' })
    const payload = await response.json() as { models?: Array<{ id: string; ownedBy?: string }> }

    expect(response.status).toBe(200)
    expect(payload.models).toEqual([{ id: 'kimi-k2', ownedBy: 'moonshot' }])
    expect(fetchMock).toHaveBeenCalledWith('https://api.moonshot.cn/v1/models', {
      headers: { Authorization: 'Bearer secret-kimi' }
    })
    expect(JSON.stringify(payload)).not.toContain('secret-kimi')
    expect(JSON.stringify(payload)).not.toContain('owned_by')
  })

  it('merges masked draft service secrets before upstream calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: 'kimi-k2' }]
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const response = await request(`${baseUrl}/api/model-services/kimi/models/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'user',
        service: {
          provider: 'moonshot-cn',
          apiKey: '******'
        }
      })
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith('https://api.moonshot.cn/v1/models', {
      headers: { Authorization: 'Bearer secret-kimi' }
    })
  })

  it('rejects invalid action sources before resolving masked secrets', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await request(`${baseUrl}/api/model-services/kimi/models/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'projectx',
        service: {
          provider: 'moonshot-cn',
          apiKey: '******'
        }
      })
    })
    const payload = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(400)
    expect(payload.error?.code).toBe('invalid_source')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses the selected source resolved config for masked action drafts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: 'kimi-k2' }]
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const response = await request(`${baseUrl}/api/model-services/projectKimi/models/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'project',
        service: {
          provider: 'moonshot-cn',
          apiKey: '******'
        }
      })
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith('https://api.moonshot.cn/v1/models', {
      headers: { Authorization: 'Bearer secret-project' }
    })
  })

  it('normalizes DeepSeek balance response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          balance_infos: [{ currency: 'USD', total_balance: '12.50' }]
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const response = await request(`${baseUrl}/api/model-services/deepseek/balance`, { method: 'POST' })
    const payload = await response.json() as { account?: { kind?: string; currency?: string; available?: number } }

    expect(response.status).toBe(200)
    expect(payload.account).toMatchObject({
      kind: 'balance',
      currency: 'USD',
      available: 12.5
    })
    expect(fetchMock).toHaveBeenCalledWith('https://api.deepseek.com/user/balance', {
      headers: { Authorization: 'Bearer secret-deepseek' }
    })
  })

  it('normalizes Kimi Code usage quota response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          user: {
            membership: {
              level: 'LEVEL_INTERMEDIATE'
            }
          },
          usage: {
            limit: '100',
            remaining: '100',
            resetTime: '2026-06-22T13:36:53.337560Z'
          },
          limits: [
            {
              window: {
                duration: 300,
                timeUnit: 'TIME_UNIT_MINUTE'
              },
              detail: {
                limit: '100',
                remaining: '98',
                resetTime: '2026-06-17T17:36:53.337560Z'
              }
            }
          ],
          parallel: {
            limit: '20'
          },
          totalQuota: {
            limit: '100',
            remaining: '99'
          }
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const response = await request(`${baseUrl}/api/model-services/kimiCode/balance`, { method: 'POST' })
    const payload = await response.json() as {
      account?: {
        kind?: string
        limit?: number
        parallelLimit?: number
        plan?: string
        remaining?: number
        windows?: Array<{ duration?: number; limit?: number; remaining?: number; timeUnit?: string }>
      }
    }

    expect(response.status).toBe(200)
    expect(payload.account).toMatchObject({
      kind: 'quota',
      unit: 'percent',
      limit: 100,
      remaining: 99,
      parallelLimit: 20,
      plan: 'LEVEL_INTERMEDIATE',
      windows: [
        {
          duration: 300,
          timeUnit: 'minute',
          limit: 100,
          remaining: 98
        }
      ]
    })
    expect(fetchMock).toHaveBeenCalledWith('https://api.kimi.com/coding/v1/usages', {
      headers: { Authorization: 'Bearer secret-kimi-code' }
    })
    expect(JSON.stringify(payload)).not.toContain('secret-kimi-code')
  })

  it('returns Micu New API management snapshot without exposing management secrets', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/api/user/self')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { quota: 100_000_000 }, success: true }), { status: 200 })
        )
      }
      if (url.endsWith('/api/user/self/groups')) {
        return Promise.resolve(new Response(JSON.stringify({ data: ['default'], success: true }), { status: 200 }))
      }
      if (url.includes('/api/token/')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                items: [{
                  group: 'default',
                  id: 12,
                  key: 'sensitive-token-value',
                  name: 'codex'
                }]
              },
              success: true
            }),
            { status: 200 }
          )
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: 'gpt-5.4' }], success: true }), { status: 200 })
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await request(`${baseUrl}/api/model-services/micu/management`, { method: 'POST' })
    const payload = await response.json() as {
      management?: {
        account?: { available?: number; kind?: string }
        groups?: Array<{ id?: string }>
        models?: Array<{ id?: string }>
        tokens?: Array<{ key?: string; name?: string }>
      }
    }

    expect(response.status).toBe(200)
    expect(payload.management?.account).toMatchObject({ available: 200, kind: 'balance' })
    expect(payload.management?.groups).toEqual([{ id: 'default', title: 'default' }])
    expect(payload.management?.models).toEqual([{ id: 'gpt-5.4' }])
    expect(payload.management?.tokens).toMatchObject([{ key: 'sk-sens**********alue', name: 'codex' }])
    expect(JSON.stringify(payload)).not.toContain('secret-management')
    expect(JSON.stringify(payload)).not.toContain('sensitive-token-value')
  })

  it('preserves upstream rate limit status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { message: 'slow down' }
          }),
          { status: 429 }
        )
      )
    )

    const response = await request(`${baseUrl}/api/model-services/kimi/models/list`, { method: 'POST' })
    const payload = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(429)
    expect(payload.error?.code).toBe('upstream_rate_limited')
  })

  it('maps provider rejected requests without reporting service outage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { message: 'bad endpoint' }
          }),
          { status: 400 }
        )
      )
    )

    const response = await request(`${baseUrl}/api/model-services/kimi/models/list`, { method: 'POST' })
    const payload = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(502)
    expect(payload.error?.code).toBe('upstream_request_rejected')
  })
})
