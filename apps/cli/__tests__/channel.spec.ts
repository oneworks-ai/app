/* eslint-disable max-lines -- Channel CLI lifecycle coverage shares one command harness and filesystem fixture. */
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { runChannelCommand } from '#~/commands/channel.js'

const tempDirs: string[] = []

const createTempDir = async () => {
  const cwd = await fs.mkdtemp(path.join(tmpdir(), 'oneworks channel-'))
  tempDirs.push(cwd)
  return cwd
}

const writeContext = async (cwd: string) => {
  await fs.writeFile(
    path.join(cwd, 'channel-context.json'),
    `${
      JSON.stringify(
        {
          channelId: 'group-1',
          channelKey: 'erjie',
          channelType: 'wechat',
          invocationToken: 'signed-child-run-token',
          replyReceiveId: 'group-1',
          replyReceiveIdType: 'chat_id',
          senderId: 'wxid-user',
          sessionId: 'sess-1',
          sessionType: 'group'
        },
        null,
        2
      )
    }\n`
  )
}

const writeNativeContext = async (cwd: string) => {
  await fs.writeFile(
    path.join(cwd, 'channel-context.json'),
    `${
      JSON.stringify(
        {
          channelId: 'wan-ke-native',
          channelKey: 'oneworks-main',
          channelType: 'oneworks',
          replyReceiveId: 'wan-ke-native',
          replyReceiveIdType: 'room',
          senderId: 'user-yijie',
          sessionId: 'sess-native',
          sessionType: 'group'
        },
        null,
        2
      )
    }\n`
  )
}

const createEnv = (cwd: string): NodeJS.ProcessEnv => ({
  ...process.env,
  __ONEWORKS_PROJECT_CHANNEL_CONTEXT_PATH__: path.join(cwd, 'channel-context.json'),
  __ONEWORKS_PROJECT_CHANNEL_MEMORY_ROOT__: path.join(cwd, 'channel-memory'),
  __ONEWORKS_PROJECT_SERVER_HOST__: '127.0.0.1',
  __ONEWORKS_PROJECT_SERVER_PORT__: '9876'
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { force: true, recursive: true })))
})

