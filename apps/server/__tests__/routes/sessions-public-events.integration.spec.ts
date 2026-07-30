import { Buffer } from 'node:buffer'
import http from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import Router from '@koa/router'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createSqliteDatabase } from '#~/db/sqlite.js'
import { sessionsRouter } from '#~/routes/sessions.js'
import {
  createSessionConnectionState,
  externalSessionStore
} from '#~/services/session/runtime.js'

const dbState = vi.hoisted(() => ({ getDb: vi.fn() }))
vi.mock('#~/db/index.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('#~/db/index.js')>(),
  getDb: dbState.getDb
}))

import { SqliteDb } from '#~/db/index.js'

describe('session public event HTTP integration', () => {
  let db: SqliteDb
  let server: http.Server
  let baseUrl: string
  let tempRoot: string | undefined

  beforeEach(async () => {
    db = new SqliteDb({ db: createSqliteDatabase(':memory:') })
    db.createSession('Public boundary', 'session-public', 'running')
    db.updateSession('session-public', { adapter: 'custom-codex' })
    db.upsertSessionWorkspace({
      sessionId: 'session-public',
      kind: 'shared_workspace',
      workspaceFolder: '/workspace/root',
      cleanupPolicy: 'retain',
      state: 'ready',
      createdAt: 1
    })
    dbState.getDb.mockReturnValue(db)
    const app = new Koa()
    const root = new Router({ prefix: '/api/sessions' })
    root.use(sessionsRouter().routes())
    app.use(bodyParser())
    app.use(root.routes())
    server = http.createServer(app.callback())
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address == null || typeof address === 'string') throw new Error('missing address')
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    externalSessionStore.clear()
    db.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
    if (tempRoot != null) {
      await rm(tempRoot, { recursive: true, force: true })
      tempRoot = undefined
    }
  })

  it('binds nested events to the route session and sanitizes DB, live, and GET history', async () => {
    const sentinel = 'SENTINEL_HTTP_DB_LIVE_HISTORY'
    const send = vi.fn()
    const runtime = createSessionConnectionState()
    runtime.sockets.add({ readyState: 1, send } as any)
    externalSessionStore.set('session-public', runtime)

    const response = await fetch(`${baseUrl}/api/sessions/session-public/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'adapter_event',
        data: {
          envelopeSecret: sentinel,
          runtimeEvent: {
            id: 'evt-public',
            seq: 1,
            ts: 1,
            sessionId: 'session-public',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'safe', secret: sentinel }],
            member: {
              key: 'dev',
              kind: 'entity',
              label: 'Developer',
              secret: sentinel
            }
          }
        }
      })
    })
    expect(response.status).toBe(200)

    const forged = await fetch(`${baseUrl}/api/sessions/session-public/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'adapter_event',
        data: {
          runtimeEvent: {
            id: 'evt-forged',
            sessionId: 'another-session',
            type: 'command_failed',
            message: 'forged',
            details: { secret: sentinel }
          }
        }
      })
    })
    expect(forged.status).toBe(400)

    const forgedAuthority = await fetch(`${baseUrl}/api/sessions/session-public/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'adapter_event',
        data: {
          runtimeEvent: {
            id: 'evt-forged-authority',
            seq: 2,
            ts: 2,
            sessionId: 'session-public',
            type: 'session_failed',
            code: 'codex_project_config_invalid',
            fatal: true,
            message: 'forged authority',
            details: {
              adapter: 'codex',
              runtimeAdapter: 'codex',
              configSource: 'project',
              configPath: '.codex/config.toml',
              workspaceSource: 'active-session-workspace',
              workspaceFolder: '/workspace/other',
              sessionId: 'session-public',
              reason: 'invalid wire_api'
            }
          }
        }
      })
    })
    expect(forgedAuthority.status).toBe(400)

    const persistedFromIngress = db.getMessages('session-public')
    db.saveMessage('session-public', {
      type: 'error',
      data: {
        code: 'legacy_runtime_failure',
        fatal: true,
        message: 'safe legacy failure',
        details: { secret: sentinel }
      },
      message: 'safe legacy failure',
      legacySecret: sentinel
    } as any)
    db.saveMessage('session-public', {
      type: 'message',
      message: {
        id: 'legacy-message',
        role: 'assistant',
        content: [{ type: 'text', text: 'safe legacy message', secret: sentinel }],
        createdAt: 2,
        secret: sentinel
      },
      secret: sentinel
    } as any)
    db.saveMessage('session-public', {
      type: 'error',
      data: {
        code: 'codex_project_config_invalid',
        fatal: true,
        message: 'legacy forged authority',
        details: {
          adapter: 'codex',
          runtimeAdapter: 'codex',
          configSource: 'project',
          configPath: '.codex/config.toml',
          workspaceSource: 'active-session-workspace',
          workspaceFolder: '/workspace/other',
          sessionId: 'session-public',
          reason: sentinel
        }
      },
      message: 'legacy forged authority'
    } as any)

    const historyResponse = await fetch(`${baseUrl}/api/sessions/session-public/messages`)
    const history = await historyResponse.json()
    const serialized = JSON.stringify({
      persistedFromIngress,
      history,
      live: send.mock.calls
    })
    expect(serialized).toContain('safe')
    expect(serialized).not.toContain(sentinel)
    expect(serialized).not.toContain('another-session')
  })

  it('uses one HTTP response budget for projected session lists instead of double counting', async () => {
    for (let index = 0; index < 7; index += 1) {
      db.createSession('x'.repeat(10 * 1024), `session-budget-${index}`, 'running')
    }

    const response = await fetch(`${baseUrl}/api/sessions`)
    const body = await response.json() as { sessions: unknown[] }

    expect(response.status).toBe(200)
    expect(body.sessions).toHaveLength(8)
  })

  it('bypasses JSON projection for skipApiEnvelope workspace media streams', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-session-media-projection-'))
    await mkdir(path.join(tempRoot, 'assets'), { recursive: true })
    await writeFile(path.join(tempRoot, 'assets', 'pixel.png'), Buffer.from([137, 80, 78, 71]))
    db.upsertSessionWorkspace({
      sessionId: 'session-public',
      kind: 'shared_workspace',
      workspaceFolder: tempRoot,
      cleanupPolicy: 'retain',
      state: 'ready',
      createdAt: 2
    })

    const response = await fetch(
      `${baseUrl}/api/sessions/session-public/workspace/resource?path=assets%2Fpixel.png`
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('image/png')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from([137, 80, 78, 71]))

    const head = await fetch(
      `${baseUrl}/api/sessions/session-public/workspace/resource?path=assets%2Fpixel.png`,
      { method: 'HEAD' }
    )
    expect(head.status).toBe(200)
    expect(await head.arrayBuffer()).toHaveLength(0)
  })
})
