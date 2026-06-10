import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

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
  __ONEWORKS_PROJECT_CHANNEL_CONTEXT_PATH__: path.join(cwd, 'channel-context.json'),
  __ONEWORKS_PROJECT_CHANNEL_TYPE__: 'wechat',
  __ONEWORKS_PROJECT_CHANNEL_KEY__: 'erjie',
  __ONEWORKS_PROJECT_CHANNEL_SESSION_TYPE__: 'group',
  __ONEWORKS_PROJECT_CHANNEL_ID__: 'group-1',
  __ONEWORKS_PROJECT_CHANNEL_SENDER_ID__: 'wxid-user',
  __ONEWORKS_PROJECT_SESSION_ID__: 'sess-1'
})

const writeContext = async (
  cwd: string,
  overrides: Record<string, unknown> = {}
) => {
  await fs.writeFile(
    path.join(cwd, 'channel-context.json'),
    `${
      JSON.stringify(
        {
          channelId: 'group-1',
          channelKey: 'erjie',
          channelType: 'wechat',
          senderId: 'wxid-user',
          sessionId: 'sess-1',
          sessionType: 'group',
          ...overrides
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
    ...options
  })

afterEach(async () => {
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
  })

  it('writes a custom path under an explicit platform id', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)

    await run('set', cwd, {
      content: 'reference',
      filter: 'group-2',
      path: './reference/topic.md'
    })

    await expect(run('get', cwd, {
      filter: 'group-2',
      path: 'reference/topic.md'
    })).resolves.toEqual({
      output: 'reference\n'
    })
  })

  it('supports session, user, and global scopes', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)

    await run('set', cwd, { content: 'session memo', scope: 'session' })
    await run('set', cwd, { content: 'user memo', scope: 'user' })
    await run('set', cwd, { content: 'global memo', scope: 'global' })

    await expect(run('get', cwd, { scope: 'session' })).resolves.toEqual({ output: 'session memo\n' })
    await expect(run('get', cwd, { scope: 'user' })).resolves.toEqual({ output: 'user memo\n' })
    await expect(run('get', cwd, { scope: 'global' })).resolves.toEqual({ output: 'global memo\n' })
  })

  it('lists memories with channel and id filters', async () => {
    const cwd = await createTempDir()
    await writeContext(cwd)

    await run('set', cwd, { content: 'one' })
    await run('set', cwd, { content: 'two', filter: 'group-2' })
    await run('set', cwd, { content: 'reference', filter: 'group-2', path: 'reference/topic.md' })

    const result = await run('list', cwd, {
      channel: 'wechat',
      filter: 'group-2'
    })

    expect(result.output).toContain('channel\twechat\tgroup-2\tREADME.md')
    expect(result.output).toContain('channel\twechat\tgroup-2\treference/topic.md')
    expect(result.output).not.toContain('group-1')

    const filtered = await run('list', cwd, {
      channel: 'wechat',
      filter: 'group-2',
      path: 'README.md'
    })
    expect(filtered.output).toContain('channel\twechat\tgroup-2\tREADME.md')
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
    })).resolves.toEqual({ output: '' })
  })
})