describe('oneworks channel command', () => {
  it('sends text using channel context defaults', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        data: {
          type: 'text',
          messageId: 'om_text'
        }
      }))
    )

    await expect(runChannelCommand(['send', 'hello', 'world'], {
      cwd,
      env: createEnv(cwd),
      fetch
    })).resolves.toContain('messageId: om_text')

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9876/api/channels/erjie/send',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          cwd,
          message: 'hello world',
          receiveId: 'group-1',
          receiveIdType: 'chat_id',
          sessionId: 'sess-1'
        })
      })
    )
  })

  it('converts escaped line breaks in text payloads before sending', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        data: {
          type: 'text'
        }
      }))
    )

    await runChannelCommand(['send', '第一段\\n\\n- 第二段'], {
      cwd,
      env: createEnv(cwd),
      fetch
    })

    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body)).toMatchObject({
      message: '第一段\n\n- 第二段'
    })
  })

  it('rejects text messages longer than 200 visible characters', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)
    const fetch = vi.fn()

    await expect(runChannelCommand(['send', '你'.repeat(201)], {
      cwd,
      env: createEnv(cwd),
      fetch
    })).rejects.toThrow('200 characters or fewer')

    expect(fetch).not.toHaveBeenCalled()
  })

  it('converts escaped line breaks in structured text payloads before sending', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        data: {
          type: 'text'
        }
      }))
    )

    await runChannelCommand([
      'send',
      '{ "type": "text", "text": "第一段\\\\n第二段" }'
    ], {
      cwd,
      env: createEnv(cwd),
      fetch
    })

    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body)).toMatchObject({
      message: {
        type: 'text',
        text: '第一段\n第二段'
      }
    })
  })

  it('rejects structured text payloads longer than 200 visible characters', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)
    const fetch = vi.fn()

    await expect(runChannelCommand([
      'send',
      JSON.stringify({ type: 'text', text: '你'.repeat(201) })
    ], {
      cwd,
      env: createEnv(cwd),
      fetch
    })).rejects.toThrow('200 characters or fewer')

    expect(fetch).not.toHaveBeenCalled()
  })

  it('converts explicit line break markers before sending text', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        data: {
          type: 'text'
        }
      }))
    )

    await runChannelCommand(['send', '--br', '第一段⏎⏎- 第二段'], {
      cwd,
      env: createEnv(cwd),
      fetch
    })

    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body)).toMatchObject({
      message: '第一段\n\n- 第二段'
    })
  })

  it('supports custom line break markers in structured text payloads', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        data: {
          type: 'text'
        }
      }))
    )

    await runChannelCommand([
      'send',
      '--newline-token',
      '<br>',
      '{ "type": "text", "text": "第一段<br>第二段" }'
    ], {
      cwd,
      env: createEnv(cwd),
      fetch
    })

    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body)).toMatchObject({
      message: {
        type: 'text',
        text: '第一段\n第二段'
      }
    })
  })

  it('accepts an explicit channel key and loose object payload', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        data: {
          type: 'image'
        }
      }))
    )

    await runChannelCommand(['erjie', 'send', '{', 'type:', 'image,', 'src:', 'https://example.com/a.png', '}'], {
      cwd,
      env: createEnv(cwd),
      fetch
    })

    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body)).toEqual({
      cwd,
      message: {
        type: 'image',
        src: 'https://example.com/a.png'
      },
      receiveId: 'group-1',
      receiveIdType: 'chat_id',
      sessionId: 'sess-1'
    })
  })

  it('passes WeChat mention flags as structured mentions', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        data: {
          type: 'text',
          messageId: 'om_at'
        }
      }))
    )

    await runChannelCommand([
      'send',
      '--at',
      'wxid_a',
      '--at',
      'wxid_b',
      '@张三',
      '@李四',
      '麻烦看一下'
    ], {
      cwd,
      env: createEnv(cwd),
      fetch
    })

    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body)).toEqual({
      cwd,
      message: '@张三 @李四 麻烦看一下',
      mentions: [
        { id: 'wxid_a', platform: 'wechat', type: 'user' },
        { id: 'wxid_b', platform: 'wechat', type: 'user' }
      ],
      receiveId: 'group-1',
      receiveIdType: 'chat_id',
      sessionId: 'sess-1'
    })
  })

  it('passes raw ats and at-all mention flags', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        data: {
          type: 'text'
        }
      }))
    )

    await runChannelCommand(['send', '--ats', 'wxid_a,wxid_b', '--at-all', '@所有人', '请看一下'], {
      cwd,
      env: createEnv(cwd),
      fetch
    })

    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body)).toEqual({
      cwd,
      message: '@所有人 请看一下',
      mentions: [
        { id: 'wxid_a', platform: 'wechat', type: 'user' },
        { id: 'wxid_b', platform: 'wechat', type: 'user' },
        { id: 'notify@all', platform: 'wechat', type: 'all' }
      ],
      receiveId: 'group-1',
      receiveIdType: 'chat_id',
      sessionId: 'sess-1'
    })
  })

  it('stores, reads, and sends emoji registry entries', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)
    const env = createEnv(cwd)
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        data: {
          type: 'emoji',
          messageId: 'om_emoji'
        }
      }))
    )

    await expect(runChannelCommand([
      'emoji',
      'save',
      'thumbs-up-bear',
      '--platform',
      'wechat',
      '--emoji-md5',
      '4cc7540a85b5b6cf4ba14e9f4ae08b7c',
      '--emoji-size',
      '102357',
      '--label',
      '点赞小熊',
      '--alias',
      '赞',
      '--tag',
      '赞同',
      '--note',
      '适合回应认可或没问题'
    ], { cwd, env, fetch })).resolves.toContain('Emoji saved: wechat:thumbs-up-bear')

    await expect(runChannelCommand([
      'emoji',
      'annotate',
      'thumbs-up-bear',
      '--platform',
      'wechat',
      '--alias',
      '没问题',
      '--tag',
      '确认',
      '--meta',
      'mood=positive'
    ], { cwd, env, fetch })).resolves.toContain('Emoji saved: wechat:thumbs-up-bear')

    await expect(runChannelCommand(['emoji', 'list', '--platform', 'wechat', '--tag', '确认'], { cwd, env, fetch }))
      .resolves.toContain('thumbs-up-bear')
    await expect(runChannelCommand(['emoji', 'get', '赞', '--platform', 'wechat'], { cwd, env, fetch }))
      .resolves.toContain('4cc7540a85b5b6cf4ba14e9f4ae08b7c')
    await expect(runChannelCommand(['emoji', 'list', '--platform', 'wechat', '--query', 'positive', '--sendable'], {
      cwd,
      env,
      fetch
    })).resolves.toContain('sendable=yes')

    await expect(runChannelCommand(['emoji', 'send', 'thumbs-up-bear', '--platform', 'wechat'], {
      cwd,
      env,
      fetch
    })).resolves.toContain('messageId: om_emoji')

    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body)).toEqual({
      cwd,
      message: {
        type: 'emoji',
        id: 'thumbs-up-bear',
        platform: 'wechat'
      },
      receiveId: 'group-1',
      receiveIdType: 'chat_id',
      sessionId: 'sess-1'
    })
  })

  it('lists channel command tools for the current channel context', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        tools: [
          {
            name: 'channel.auth.list',
            permission: 'everyone',
            slashUsage: '/auth list [scope]'
          }
        ]
      }))
    )

    await expect(runChannelCommand(['command', 'list'], {
      cwd,
      env: createEnv(cwd),
      fetch
    })).resolves.toContain('channel.auth.list [everyone] - /auth list [scope]')

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:9876/api/channels/erjie/commands')
  })

  it('invokes channel command tools with the channel sender context', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)
    const env = createEnv(cwd)
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        replies: ['授权请求 auth-1 已标记为 已批准。'],
        result: {
          status: 'success'
        }
      }))
    )

    const output = await runChannelCommand([
      'command',
      'invoke',
      'channel.auth.grant',
      '{ "id": "auth-1" }'
    ], { cwd, env, fetch })

    expect(output).toContain('授权请求 auth-1 已标记为 已批准。')
    expect(output).toContain('"status": "success"')
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9876/api/channels/erjie/commands/invoke',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          input: {
            id: 'auth-1'
          },
          invocationToken: 'signed-child-run-token',
          toolName: 'channel.auth.grant'
        })
      })
    )
  })

  it('posts OneWorks native simulation events to the channel webhook', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        channelId: 'wan-ke-native',
        messageId: 'sim-1',
        ok: true,
        sessionType: 'group'
      }))
    )

    const output = await runChannelCommand([
      'oneworks-main',
      'simulate',
      '--room',
      'wan-ke-native',
      '--sender',
      'user-yijie',
      '--message-id',
      'sim-1',
      '--secret',
      'dev-secret',
      '@OWO',
      'hi'
    ], {
      cwd,
      env: createEnv(cwd),
      fetch
    })

    expect(output).toContain('Simulated OneWorks channel event through oneworks-main.')
    expect(output).toContain('messageId: sim-1')
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9876/channels/oneworks/oneworks-main/webhook',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-oneworks-channel-nonce': expect.any(String),
          'x-oneworks-channel-signature': expect.stringMatching(/^sha256=/u),
          'x-oneworks-channel-timestamp': expect.any(String)
        })
      })
    )
    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body)).toEqual({
      messageId: 'sim-1',
      roomId: 'wan-ke-native',
      senderId: 'user-yijie',
      text: '@OWO hi'
    })
  })

  it('accepts structured OneWorks simulation payloads', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        channelId: 'room-1',
        ok: true,
        sessionType: 'group'
      }))
    )

    await runChannelCommand([
      'simulate',
      '--channel',
      'oneworks-main',
      '{ "roomId": "room-1", "senderId": "user-a", "text": "@OWO hi" }'
    ], {
      cwd,
      env: createEnv(cwd),
      fetch
    })

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9876/channels/oneworks/oneworks-main/webhook',
      expect.objectContaining({
        body: JSON.stringify({
          roomId: 'room-1',
          senderId: 'user-a',
          text: '@OWO hi'
        })
      })
    )
  })

  it('uses OneWorks native channel context defaults for simulation', async () => {
    const cwd = await createTempDir()
    await writeNativeContext(cwd)
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        channelId: 'wan-ke-native',
        ok: true,
        sessionType: 'group'
      }))
    )

    await runChannelCommand(['simulate', '@OWO', 'hi'], {
      cwd,
      env: createEnv(cwd),
      fetch
    })

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9876/channels/oneworks/oneworks-main/webhook',
      expect.objectContaining({
        method: 'POST'
      })
    )
    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body)).toEqual({
      roomId: 'wan-ke-native',
      senderId: 'user-yijie',
      sessionType: 'group',
      text: '@OWO hi'
    })
  })

  it('does not infer OneWorks simulation channel keys from non-native context', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)
    const fetch = vi.fn()

    await expect(runChannelCommand(['simulate', '--sender', 'user-a', '@OWO hi'], {
      cwd,
      env: createEnv(cwd),
      fetch
    })).rejects.toThrow('Missing OneWorks native channel key')

    expect(fetch).not.toHaveBeenCalled()
  })

  it('reads OneWorks native debug outbound messages', async () => {
    const cwd = await createTempDir()
    await writeNativeContext(cwd)
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        messages: [
          {
            messageId: 'oneworks-out-1',
            receiveId: 'wan-ke-native',
            receiveIdType: 'room',
            text: 'first'
          },
          {
            messageId: 'oneworks-out-2',
            receiveId: 'wan-ke-native',
            receiveIdType: 'room',
            text: 'second'
          }
        ]
      }))
    )

    const output = await runChannelCommand(['debug', 'outbound', '--limit', '1'], {
      cwd,
      env: createEnv(cwd),
      fetch
    })

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:9876/api/channels/oneworks-main/debug/outbound')
    expect(JSON.parse(output)).toEqual({
      messages: [
        {
          messageId: 'oneworks-out-2',
          receiveId: 'wan-ke-native',
          receiveIdType: 'room',
          text: 'second'
        }
      ]
    })
  })

  it('clears OneWorks native debug outbound messages', async () => {
    const cwd = await createTempDir()
    await writeNativeContext(cwd)
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }))
    )

    await expect(runChannelCommand(['debug', 'outbound', '--clear'], {
      cwd,
      env: createEnv(cwd),
      fetch
    })).resolves.toContain('Cleared debug outbound messages for channel oneworks-main.')

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9876/api/channels/oneworks-main/debug/outbound',
      { method: 'DELETE' }
    )
  })

  it('requires a sender for OneWorks native simulation', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)
    const fetch = vi.fn()

    await expect(runChannelCommand([
      'oneworks-main',
      'simulate',
      '--room',
      'wan-ke-native',
      '@OWO hi'
    ], {
      cwd,
      env: createEnv(cwd),
      fetch
    })).rejects.toThrow('requires senderId')

    expect(fetch).not.toHaveBeenCalled()
  })

  it('surfaces server errors', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'bad_request',
            message: 'Missing receiveId.'
          }
        }),
        { status: 400 }
      )
    )

    await expect(runChannelCommand(['send', 'hello'], {
      cwd,
      env: createEnv(cwd),
      fetch
    })).rejects.toThrow('Missing receiveId.')
  })
})
