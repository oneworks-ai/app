import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'
import type { Server } from 'node:http'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SessionCreationWaitError } from '#~/services/session/creation-lifecycle.js'

const lifecycleMocks = vi.hoisted(() => ({
  waitForSessionCreation: vi.fn()
}))

const addSessionSubscriberSocket = vi.fn()
const removeSessionSubscriberSocket = vi.fn()
const notifySessionUpdated = vi.fn()
const attachSocketToSession = vi.fn()
const detachSocketFromSession = vi.fn()
const getAdapterSessionRuntime = vi.fn()
const startAdapterSession = vi.fn()
const handleInteractionResponse = vi.fn()
const getSessionInteraction = vi.fn()
const processUserMessage = vi.fn()
const interruptSession = vi.fn()
const killSession = vi.fn()
const getSession = vi.fn()
const getSessionRuntimeState = vi.fn()
const resolveWebAuthConfig = vi.fn()
const verifySessionToken = vi.fn()
const getBearerTokenFromHeader = vi.fn()

const connectionHandlers: Array<(ws: any, req: any) => Promise<void>> = []
let connectionHandler: ((ws: any, req: any) => Promise<void>) | undefined
let codexConnectionHandler: ((ws: any, req: any) => Promise<void>) | undefined

vi.mock('ws', () => {
  class MockWebSocketServer {
    constructor(_options: unknown) {}

    on(event: string, handler: (ws: any, req: any) => Promise<void>) {
      if (event === 'connection') {
        connectionHandlers.push(handler)
      }
    }
  }

  return {
    WebSocketServer: MockWebSocketServer
  }
})

vi.mock('#~/db/index.js', () => ({
  getDb: vi.fn(() => ({
    getSession,
    getSessionRuntimeState
  }))
}))

vi.mock('#~/services/auth/index.js', () => ({
  AUTH_COOKIE_NAME: 'oneworks_web_auth',
  getBearerTokenFromHeader,
  getCookieFromHeader: vi.fn(() => 'token'),
  resolveWebAuthConfig,
  verifySessionToken
}))

vi.mock('#~/services/session/index.js', () => ({
  startAdapterSession,
  processUserMessage,
  interruptSession,
  killSession
}))

vi.mock('#~/services/session/interaction.js', () => ({
  getSessionInteraction,
  handleInteractionResponse
}))

vi.mock('#~/services/session/creation-lifecycle.js', async () => {
  const actual = await vi.importActual<typeof import('#~/services/session/creation-lifecycle.js')>(
    '#~/services/session/creation-lifecycle.js'
  )
  return {
    ...actual,
    waitForSessionCreation: lifecycleMocks.waitForSessionCreation
  }
})

vi.mock('#~/services/session/runtime.js', () => ({
  addSessionSubscriberSocket,
  removeSessionSubscriberSocket,
  attachSocketToSession,
  detachSocketFromSession,
  getAdapterSessionRuntime,
  notifySessionUpdated
}))

vi.mock('#~/utils/logger.js', () => ({
  getSessionLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn()
  }))
}))

