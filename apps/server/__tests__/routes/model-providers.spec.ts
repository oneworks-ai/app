import http from 'node:http'

import Router from '@koa/router'
import type { Context, Next } from 'koa'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { modelProvidersRouter, modelServicesRouter } from '#~/routes/model-providers.js'
import { HttpError } from '#~/utils/http.js'

const mocks = vi.hoisted(() => ({
  loadConfigState: vi.fn(),
  updateConfigFile: vi.fn()
}))

vi.mock('#~/services/config/index.js', () => ({
  loadConfigState: mocks.loadConfigState
}))

vi.mock('@oneworks/config', () => ({
  updateConfigFile: mocks.updateConfigFile
}))

describe('model provider routes', () => {
  let server: http.Server | undefined
  let baseUrl = ''
  let request: typeof fetch

  beforeEach(async () => {
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
      unit: 'request',
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

  it('refreshes selected models in the requested raw config source only', async () => {
    const response = await request(`${baseUrl}/api/model-services/kimi/models/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'user',
        models: ['kimi-k2', 'kimi-k2']
      })
    })

    expect(response.status).toBe(200)
    expect(mocks.updateConfigFile).toHaveBeenCalledWith({
      workspaceFolder: '/workspace',
      source: 'user',
      section: 'modelServices',
      value: {
        kimi: {
          provider: 'moonshot-cn',
          apiKey: 'secret-kimi',
          models: ['kimi-k2']
        },
        sibling: {
          apiBaseUrl: 'https://sibling.example.com/v1',
          apiKey: 'secret-sibling'
        }
      }
    })
  })

  it('refreshes models with the current draft service values', async () => {
    const response = await request(`${baseUrl}/api/model-services/kimi/models/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'user',
        models: ['kimi-k2'],
        service: {
          title: 'Kimi Draft',
          provider: 'moonshot-cn',
          apiKey: '******'
        }
      })
    })

    expect(response.status).toBe(200)
    expect(mocks.updateConfigFile).toHaveBeenCalledWith({
      workspaceFolder: '/workspace',
      source: 'user',
      section: 'modelServices',
      value: {
        kimi: {
          title: 'Kimi Draft',
          provider: 'moonshot-cn',
          apiKey: 'secret-kimi',
          models: ['kimi-k2']
        },
        sibling: {
          apiBaseUrl: 'https://sibling.example.com/v1',
          apiKey: 'secret-sibling'
        }
      }
    })
  })
})
