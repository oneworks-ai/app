import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  loadChannelLinks,
  matchesChannelLinkBinding,
  matchesChannelLinkInbound,
  resolveChannelLinkBinding,
  resolveInboundChannelLink
} from '#~/services/channel-links/index.js'

const tempDirs: string[] = []

const createWorkspace = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'server-channel-links-'))
  tempDirs.push(dir)
  return dir
}

const writeDocument = async (filePath: string, content: string) => {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content)
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('channel link service', () => {
  it('loads directory channel links and resolves an inbound group event', async () => {
    const workspace = await createWorkspace()
    await writeDocument(
      join(workspace, '.oo/channels/wan-ke-chat/channel.json'),
      JSON.stringify(
        {
          channel: 'lark-main',
          entity: 'owo-demo',
          external: {
            type: 'chat',
            chatId: 'oc_123'
          },
          authorization: {
            deliveryThrottleMs: 5000,
            resume: {
              delayMs: 2500,
              mode: 'next_message'
            }
          }
        },
        null,
        2
      )
    )

    const links = await loadChannelLinks(workspace)
    const result = resolveInboundChannelLink(links, {
      channelKey: 'lark-main',
      inbound: {
        channelType: 'lark',
        sessionType: 'group',
        channelId: 'oc_123',
        senderId: 'ou_1',
        messageId: 'om_1',
        text: 'hi',
        raw: {}
      }
    })

    expect(links.map(link => link.name)).toEqual(['wan-ke-chat'])
    expect(result?.link).toEqual(expect.objectContaining({
      authorization: {
        deliveryThrottleMs: 5000,
        resume: {
          delayMs: 2500,
          mode: 'next_message'
        }
      },
      channelKey: 'lark-main',
      entity: 'owo-demo',
      name: 'wan-ke-chat'
    }))
    expect(result?.duplicates).toEqual([])
  })

  it('matches direct links by sender id or channel id', () => {
    const link = {
      channelKey: 'wechat-main',
      entity: 'ops',
      external: {
        type: 'direct',
        senderId: 'wxid_1'
      },
      name: 'wechat-dm',
      path: '/workspace/.oo/channels/wechat-dm/channel.json',
      definition: {} as never
    }

    expect(matchesChannelLinkInbound(link, {
      channelKey: 'wechat-main',
      inbound: {
        channelType: 'wechat',
        sessionType: 'direct',
        channelId: 'wxid_1',
        senderId: 'wxid_1',
        raw: {}
      }
    })).toBe(true)
    expect(matchesChannelLinkInbound(link, {
      channelKey: 'wechat-main',
      inbound: {
        channelType: 'wechat',
        sessionType: 'group',
        channelId: 'wxid_1',
        senderId: 'wxid_1',
        raw: {}
      }
    })).toBe(false)
  })

  it('matches native OneWorks room links by room id', () => {
    const link = {
      channelKey: 'oneworks-main',
      entity: 'owo-demo',
      external: {
        type: 'room',
        roomId: 'wan-ke-native'
      },
      name: 'wan-ke-native',
      path: '/workspace/.oo/channels/wan-ke-native/channel.json',
      definition: {} as never
    }

    expect(matchesChannelLinkInbound(link, {
      channelKey: 'oneworks-main',
      inbound: {
        channelType: 'oneworks',
        sessionType: 'group',
        channelId: 'wan-ke-native',
        senderId: 'user-yijie',
        raw: {}
      }
    })).toBe(true)
    expect(matchesChannelLinkBinding(link, {
      channelKey: 'oneworks-main',
      channelId: 'wan-ke-native',
      senderId: 'user-yijie',
      sessionType: 'group'
    })).toBe(true)
    expect(matchesChannelLinkInbound(link, {
      channelKey: 'oneworks-main',
      inbound: {
        channelType: 'oneworks',
        sessionType: 'direct',
        channelId: 'wan-ke-native',
        senderId: 'user-yijie',
        raw: {}
      }
    })).toBe(false)
  })

  it('matches native OneWorks direct and thread links by native ids', () => {
    const directLink = {
      channelKey: 'oneworks-main',
      entity: 'owo-demo',
      external: {
        type: 'dm',
        directId: 'direct:user-yijie'
      },
      name: 'wan-ke-dm',
      path: '/workspace/.oo/channels/wan-ke-dm/channel.json',
      definition: {} as never
    }
    const threadLink = {
      ...directLink,
      external: {
        type: 'thread',
        threadId: 'thread-1'
      },
      name: 'wan-ke-thread',
      path: '/workspace/.oo/channels/wan-ke-thread/channel.json'
    }

    expect(matchesChannelLinkInbound(directLink, {
      channelKey: 'oneworks-main',
      inbound: {
        channelType: 'oneworks',
        sessionType: 'direct',
        channelId: 'direct:user-yijie',
        senderId: 'user-yijie',
        raw: {}
      }
    })).toBe(true)
    expect(matchesChannelLinkBinding(threadLink, {
      channelKey: 'oneworks-main',
      channelId: 'thread-1',
      senderId: 'user-yijie',
      sessionType: 'direct'
    })).toBe(true)
  })

  it('resolves a channel link from a persisted session binding', () => {
    const links = [
      {
        channelKey: 'lark-main',
        entity: 'demo',
        external: {
          type: 'group',
          chatId: 'oc_1'
        },
        name: 'demo-group',
        path: '/workspace/.oo/channels/demo-group/channel.json',
        definition: {} as never
      },
      {
        channelKey: 'lark-main',
        entity: 'demo-dm',
        external: {
          type: 'direct',
          senderId: 'ou_1'
        },
        name: 'demo-dm',
        path: '/workspace/.oo/channels/demo-dm/channel.json',
        definition: {} as never
      }
    ]

    expect(matchesChannelLinkBinding(links[0]!, {
      channelKey: 'lark-main',
      channelId: 'oc_1',
      sessionType: 'group'
    })).toBe(true)
    expect(
      resolveChannelLinkBinding(links, {
        channelKey: 'lark-main',
        channelId: 'ou_1',
        senderId: 'ou_1',
        sessionType: 'direct'
      })?.link.name
    ).toBe('demo-dm')
  })
})
