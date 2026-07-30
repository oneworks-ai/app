import http from 'node:http'

import Router from '@koa/router'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'

import type { WSEvent } from '@oneworks/core'

const testState = vi.hoisted(() => ({
  currentDb: undefined as unknown,
  startAdapterSession: vi.fn()
}))

vi.mock('#~/db/index.js', async () => {
  const actual = await vi.importActual<typeof import('#~/db/index.js')>('#~/db/index.js')
  return {
    ...actual,
    getDb: () => testState.currentDb
  }
})

vi.mock('#~/services/auth/index.js', async () => {
  const actual = await vi.importActual<typeof import('#~/services/auth/index.js')>(
    '#~/services/auth/index.js'
  )
  return {
    ...actual,
    resolveWebAuthConfig: vi.fn(async () => ({ enabled: false }))
  }
})

vi.mock('#~/services/session/index.js', async () => {
  const actual = await vi.importActual<typeof import('#~/services/session/index.js')>(
    '#~/services/session/index.js'
  )
  return {
    ...actual,
    startAdapterSession: testState.startAdapterSession
  }
})

import { SqliteDb } from '#~/db/index.js'
import { createSqliteDatabase } from '#~/db/sqlite.js'
import { sessionsRouter } from '#~/routes/sessions.js'
import { applySessionEvent } from '#~/services/session/events.js'
import { buildSocketErrorEvent, setupWebSocket } from '#~/websocket/server.js'

const SESSION_ID = 'sess-websocket-startup'
const WORKSPACE = '/workspace/root'

const knownStartupFailure = (overrides: Record<string, unknown> = {}) => Object.assign(
  new Error('Invalid project Codex config'),
  {
    code: 'codex_project_config_invalid',
    details: {
      adapter: 'codex',
      runtimeAdapter: 'codex',
      configSource: 'project',
      configPath: '.codex/config.toml',
      workspaceSource: 'active-session-workspace',
      workspaceFolder: WORKSPACE,
      sessionId: SESSION_ID,
      reason: 'wire_api is unsupported',
      runtimeEventId: 'runtime-event-1',
      runtimeEventSeq: 1,
      ...overrides
    }
  }
)