describe('setupWebSocket', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    connectionHandlers.length = 0
    connectionHandler = undefined
    codexConnectionHandler = undefined
    getAdapterSessionRuntime.mockReturnValue(undefined)
    getSessionInteraction.mockReturnValue(undefined)
    resolveWebAuthConfig.mockResolvedValue({ enabled: false })
    verifySessionToken.mockResolvedValue(true)
    getBearerTokenFromHeader.mockReturnValue(undefined)
    getSessionRuntimeState.mockReturnValue({
      runtimeKind: 'interactive',
      historySeedPending: false
    })
    lifecycleMocks.waitForSessionCreation.mockResolvedValue(undefined)

    const { setupWebSocket } = await import('#~/websocket/server.js')
    setupWebSocket(new EventEmitter() as Server, {
      __ONEWORKS_PROJECT_SERVER_ROLE__: 'manager',
      __ONEWORKS_PROJECT_SERVER_WS_PATH__: '/ws'
    } as any)
    ;[codexConnectionHandler, connectionHandler] = connectionHandlers
  })

  it('blocks browser-origin loopback clients from the tokenless Codex bridge', async () => {
    const ws = {
      close: vi.fn(),
      on: vi.fn(),
      readyState: 1,
      send: vi.fn()
    }

    await codexConnectionHandler?.(ws, {
      url: '/api/adapters/codex/app-server',
      headers: { host: 'localhost', origin: 'https://evil.example' },
      socket: { remoteAddress: '127.0.0.1' }
    })

    expect(ws.close).toHaveBeenCalledWith(1008, 'Login required')
    expect(verifySessionToken).not.toHaveBeenCalled()
  })

  it('closes websocket connections when auth is enabled and the cookie is invalid', async () => {
    resolveWebAuthConfig.mockResolvedValueOnce({ enabled: true })
    verifySessionToken.mockResolvedValueOnce(false)

    const ws = {
      close: vi.fn(),
      on: vi.fn(),
      readyState: 1,
      send: vi.fn()
    }

    await connectionHandler?.(ws, {
      url: '/ws?sessionId=sess-1',
      headers: { host: 'localhost', cookie: '' }
    })

    expect(ws.close).toHaveBeenCalledWith(1008, 'Login required')
    expect(startAdapterSession).not.toHaveBeenCalled()
  })

  it('accepts auth tokens from websocket query params', async () => {
    resolveWebAuthConfig.mockResolvedValueOnce({ enabled: true })
    verifySessionToken.mockResolvedValueOnce(true)

    const ws = {
      close: vi.fn(),
      on: vi.fn(),
      readyState: 1,
      send: vi.fn()
    }

    await connectionHandler?.(ws, {
      url: '/ws?subscribe=sessions&authToken=query-token',
      headers: { host: 'localhost', cookie: '' }
    })

    expect(verifySessionToken).toHaveBeenCalledWith(expect.anything(), 'query-token')
    expect(ws.close).not.toHaveBeenCalled()
    expect(addSessionSubscriberSocket).toHaveBeenCalledWith(ws)
  })

  it('registers session list subscribers only for subscribe=sessions connections', async () => {
    const ws = {
      on: vi.fn(),
      readyState: 1,
      send: vi.fn()
    }

    await connectionHandler?.(ws, {
      url: '/ws?subscribe=sessions',
      headers: { host: 'localhost' }
    })

    expect(addSessionSubscriberSocket).toHaveBeenCalledOnce()
    expect(addSessionSubscriberSocket).toHaveBeenCalledWith(ws)
    expect(startAdapterSession).not.toHaveBeenCalled()
    expect(ws.on).toHaveBeenCalledWith('close', expect.any(Function))
  })

  it('does not register regular session sockets as session list subscribers', async () => {
    startAdapterSession.mockResolvedValue({ sockets: new Set(), session: {} })
    attachSocketToSession.mockReturnValue({ sockets: new Set([{}]), session: {} })
    getSession.mockReturnValue({ id: 'sess-1', status: 'running' })

    const ws = {
      on: vi.fn(),
      readyState: 1,
      send: vi.fn()
    }

    await connectionHandler?.(ws, {
      url: '/ws?sessionId=sess-1',
      headers: { host: 'localhost' }
    })

    expect(addSessionSubscriberSocket).not.toHaveBeenCalled()
    expect(startAdapterSession).toHaveBeenCalledOnce()
    expect(startAdapterSession).toHaveBeenCalledWith('sess-1', {
      model: undefined,
      systemPrompt: undefined,
      appendSystemPrompt: true,
      permissionMode: undefined,
      promptType: undefined,
      promptName: undefined,
      adapter: undefined
    })
    expect(attachSocketToSession).toHaveBeenCalledWith('sess-1', ws, 'adapter')
  })

  it('waits for HTTP session creation before starting the adapter', async () => {
    let completeCreation: (() => void) | undefined
    lifecycleMocks.waitForSessionCreation.mockImplementationOnce(() =>
      new Promise<void>((resolve) => {
        completeCreation = resolve
      })
    )
    startAdapterSession.mockResolvedValue({ sockets: new Set(), session: {} })

    const ws = {
      close: vi.fn(),
      on: vi.fn(),
      readyState: 1,
      send: vi.fn()
    }
    const connection = connectionHandler?.(ws, {
      url: '/ws?sessionId=sess-early',
      headers: { host: 'localhost' }
    })

    await vi.waitFor(() => {
      expect(lifecycleMocks.waitForSessionCreation).toHaveBeenCalledWith('sess-early', {
        signal: expect.any(AbortSignal)
      })
    })
    expect(startAdapterSession).not.toHaveBeenCalled()
    expect(attachSocketToSession).not.toHaveBeenCalled()

    getSession.mockReturnValue({ id: 'sess-early', status: 'running' })
    completeCreation?.()
    await connection

    expect(startAdapterSession).toHaveBeenCalledWith('sess-early', expect.any(Object))
    expect(attachSocketToSession).toHaveBeenCalledWith('sess-early', ws, 'adapter')
  })

  it('ignores a socket that closed before the lazy session handler loaded', async () => {
    const ws = {
      close: vi.fn(),
      on: vi.fn(),
      readyState: 3,
      send: vi.fn()
    }

    await connectionHandler?.(ws, {
      url: '/ws?sessionId=sess-already-closed',
      headers: { host: 'localhost' }
    })

    expect(lifecycleMocks.waitForSessionCreation).not.toHaveBeenCalled()
    expect(startAdapterSession).not.toHaveBeenCalled()
    expect(attachSocketToSession).not.toHaveBeenCalled()
    expect(ws.send).not.toHaveBeenCalled()
  })

  it('closes an early websocket when HTTP session creation fails', async () => {
    lifecycleMocks.waitForSessionCreation.mockRejectedValueOnce(
      new SessionCreationWaitError('sess-failed', 'Session creation failed')
    )

    const ws = {
      close: vi.fn(),
      on: vi.fn(),
      readyState: 1,
      send: vi.fn()
    }

    await connectionHandler?.(ws, {
      url: '/ws?sessionId=sess-failed',
      headers: { host: 'localhost' }
    })

    expect(startAdapterSession).not.toHaveBeenCalled()
    expect(ws.send).toHaveBeenCalledOnce()
    expect(JSON.parse(String(ws.send.mock.calls[0]?.[0]))).toMatchObject({
      type: 'error',
      data: {
        message: 'Session creation failed',
        fatal: true
      }
    })
    expect(ws.close).toHaveBeenCalledWith(1008, 'Session creation failed')
  })

  it('cancels the creation wait when the websocket closes early', async () => {
    lifecycleMocks.waitForSessionCreation.mockImplementationOnce((_sessionId, options) =>
      new Promise<void>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          reject(new SessionCreationWaitError('sess-closed', 'Session creation wait cancelled'))
        }, { once: true })
      })
    )

    let closeHandler: (() => void) | undefined
    const ws = {
      close: vi.fn(),
      on: vi.fn((event: string, handler: () => void) => {
        if (event === 'close') closeHandler = handler
      }),
      readyState: 1,
      send: vi.fn()
    }
    const connection = connectionHandler?.(ws, {
      url: '/ws?sessionId=sess-closed',
      headers: { host: 'localhost' }
    })

    await vi.waitFor(() => {
      expect(closeHandler).toBeTypeOf('function')
    })
    closeHandler?.()
    await connection

    expect(startAdapterSession).not.toHaveBeenCalled()
    expect(attachSocketToSession).not.toHaveBeenCalled()
    expect(ws.send).not.toHaveBeenCalled()
  })

  it('does not attach a socket that closes while the adapter is starting', async () => {
    let finishAdapterStart: ((runtime: { sockets: Set<unknown>; session: object }) => void) | undefined
    startAdapterSession.mockImplementationOnce(() =>
      new Promise((resolve) => {
        finishAdapterStart = resolve
      })
    )
    getSession.mockReturnValue({ id: 'sess-starting', status: 'running' })

    let closeHandler: (() => void) | undefined
    const ws = {
      close: vi.fn(),
      on: vi.fn((event: string, handler: () => void) => {
        if (event === 'close') closeHandler = handler
      }),
      readyState: 1,
      send: vi.fn()
    }
    const connection = connectionHandler?.(ws, {
      url: '/ws?sessionId=sess-starting',
      headers: { host: 'localhost' }
    })

    await vi.waitFor(() => {
      expect(startAdapterSession).toHaveBeenCalledOnce()
      expect(closeHandler).toBeTypeOf('function')
    })
    closeHandler?.()
    finishAdapterStart?.({ sockets: new Set(), session: {} })
    await connection

    expect(attachSocketToSession).not.toHaveBeenCalled()
    expect(ws.send).not.toHaveBeenCalled()
  })

  it('keeps completed sessions in passive mode when opening the page', async () => {
    getSession.mockReturnValue({
      id: 'sess-1',
      status: 'completed'
    })

    const ws = {
      on: vi.fn(),
      readyState: 1,
      send: vi.fn()
    }

    await connectionHandler?.(ws, {
      url: '/ws?sessionId=sess-1',
      headers: { host: 'localhost' }
    })

    expect(startAdapterSession).not.toHaveBeenCalled()
    expect(attachSocketToSession).toHaveBeenCalledWith('sess-1', ws, 'external')
  })

  it('sends a structured error payload when adapter startup fails', async () => {
    startAdapterSession.mockRejectedValueOnce(new Error('adapter init failed'))
    getSession.mockReturnValue({ id: 'sess-1', status: 'running' })

    const ws = {
      on: vi.fn(),
      readyState: 1,
      send: vi.fn()
    }

    await connectionHandler?.(ws, {
      url: '/ws?sessionId=sess-1',
      headers: { host: 'localhost' }
    })

    expect(ws.send).toHaveBeenCalledOnce()
    expect(JSON.parse(String(ws.send.mock.calls[0]?.[0]))).toEqual({
      type: 'error',
      data: {
        message: 'adapter init failed',
        fatal: true
      },
      message: 'adapter init failed'
    })
  })

  it('sends a structured error payload when a websocket message is invalid JSON', async () => {
    startAdapterSession.mockResolvedValueOnce({ sockets: new Set(), session: {} })
    attachSocketToSession.mockReturnValue({ sockets: new Set([{}]), session: {} })
    getSession.mockReturnValue({ id: 'sess-1', status: 'running' })

    let messageHandler: ((payload: Buffer) => void) | undefined
    const ws = {
      on: vi.fn((event: string, handler: (payload: Buffer) => void) => {
        if (event === 'message') messageHandler = handler
      }),
      readyState: 1,
      send: vi.fn()
    }

    await connectionHandler?.(ws, {
      url: '/ws?sessionId=sess-1',
      headers: { host: 'localhost' }
    })

    messageHandler?.(Buffer.from('{'))

    expect(ws.send).toHaveBeenCalledOnce()
    const payload = JSON.parse(String(ws.send.mock.calls[0]?.[0]))
    expect(payload.type).toBe('error')
    expect(payload.data.fatal).toBe(true)
    expect(typeof payload.data.message).toBe('string')
  })
})
