import type { ChannelInboundEvent } from '@oneworks/core/channel'
import { describe, expect, it, vi } from 'vitest'

import { enqueueChannelInboundEvent } from '#~/channels/inbound-queue.js'

const groupEvent = (messageId: string): ChannelInboundEvent => ({
  channelId: 'chat_shared',
  channelType: 'lark',
  messageId,
  raw: {},
  sessionType: 'group',
  text: 'hello'
})

describe('channel inbound queue', () => {
  it('serializes the same provider message across channel accounts', async () => {
    let releaseFirst: (() => void) | undefined
    const first = enqueueChannelInboundEvent('lark:bot-a', groupEvent('om_shared'), async () => {
      await new Promise<void>(resolve => {
        releaseFirst = resolve
      })
      return 'first'
    })
    await vi.waitFor(() => expect(releaseFirst).toBeDefined())

    const secondTask = vi.fn(() => 'second')
    const second = enqueueChannelInboundEvent('lark:bot-b', groupEvent('om_shared'), secondTask)
    await Promise.resolve()
    expect(secondTask).not.toHaveBeenCalled()

    releaseFirst!()
    await expect(first).resolves.toBe('first')
    await expect(second).resolves.toBe('second')
  })

  it('serializes different messages from the same group', async () => {
    let releaseFirst: (() => void) | undefined
    const first = enqueueChannelInboundEvent('lark:bot-a', groupEvent('om_first'), async () => {
      await new Promise<void>(resolve => {
        releaseFirst = resolve
      })
    })
    await vi.waitFor(() => expect(releaseFirst).toBeDefined())

    const secondTask = vi.fn(() => 'second')
    const second = enqueueChannelInboundEvent('lark:bot-a', groupEvent('om_second'), secondTask)
    await Promise.resolve()
    expect(secondTask).not.toHaveBeenCalled()

    releaseFirst!()
    await first
    await expect(second).resolves.toBe('second')
  })
})