describe('websocket startup error persistence integration', () => {
  let db: SqliteDb
  let server: http.Server
  let baseUrl: string
  let websocketUrl: string

  beforeEach(async () => {
    vi.clearAllMocks()
    db = new SqliteDb({ db: createSqliteDatabase(':memory:') })
    testState.currentDb = db
    db.createSession('WebSocket startup', SESSION_ID, 'running')
    db.updateSession(SESSION_ID, { adapter: 'codex' })
    db.upsertSessionWorkspace({
      sessionId: SESSION_ID,
      kind: 'shared_workspace',
      workspaceFolder: WORKSPACE,
      cleanupPolicy: 'retain',
      state: 'ready',
      createdAt: 1
    })
    const app = new Koa()
    const root = new Router({ prefix: '/api/sessions' })
    root.use(sessionsRouter().routes())
    app.use(bodyParser())
    app.use(root.routes())
    server = http.createServer(app.callback())
    setupWebSocket(server, {
      __ONEWORKS_PROJECT_SERVER_WS_PATH__: '/ws'
    } as any)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address == null || typeof address === 'string') throw new Error('missing address')
    baseUrl = `http://127.0.0.1:${address.port}`
    websocketUrl = `ws://127.0.0.1:${address.port}/ws`
  })

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
    db.close()
    testState.currentDb = undefined
  })

  const receiveStartupError = async (
    query: string
  ): Promise<Extract<WSEvent, { type: 'error' }>> => await new Promise((resolve, reject) => {
    const socket = new WebSocket(`${websocketUrl}?${query}`)
    let received: Extract<WSEvent, { type: 'error' }> | undefined
    const timeout = setTimeout(() => {
      socket.terminate()
      reject(new Error('timed out waiting for startup error'))
    }, 2_000)
    socket.once('message', raw => {
      clearTimeout(timeout)
      received = JSON.parse(String(raw)) as Extract<WSEvent, { type: 'error' }>
      socket.close()
    })
    socket.once('close', () => {
      if (received != null) resolve(received)
    })
    socket.once('error', error => {
      clearTimeout(timeout)
      reject(error)
    })
  })

  it('runs the actual websocket startup catch through persistence, history, and the live socket', async () => {
    testState.startAdapterSession.mockRejectedValueOnce(knownStartupFailure())

    const liveEvent = await receiveStartupError(
      `sessionId=${SESSION_ID}&effort=high&fastMode=true&account=work`
    )
    const historyResponse = await fetch(`${baseUrl}/api/sessions/${SESSION_ID}/messages`)
    const history = await historyResponse.json()

    expect(testState.startAdapterSession).toHaveBeenCalledWith(SESSION_ID, {
      model: undefined,
      effort: 'high',
      fastMode: true,
      systemPrompt: undefined,
      appendSystemPrompt: true,
      permissionMode: undefined,
      promptType: undefined,
      promptName: undefined,
      adapter: undefined,
      account: 'work'
    })
    expect(liveEvent).toEqual(expect.objectContaining({
      type: 'error',
      data: expect.objectContaining({
        code: 'codex_project_config_invalid',
        details: expect.objectContaining({
          sessionId: SESSION_ID,
          workspaceFolder: WORKSPACE,
          adapter: 'codex',
          runtimeAdapter: 'codex'
        })
      })
    }))
    expect(db.getMessages(SESSION_ID)).toEqual([liveEvent])
    expect(history).toEqual(expect.objectContaining({
      messages: [liveEvent]
    }))
    expect(db.getSession(SESSION_ID)).toEqual(expect.objectContaining({
      adapter: 'codex',
      status: 'failed'
    }))
  })

  it.each([
    ['missing workspace authority', () => db.deleteSessionWorkspace(SESSION_ID), {}],
    ['missing final adapter authority', () => {
      db.deleteSession(SESSION_ID)
      db.createSession('WebSocket startup', SESSION_ID, 'running')
      db.upsertSessionWorkspace({
        sessionId: SESSION_ID,
        kind: 'shared_workspace',
        workspaceFolder: WORKSPACE,
        cleanupPolicy: 'retain',
        state: 'ready',
        createdAt: 1
      })
    }, {}],
    ['mismatched workspace authority', () => undefined, { workspaceFolder: '/tmp/forged' }],
    ['mismatched final adapter authority', () => undefined, { adapter: 'custom-codex' }]
  ])('downgrades %s on the actual websocket startup catch path', async (
    _label,
    arrange,
    detailOverrides
  ) => {
    arrange()
    testState.startAdapterSession.mockRejectedValueOnce(knownStartupFailure(detailOverrides))

    const liveEvent = await receiveStartupError(`sessionId=${SESSION_ID}`)
    const historyResponse = await fetch(`${baseUrl}/api/sessions/${SESSION_ID}/messages`)
    const history = await historyResponse.json()
    const serialized = JSON.stringify({
      liveEvent,
      history,
      persisted: db.getMessages(SESSION_ID)
    })

    expect(liveEvent).toEqual({
      type: 'error',
      data: {
        code: 'adapter_startup_failed',
        fatal: true,
        message: 'Invalid project Codex config'
      },
      message: 'Invalid project Codex config'
    })
    expect(serialized).not.toContain('codex_project_config_invalid')
  })

  it('redacts malformed private details on the actual websocket startup catch path', async () => {
    const sentinel = 'SENTINEL_WEBSOCKET_PRIVATE_DETAIL'
    testState.startAdapterSession.mockRejectedValueOnce(
      knownStartupFailure({ privateToken: sentinel })
    )

    const liveEvent = await receiveStartupError(`sessionId=${SESSION_ID}`)
    const historyResponse = await fetch(`${baseUrl}/api/sessions/${SESSION_ID}/messages`)
    const history = await historyResponse.json()

    expect(JSON.stringify({
      liveEvent,
      history,
      persisted: db.getMessages(SESSION_ID)
    })).not.toContain(sentinel)
    expect(liveEvent.data.code).toBe('adapter_startup_failed')
  })

  it('persists and broadcasts the authoritative known startup error through real projection', () => {
    const broadcast = vi.fn<(event: WSEvent) => void>()
    const event = buildSocketErrorEvent(
      knownStartupFailure(),
      SESSION_ID,
      WORKSPACE,
      'codex'
    )

    applySessionEvent(SESSION_ID, event, { broadcast })

    expect(db.getMessages(SESSION_ID)).toEqual([event])
    expect(broadcast).toHaveBeenCalledWith(event)
    expect(db.getSession(SESSION_ID)).toEqual(expect.objectContaining({
      adapter: 'codex',
      status: 'failed'
    }))
  })

  it.each([
    ['missing workspace authority', undefined, 'codex', {}],
    ['missing adapter authority', WORKSPACE, undefined, {}],
    ['forged workspace', WORKSPACE, 'codex', { workspaceFolder: '/tmp/forged' }],
    ['forged final adapter', WORKSPACE, 'codex', { adapter: 'custom-codex' }]
  ])('fails closed for %s before real persistence and live broadcast', (
    _label,
    expectedWorkspace,
    expectedAdapter,
    detailOverrides
  ) => {
    const broadcast = vi.fn<(event: WSEvent) => void>()
    const event = buildSocketErrorEvent(
      knownStartupFailure(detailOverrides),
      SESSION_ID,
      expectedWorkspace,
      expectedAdapter
    )

    applySessionEvent(SESSION_ID, event, { broadcast })

    const serialized = JSON.stringify({
      history: db.getMessages(SESSION_ID),
      live: broadcast.mock.calls
    })
    expect(serialized).not.toContain('codex_project_config_invalid')
    expect(db.getMessages(SESSION_ID)).toEqual([{
      type: 'error',
      data: {
        code: 'adapter_startup_failed',
        fatal: true,
        message: 'Invalid project Codex config'
      },
      message: 'Invalid project Codex config'
    }])
  })

  it('redacts a malformed known-error sentinel from real history and live callbacks', () => {
    const sentinel = 'SENTINEL_WEBSOCKET_PRIVATE_DETAIL'
    const broadcast = vi.fn<(event: WSEvent) => void>()
    const event = buildSocketErrorEvent(
      knownStartupFailure({ privateToken: sentinel }),
      SESSION_ID,
      WORKSPACE,
      'codex'
    )

    applySessionEvent(SESSION_ID, event, { broadcast })

    expect(JSON.stringify({
      history: db.getMessages(SESSION_ID),
      live: broadcast.mock.calls
    })).not.toContain(sentinel)
  })
})
