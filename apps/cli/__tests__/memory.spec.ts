import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { runMemoryCommand } from '#~/commands/memory.js'
import type { MemoryCommandOptions } from '#~/commands/memory.js'

const tempDirs: string[] = []

const createTempDir = async () => {
  const cwd = await fs.mkdtemp(path.join(tmpdir(), 'oneworks mem-'))
  tempDirs.push(cwd)
  return cwd
}

const createEnv = (cwd: string): NodeJS.ProcessEnv => ({
  ...process.env,
  __ONEWORKS_PROJECT_CHANNEL_MEMORY_ROOT__: path.join(cwd, 'memory-root'),
  __ONEWORKS_PROJECT_CHANNEL_CONTEXT_PATH__: path.join(cwd, 'memory-root', 'runtime-context', 'sess-1.json'),
  __ONEWORKS_PROJECT_CHANNEL_TYPE__: 'wechat',
  __ONEWORKS_PROJECT_CHANNEL_KEY__: 'erjie',
  __ONEWORKS_PROJECT_CHANNEL_SESSION_TYPE__: 'group',
  __ONEWORKS_PROJECT_CHANNEL_ID__: 'group-1',
  __ONEWORKS_PROJECT_CHANNEL_SENDER_ID__: 'wxid-user',
  __ONEWORKS_PROJECT_SESSION_ID__: 'sess-1'
})

const createLocalEnv = (cwd: string): NodeJS.ProcessEnv => ({
  ...process.env,
  __ONEWORKS_PROJECT_CHANNEL_MEMORY_ROOT__: path.join(cwd, 'memory-root')
})

const createInvocationToken = (input: { channelKey: string; childRunId: string; sessionId: string }) =>
  `${Buffer.from(JSON.stringify(input), 'utf8').toString('base64url')}.test-signature`

const authorizationFetch = vi.fn<typeof fetch>(async () =>
  new Response(
    JSON.stringify({
      data: { result: { status: 'success' } },
      success: true
    }),
    { status: 200 }
  )
)

const writeContext = async (
  cwd: string,
  overrides: Record<string, unknown> = {}
) => {
  const context = {
    channelId: 'group-1',
    channelKey: 'erjie',
    channelType: 'wechat',
    childRunId: 'child-run-1',
    conversationStateId: 'conversation-1',
    entity: 'support-bot',
    executionContext: { room: { id: 'room-1' } },
    senderId: 'wxid-user',
    sessionId: 'sess-1',
    sessionType: 'group',
    ...overrides
  }
  const contextPath = path.join(cwd, 'memory-root', 'runtime-context', 'sess-1.json')
  await fs.mkdir(path.dirname(contextPath), { recursive: true })
  await fs.writeFile(
    contextPath,
    `${
      JSON.stringify(
        {
          ...context,
          invocationToken: createInvocationToken({
            channelKey: String(context.channelKey),
            childRunId: String(context.childRunId),
            sessionId: String(context.sessionId)
          })
        },
        null,
        2
      )
    }\n`
  )
}

const run = async (
  action: Parameters<typeof runMemoryCommand>[0],
  cwd: string,
  options: MemoryCommandOptions = {}
) =>
  await runMemoryCommand(action, {
    cwd,
    env: createEnv(cwd),
    fetch: authorizationFetch,
    ...options
  })

const runLocal = async (
  action: Parameters<typeof runMemoryCommand>[0],
  cwd: string,
  options: MemoryCommandOptions = {}
) =>
  await runMemoryCommand(action, {
    cwd,
    env: createLocalEnv(cwd),
    ...options
  })

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { force: true, recursive: true })))
})

