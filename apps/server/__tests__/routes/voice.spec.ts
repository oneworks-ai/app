import http from 'node:http'

import Router from '@koa/router'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apiEnvelopeMiddleware } from '#~/middlewares/api-envelope.js'
import { JSON_BODY_LIMIT } from '#~/middlewares/index.js'
import { voiceRouter } from '#~/routes/voice.js'
import { HttpError } from '#~/utils/http.js'

const mocks = vi.hoisted(() => ({
  loadConfigState: vi.fn()
}))

vi.mock('#~/services/config/index.js', () => ({
  loadConfigState: mocks.loadConfigState
}))

const readRequestJson = async (request: http.IncomingMessage) => {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

const listen = async (app: Koa) => {
  const server = http.createServer(app.callback())
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address == null || typeof address === 'string') {
    throw new Error('Failed to start test server')
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server
  }
}

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

const startVoiceApp = async ({ envelope = false }: { envelope?: boolean } = {}) => {
  const app = new Koa()
  const rootRouter = new Router({ prefix: '/api/voice' })
  const router = voiceRouter()
  rootRouter.use(router.routes())
  rootRouter.use(router.allowedMethods())
  if (envelope) {
    app.use(apiEnvelopeMiddleware())
  } else {
    app.use(async (ctx, next) => {
      try {
        await next()
      } catch (error) {
        if (!(error instanceof HttpError)) throw error
        ctx.status = error.status
        ctx.body = {
          error: {
            code: error.code,
            message: error.message
          }
        }
      }
    })
  }
  app.use(bodyParser({
    jsonLimit: JSON_BODY_LIMIT
  }))
  app.use(rootRouter.routes())
  app.use(rootRouter.allowedMethods())
  return await listen(app)
}

