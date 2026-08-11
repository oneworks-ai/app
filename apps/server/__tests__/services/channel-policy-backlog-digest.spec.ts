import { describe, expect, it, vi } from 'vitest'

import { processOffhourBacklogDigest } from '#~/services/channel-policy/backlog-digest.js'

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }))

vi.mock('#~/db/index.js', () => ({ getDb }))
vi.mock('#~/services/session/create.js', () => ({ createSessionWithInitialMessage: vi.fn() }))
vi.mock('#~/services/session/index.js', () => ({ writeChannelMessageContext: vi.fn() }))

describe('off-hours backlog digest', () => {
  it('keeps dispatch failures retryable and reuses the deterministic child run', async () => {
    const row: any = {
      actorUserId: null,
      attempts: 1,
      channelId: 'oc_1',
      channelKey: 'lark-main',
      channelLinkName: 'support',
      channelType: 'lark',
      createdAt: 1,
      digestChildRunId: null,
      entity: 'assistant',
      id: 'backlog-1',
      senderId: 'ou_1',
      sessionType: 'group',
      text: 'hello'
    }
    const runs = new Map<string, any>()
    const db = {
      attachChannelOffhourBacklogDigestChildRun: vi.fn(({ digestChildRunId }: any) => {
        row.digestChildRunId = digestChildRunId
        return 1
      }),
      claimChannelOffhourBacklog: vi.fn(() => [row]),
      completeChannelOffhourBacklogClaim: vi.fn(() => 1),
      createChannelChildSessionRun: vi.fn((input: any) => {
        const run = { ...input, status: 'started' }
        runs.set(input.id, run)
        return run
      }),
      getChannelChildSessionRun: vi.fn((id: string) => runs.get(id)),
      markChannelChildSessionRunDispatched: vi.fn((id: string, { sessionId }: any) => {
        runs.get(id).sessionId = sessionId
        runs.get(id).status = 'dispatched'
      }),
      markChannelChildSessionRunRunning: vi.fn((id: string) => {
        runs.get(id).status = 'running'
      }),
      retryChannelOffhourBacklogClaim: vi.fn()
    }
    getDb.mockReturnValue(db)

    await expect(processOffhourBacklogDigest({
      dispatch: async () => {
        throw new Error('offline')
      }
    })).rejects.toThrow('offline')
    expect(db.completeChannelOffhourBacklogClaim).not.toHaveBeenCalled()
    expect(db.retryChannelOffhourBacklogClaim).toHaveBeenCalledWith(expect.objectContaining({ ids: ['backlog-1'] }))

    await expect(processOffhourBacklogDigest({ dispatch: async () => 'session-1' })).resolves.toMatchObject({
      processed: 1
    })
    expect(db.createChannelChildSessionRun).toHaveBeenCalledTimes(1)
    expect(db.markChannelChildSessionRunDispatched).toHaveBeenCalledTimes(1)
  })
})
