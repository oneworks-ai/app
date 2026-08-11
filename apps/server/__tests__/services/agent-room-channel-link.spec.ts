import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveAgentRoomChannelLink } from '#~/services/agent-room/channel-link.js'

const { getChannelManager } = vi.hoisted(() => ({ getChannelManager: vi.fn() }))

vi.mock('#~/channels/index.js', () => ({ getChannelManager }))

describe('agent Room ChannelLink resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getChannelManager.mockReturnValue({
      states: new Map([['lark:product', {
        channelLinks: [{
          address: { id: 'oc_trusted', kind: 'group' },
          channelKey: 'lark:product',
          definition: { attributes: { name: 'Trusted group' } },
          entity: 'product',
          external: { chatId: 'oc_trusted', type: 'chat' },
          name: 'trusted-link'
        }],
        config: { title: 'Product bot' },
        key: 'lark:product',
        status: 'connected',
        type: 'lark'
      }]])
    })
  })

  it('constructs the attachment only from the loaded runtime and ChannelLink', async () => {
    await expect(resolveAgentRoomChannelLink('trusted-link')).resolves.toEqual({
      accountLabel: 'Product bot',
      channelId: 'oc_trusted',
      channelKey: 'lark:product',
      channelLinkName: 'trusted-link',
      channelType: 'lark',
      conversationKind: 'group',
      entity: 'product',
      label: 'trusted-link',
      receiveId: 'oc_trusted',
      receiveIdType: 'chat_id'
    })
  })

  it('fails closed for unknown links and providers without a receive id type', async () => {
    await expect(resolveAgentRoomChannelLink('missing-link')).rejects.toThrow('ChannelLink not found')
    const state = getChannelManager.mock.results[0]?.value.states.get('lark:product')
    state.type = 'custom-provider'
    await expect(resolveAgentRoomChannelLink('trusted-link')).rejects.toThrow('external.receiveIdType')
  })

  it('rejects thread links until the authoritative parent conversation is available', async () => {
    const state = getChannelManager().states.get('lark:product')
    state.channelLinks[0].address = { id: 'thread-1', kind: 'thread' }
    state.channelLinks[0].external = { threadId: 'thread-1', type: 'thread' }

    await expect(resolveAgentRoomChannelLink('trusted-link')).rejects.toThrow(
      'Thread ChannelLink is not deliverable without its parent conversation'
    )
  })
})