describe('oneworks mem command', () => {
  it('sets, patches, and gets the default channel README memory', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)

    await run('set', cwd, { content: 'hello' })
    await run('patch', cwd, { content: 'world' })

    await expect(run('get', cwd)).resolves.toEqual({
      output: 'hello\nworld\n'
    })
    const [authorizationUrl, authorizationRequest] = authorizationFetch.mock.calls[0]!
    expect(String(authorizationUrl)).toBe('http://127.0.0.1:8787/api/channels/erjie/commands/invoke')
    expect(JSON.parse(String(authorizationRequest?.body))).toEqual({
      input: {},
      invocationToken: expect.any(String),
      toolName: 'channel.whoami'
    })
  })

  it('writes a custom path under an explicit platform id', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)

    await runLocal('set', cwd, {
      channel: 'wechat:erjie',
      content: 'reference',
      filter: 'group-2',
      path: './reference/topic.md'
    })

    await expect(runLocal('get', cwd, {
      channel: 'wechat:erjie',
      filter: 'group-2',
      path: 'reference/topic.md'
    })).resolves.toEqual({
      output: 'reference\n'
    })
  })

  it('supports session and user scopes in a channel child', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)

    await run('set', cwd, { content: 'session memo', scope: 'session' })
    await run('set', cwd, { content: 'user memo', scope: 'user' })

    await expect(run('get', cwd, { scope: 'session' })).resolves.toEqual({ output: 'session memo\n' })
    await expect(run('get', cwd, { scope: 'user' })).resolves.toEqual({ output: 'user memo\n' })
    await expect(run('get', cwd, { scope: 'global' })).rejects.toThrow(
      'Channel child memory access does not permit the global scope.'
    )
  })

  it('supports entity and stable conversation scopes from channel context', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)

    await run('set', cwd, { content: 'entity memo', scope: 'entity' })
    await run('set', cwd, { content: 'room memo', scope: 'room' })
    await run('set', cwd, { content: 'conversation memo', scope: 'conversation' })

    await expect(run('get', cwd, { scope: 'entity' })).resolves.toEqual({ output: 'entity memo\n' })
    await expect(run('get', cwd, { scope: 'room' })).resolves.toEqual({ output: 'room memo\n' })
    await expect(run('get', cwd, { scope: 'conversation' })).resolves.toEqual({ output: 'conversation memo\n' })
  })

  it('lists memories with channel and id filters', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)

    await runLocal('set', cwd, { channel: 'wechat:erjie', content: 'one', filter: 'group-1' })
    await runLocal('set', cwd, { channel: 'wechat:erjie', content: 'two', filter: 'group-2' })
    await runLocal('set', cwd, {
      channel: 'wechat:erjie',
      content: 'reference',
      filter: 'group-2',
      path: 'reference/topic.md'
    })

    const result = await runLocal('list', cwd, {
      channel: 'wechat:erjie',
      filter: 'group-2'
    })

    expect(result.output).toContain('channel\twechat:erjie\tgroup-2\tREADME.md')
    expect(result.output).toContain('channel\twechat:erjie\tgroup-2\treference/topic.md')
    expect(result.output).not.toContain('group-1')

    const filtered = await runLocal('list', cwd, {
      channel: 'wechat:erjie',
      filter: 'group-2',
      path: 'README.md'
    })
    expect(filtered.output).toContain('channel\twechat:erjie\tgroup-2\tREADME.md')
    expect(filtered.output).not.toContain('reference/topic.md')
  })

  it('rejects paths that escape the memory id directory', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)

    await expect(run('set', cwd, {
      content: 'bad',
      path: '../secret.md'
    })).rejects.toThrow('Memory path must stay inside the selected memory id.')
  })

  it('uses the current channel context file for group sender memory', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd, { senderId: 'fresh-user' })

    await run('set', cwd, { content: 'fresh memo', scope: 'user' })

    await expect(run('get', cwd, {
      filter: 'fresh-user',
      scope: 'user'
    })).resolves.toEqual({ output: 'fresh memo\n' })
    await expect(run('get', cwd, {
      filter: 'wxid-user',
      scope: 'user'
    })).rejects.toThrow('Channel child memory access is limited to its current user id.')
  })

  it('isolates direct and group user memory for the same issuer account', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd, { sessionType: 'direct' })
    await run('set', cwd, { content: 'private memo', scope: 'user' })

    await writeContext(cwd, { sessionType: 'group' })
    await expect(run('get', cwd, { scope: 'user' })).resolves.toEqual({ output: '' })
    await run('set', cwd, { content: 'group memo', scope: 'user' })

    await writeContext(cwd, { sessionType: 'direct' })
    await expect(run('get', cwd, { scope: 'user' })).resolves.toEqual({ output: 'private memo\n' })
  })

  it('rejects writes that exceed the memory file byte limit', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)

    await expect(run('set', cwd, { content: 'x'.repeat(64 * 1024) })).rejects.toThrow(
      'Memory file exceeds the 65536 byte limit.'
    )
  })

  it('rejects caller-selected ids and channels for every child-visible scope', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)

    for (const scope of ['channel', 'conversation', 'entity', 'room', 'session', 'user'] as const) {
      await expect(run('get', cwd, { filter: 'another-id', scope })).rejects.toThrow(
        `Channel child memory access is limited to its current ${scope} id.`
      )
      await expect(run('set', cwd, { content: 'blocked', filter: 'another-id', scope })).rejects.toThrow(
        `Channel child memory access is limited to its current ${scope} id.`
      )
    }
    await expect(run('list', cwd, { channel: 'wechat:other' })).rejects.toThrow(
      'Channel child memory access is limited to its current channel.'
    )
  })

  it('lists only the target bound to the active child context', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)
    await runLocal('set', cwd, { channel: 'wechat:erjie', content: 'sibling', filter: 'group-2' })
    await run('set', cwd, { content: 'current' })

    const result = await run('list', cwd)

    expect(result.output).toContain('channel\twechat:erjie\tgroup-1\tREADME.md')
    expect(result.output).not.toContain('group-2')
  })

  it('fails closed when the child invocation authority is missing or rejected', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd, { childRunId: '' })
    await expect(run('list', cwd)).rejects.toThrow('Channel memory context is missing its child run.')

    await writeContext(cwd)
    const deniedFetch = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          error: { message: 'Channel command invocation token is invalid or expired.' },
          success: false
        }),
        { status: 403 }
      )
    )
    await expect(runMemoryCommand('get', {
      cwd,
      env: createEnv(cwd),
      fetch: deniedFetch
    })).rejects.toThrow(
      'Channel memory authorization failed: Channel command invocation token is invalid or expired.'
    )

    const canonicalContextPath = createEnv(cwd).__ONEWORKS_PROJECT_CHANNEL_CONTEXT_PATH__!
    const substitutedContextPath = path.join(cwd, 'substituted-context.json')
    await fs.copyFile(canonicalContextPath, substitutedContextPath)
    await expect(runMemoryCommand('get', {
      cwd,
      env: {
        ...createEnv(cwd),
        __ONEWORKS_PROJECT_CHANNEL_CONTEXT_PATH__: substitutedContextPath
      },
      fetch: authorizationFetch
    })).rejects.toThrow('Channel memory context path does not match the active child session.')
  })

  it('keeps explicit local-human access viable without a channel child context', async () => {
    const cwd = await createTempDir()

    await runLocal('set', cwd, {
      channel: 'wechat:erjie',
      content: 'operator note',
      filter: 'group-9'
    })
    await runLocal('set', cwd, { content: 'global operator note', scope: 'global' })
    await runLocal('set', cwd, {
      channel: 'wechat:erjie',
      content: 'operator user note',
      filter: 'user-9',
      scope: 'user',
      sessionType: 'direct'
    })

    await expect(runLocal('get', cwd, {
      channel: 'wechat:erjie',
      filter: 'group-9'
    })).resolves.toEqual({ output: 'operator note\n' })
    await expect(runLocal('get', cwd, { scope: 'global' })).resolves.toEqual({ output: 'global operator note\n' })
    await expect(runLocal('get', cwd, {
      channel: 'wechat:erjie',
      filter: 'user-9',
      scope: 'user',
      sessionType: 'direct'
    })).resolves.toEqual({ output: 'operator user note\n' })
  })
})
