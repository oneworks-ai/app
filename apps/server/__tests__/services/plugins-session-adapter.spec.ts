import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '#~/db/index.js'
import { createPluginSessionAdapter } from '#~/services/plugins/session-adapter.js'
import { processUserMessage } from '#~/services/session/index.js'

vi.mock('#~/db/index.js', () => ({
  getDb: vi.fn()
}))

vi.mock('#~/services/session/index.js', () => ({
  processUserMessage: vi.fn()
}))

describe('plugin session adapter', () => {
  const db = {
    getSession: vi.fn(),
    getSessions: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getDb).mockReturnValue(db as never)
    db.getSessions.mockReturnValue([{ id: 'sess-1' }])
    db.getSession.mockReturnValue({ id: 'sess-1' })
  })

  it('lists active sessions for plugins', () => {
    const adapter = createPluginSessionAdapter()

    expect(adapter.listSessions()).toEqual([{ id: 'sess-1' }])
    expect(db.getSessions).toHaveBeenCalledWith('active')
  })

  it('submits a message into an existing session', async () => {
    const adapter = createPluginSessionAdapter()

    await expect(adapter.submitMessage({
      message: '  hello relay  ',
      sessionId: ' sess-1 '
    })).resolves.toEqual({
      accepted: true,
      sessionId: 'sess-1'
    })
    expect(db.getSession).toHaveBeenCalledWith('sess-1')
    expect(processUserMessage).toHaveBeenCalledWith('sess-1', 'hello relay')
  })

  it('rejects invalid submit requests', async () => {
    const adapter = createPluginSessionAdapter()

    await expect(adapter.submitMessage({ message: 'hello', sessionId: '' })).rejects.toThrow('session_id_required')
    await expect(adapter.submitMessage({ message: '', sessionId: 'sess-1' })).rejects.toThrow('message_required')

    db.getSession.mockReturnValue(undefined)
    await expect(adapter.submitMessage({ message: 'hello', sessionId: 'missing' })).rejects.toThrow('session_not_found')
    expect(processUserMessage).not.toHaveBeenCalled()
  })
})
