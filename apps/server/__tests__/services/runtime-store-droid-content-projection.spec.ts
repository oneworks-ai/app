import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SqliteDb } from '#~/db/index.js'
import { createSqliteDatabase } from '#~/db/sqlite.js'
import { projectRuntimeEvent } from '#~/services/runtime-store/projection.js'
import { broadcastSessionEvent } from '#~/services/session/runtime.js'

vi.mock('#~/services/session/runtime.js', () => ({
  broadcastSessionEvent: vi.fn(),
  notifySessionUpdated: vi.fn()
}))

describe('factory Droid imported content projection', () => {
  let db: SqliteDb

  beforeEach(() => {
    db = new SqliteDb({ db: createSqliteDatabase(':memory:') })
    vi.clearAllMocks()
  })

  afterEach(() => {
    db.close()
  })

  it('persists and broadcasts a legal assistant tool-result/document message unchanged', () => {
    const content = [
      { type: 'tool_result', tool_use_id: 'factory-tool-1', content: 'ok', is_error: false },
      {
        type: 'file',
        path: 'factory-document://sha256/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        name: 'report.pdf',
        mimeType: 'application/pdf',
        data: 'JVBERg==',
        encoding: 'base64'
      }
    ] as const
    projectRuntimeEvent({
      id: 'factory-tool-result',
      seq: 1,
      sessionId: 'factory-imported-session',
      type: 'message',
      role: 'assistant',
      content: [...content]
    }, {
      db,
      broadcast: true,
      agentRoomProjectionEnabled: false,
      metadata: {
        adapter: 'droid',
        sessionId: 'factory-imported-session',
        title: 'Factory imported session'
      }
    })

    const expectedEvent = {
      type: 'message',
      message: expect.objectContaining({
        id: 'factory-tool-result',
        role: 'assistant',
        content
      })
    }
    expect(db.getMessages('factory-imported-session')).toEqual([expectedEvent])
    expect(broadcastSessionEvent).toHaveBeenCalledWith('factory-imported-session', expectedEvent)
  })
})