describe('voiceRouter', () => {
  let server: http.Server | undefined
  let providerServer: http.Server | undefined
  let baseUrl = ''
  let providerBaseUrl = ''
  const originalToken = process.env.LOCAL_ASR_TOKEN

  beforeEach(async () => {
    const listening = await startVoiceApp()
    server = listening.server
    baseUrl = listening.baseUrl

    process.env.LOCAL_ASR_TOKEN = 'test-token'
  })

  afterEach(async () => {
    await closeServer(server)
    await closeServer(providerServer)
    server = undefined
    providerServer = undefined
    baseUrl = ''
    providerBaseUrl = ''
    if (originalToken == null) {
      delete process.env.LOCAL_ASR_TOKEN
    } else {
      process.env.LOCAL_ASR_TOKEN = originalToken
    }
    vi.clearAllMocks()
  })

  const startProvider = async (options: { expectedAudioBase64?: string } = {}) => {
    providerServer = http.createServer(async (request, response) => {
      expect(request.headers.authorization).toBe('Bearer test-token')
      const body = await readRequestJson(request)
      expect(body.audio).toBe(options.expectedAudioBase64 ?? Buffer.from('audio').toString('base64'))
      expect(body.language).toBe('zh')
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({
        data: {
          language: 'zh',
          text: '你好，世界'
        }
      }))
    })
    await new Promise<void>((resolve) => {
      providerServer!.listen(0, '127.0.0.1', () => resolve())
    })
    const address = providerServer.address()
    if (address == null || typeof address === 'string') {
      throw new Error('Failed to start provider test server')
    }
    providerBaseUrl = `http://127.0.0.1:${address.port}`
  }

  const mockVoiceConfig = () => {
    mocks.loadConfigState.mockResolvedValue({
      mergedConfig: {
        voice: {
          speechToText: {
            defaultServiceId: 'local-asr',
            services: {
              'local-asr': {
                label: 'Local ASR',
                maxBytes: 50_000_000,
                maxDurationSeconds: 300,
                provider: 'custom-http',
                request: {
                  url: `${providerBaseUrl}/transcribe`,
                  headers: {
                    Authorization: 'Bearer ${env:LOCAL_ASR_TOKEN}'
                  },
                  body: {
                    kind: 'json',
                    audioBase64Field: 'audio',
                    fields: {
                      language: '{{language}}'
                    }
                  }
                },
                response: {
                  languagePath: 'data.language',
                  textPath: 'data.text'
                }
              }
            }
          }
        }
      }
    })
  }

  it('lists configured speech-to-text services', async () => {
    await startProvider()
    mockVoiceConfig()

    const response = await fetch(`${baseUrl}/api/voice/speech-to-text/services`)
    const payload = await response.json() as {
      services: Array<{
        default: boolean
        id: string
        label: string
        maxBytes?: number
        maxDurationSeconds?: number
        provider: string
      }>
    }

    expect(response.status).toBe(200)
    expect(payload.services).toEqual([
      {
        default: true,
        enabled: true,
        id: 'local-asr',
        label: 'Local ASR',
        maxBytes: 50_000_000,
        maxDurationSeconds: 300,
        provider: 'custom-http'
      }
    ])
  })

  it('accepts speech payloads larger than the default JSON body limit', async () => {
    const audio = Buffer.alloc(1024 * 1024 + 16, 7)
    await startProvider({ expectedAudioBase64: audio.toString('base64') })
    mockVoiceConfig()

    const response = await fetch(`${baseUrl}/api/voice/speech-to-text`, {
      body: JSON.stringify({
        audioBase64: audio.toString('base64'),
        language: 'zh',
        mimeType: 'audio/webm'
      }),
      headers: {
        'Content-Type': 'application/json'
      },
      method: 'POST'
    })
    const payload = await response.json() as { result?: { text?: string } }

    expect(response.status).toBe(200)
    expect(payload.result?.text).toBe('你好，世界')
  })

  it('transcribes through a custom HTTP speech-to-text service', async () => {
    await startProvider()
    mockVoiceConfig()

    const response = await fetch(`${baseUrl}/api/voice/speech-to-text`, {
      body: JSON.stringify({
        audioBase64: Buffer.from('audio').toString('base64'),
        language: 'zh',
        mimeType: 'audio/webm'
      }),
      headers: {
        'Content-Type': 'application/json'
      },
      method: 'POST'
    })
    const payload = await response.json() as { result?: { language?: string; serviceId?: string; text?: string } }

    expect(response.status).toBe(200)
    expect(payload.result).toEqual({
      language: 'zh',
      serviceId: 'local-asr',
      text: '你好，世界'
    })
  })

  it('rejects invalid base64 audio before calling the provider', async () => {
    mockVoiceConfig()

    const response = await fetch(`${baseUrl}/api/voice/speech-to-text`, {
      body: JSON.stringify({
        audioBase64: 'not a base64 payload!!!',
        language: 'zh',
        mimeType: 'audio/webm'
      }),
      headers: {
        'Content-Type': 'application/json'
      },
      method: 'POST'
    })
    const payload = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(400)
    expect(payload.error?.code).toBe('UNSUPPORTED_AUDIO_FORMAT')
  })

  it('returns a stable error when no default service is configured', async () => {
    mocks.loadConfigState.mockResolvedValue({
      mergedConfig: {
        voice: {
          speechToText: {
            services: {}
          }
        }
      }
    })

    const response = await fetch(`${baseUrl}/api/voice/speech-to-text`, {
      body: JSON.stringify({
        audioBase64: Buffer.from('audio').toString('base64')
      }),
      headers: {
        'Content-Type': 'application/json'
      },
      method: 'POST'
    })
    const payload = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(400)
    expect(payload.error?.code).toBe('NO_DEFAULT_SERVICE')
  })

  it('does not fall back when the configured default service is missing', async () => {
    mocks.loadConfigState.mockResolvedValue({
      mergedConfig: {
        voice: {
          speechToText: {
            defaultServiceId: 'missing-asr',
            services: {
              'fallback-asr': {
                provider: 'custom-http',
                request: {
                  url: 'http://127.0.0.1:1/transcribe'
                }
              }
            }
          }
        }
      }
    })

    const response = await fetch(`${baseUrl}/api/voice/speech-to-text`, {
      body: JSON.stringify({
        audioBase64: Buffer.from('audio').toString('base64')
      }),
      headers: {
        'Content-Type': 'application/json'
      },
      method: 'POST'
    })
    const payload = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(400)
    expect(payload.error?.code).toBe('SERVICE_NOT_FOUND')
  })

  it('does not fall back when the configured default service is disabled', async () => {
    mocks.loadConfigState.mockResolvedValue({
      mergedConfig: {
        voice: {
          speechToText: {
            defaultServiceId: 'disabled-asr',
            services: {
              'disabled-asr': {
                enabled: false,
                provider: 'custom-http',
                request: {
                  url: 'http://127.0.0.1:1/transcribe'
                }
              },
              'fallback-asr': {
                provider: 'custom-http',
                request: {
                  url: 'http://127.0.0.1:1/transcribe'
                }
              }
            }
          }
        }
      }
    })

    const response = await fetch(`${baseUrl}/api/voice/speech-to-text`, {
      body: JSON.stringify({
        audioBase64: Buffer.from('audio').toString('base64')
      }),
      headers: {
        'Content-Type': 'application/json'
      },
      method: 'POST'
    })
    const payload = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(400)
    expect(payload.error?.code).toBe('SERVICE_DISABLED')
  })

  it('uses the API envelope in the mounted API stack', async () => {
    await closeServer(server)
    const listening = await startVoiceApp({ envelope: true })
    server = listening.server
    baseUrl = listening.baseUrl
    await startProvider()
    mockVoiceConfig()

    const response = await fetch(`${baseUrl}/api/voice/speech-to-text`, {
      body: JSON.stringify({
        audioBase64: Buffer.from('audio').toString('base64'),
        language: 'zh',
        mimeType: 'audio/webm'
      }),
      headers: {
        'Content-Type': 'application/json'
      },
      method: 'POST'
    })
    const payload = await response.json() as {
      data?: { result?: { language?: string; serviceId?: string; text?: string } }
      success?: boolean
    }

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data?.result).toEqual({
      language: 'zh',
      serviceId: 'local-asr',
      text: '你好，世界'
    })

    mocks.loadConfigState.mockResolvedValue({
      mergedConfig: {
        voice: {
          speechToText: {
            services: {}
          }
        }
      }
    })

    const errorResponse = await fetch(`${baseUrl}/api/voice/speech-to-text`, {
      body: JSON.stringify({
        audioBase64: Buffer.from('audio').toString('base64')
      }),
      headers: {
        'Content-Type': 'application/json'
      },
      method: 'POST'
    })
    const errorPayload = await errorResponse.json() as { error?: { code?: string }; success?: boolean }

    expect(errorResponse.status).toBe(400)
    expect(errorPayload.success).toBe(false)
    expect(errorPayload.error?.code).toBe('NO_DEFAULT_SERVICE')
  })
})
