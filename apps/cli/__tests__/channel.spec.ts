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
          replyReceiveId: 'group-1',
          replyReceiveIdType: 'chat_id',
          sessionId: 'sess-1',
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
