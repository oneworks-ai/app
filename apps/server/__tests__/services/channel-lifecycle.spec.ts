import { beforeEach, describe, expect, it, vi } from 'vitest'

import { commitChannelChildRunTerminal, recordChannelOutboundTurn } from '../../src/services/channel-lifecycle'

const db = {
  appendChannelConversationTurn: vi.fn(),
  commitChannelMemoryWriteback: vi.fn(),
  createPendingChannelMemoryWriteback: vi.fn(() => 'audit-1'),
  finishChannelChildSessionRun: vi.fn(),
  getChannelMemory: vi.fn(),
  getChannelChildSessionRunBySessionId: vi.fn(),
  listRecentChannelConversationTurns: vi.fn(() => [])
}

vi.mock('../../src/db/index.js', () => ({ getDb: () => db }))

describe('channel lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.createPendingChannelMemoryWriteback.mockReturnValue('audit-1')
  })

  it('commits a terminal child once and records the memory check result', () => {
    const run = {
      actorAccountId: 'account-1',
      actorUserId: 'user-1',
      channelId: 'chat-1',
      channelKey: 'main',
      channelType: 'lark',
      conversationStateId: 'conversation-1',
      entity: 'bot',
      id: 'run-1',
      messageId: 'message-1',
      senderId: 'account-1',
      sessionType: 'group',
      status: 'running',
      threadKey: 'thread-1'
    }
    db.getChannelChildSessionRunBySessionId.mockReturnValueOnce(run).mockReturnValueOnce({
      ...run,
      status: 'completed'
    })
    db.finishChannelChildSessionRun.mockReturnValue({ completedAt: 10, id: 'run-1', status: 'completed' })
    commitChannelChildRunTerminal({ sessionId: 'session-1', status: 'completed' })
    commitChannelChildRunTerminal({ sessionId: 'session-1', status: 'completed' })
    expect(db.finishChannelChildSessionRun).toHaveBeenCalledTimes(1)
    expect(db.createPendingChannelMemoryWriteback).toHaveBeenCalledWith({
      childRunId: 'run-1',
      patch: {
        changedMemoryIds: [],
        kind: 'terminal_check',
        result: 'no_change',
        status: 'completed'
      },
      patchKey: 'terminal-check:completed'
    })
    expect(db.commitChannelMemoryWriteback).toHaveBeenCalledWith('audit-1')
  })

  it('records one outbound turn for a delivered platform message', () => {
    db.getChannelChildSessionRunBySessionId.mockReturnValue({
      channelId: 'chat-1',
      channelKey: 'main',
      channelLinkName: null,
      channelType: 'lark',
      conversationStateId: 'state-1',
      entity: 'bot',
      id: 'run-1',
      sessionType: 'direct',
      threadKey: 'thread-1'
    })
    recordChannelOutboundTurn({ messageId: 'message-1', sessionId: 'session-1', text: 'Done' })
    expect(db.appendChannelConversationTurn).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'message-1', role: 'outbound', text: 'Done' })
    )
  })
})
