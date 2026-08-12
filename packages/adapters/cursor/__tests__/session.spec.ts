import '../src/adapter-config'

import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it } from 'vitest'

import type { AdapterCtx, AdapterOutputEvent, Cache } from '@oneworks/types'

import { createCursorSession } from '#~/runtime/session.js'

const waitFor = async (predicate: () => boolean, timeoutMs = 5_000) => {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('Timed out waiting for Cursor session events')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

const createCtx = (cwd: string, env: Record<string, string>) => {
  const cacheStore = new Map<keyof Cache, Cache[keyof Cache]>()
  const ctx: AdapterCtx = {
    ctxId: 'ctx-cursor-session-test',
    cwd,
    env,
    cache: {
      get: async <K extends keyof Cache>(key: K) => cacheStore.get(key) as Cache[K] | undefined,
      set: async <K extends keyof Cache>(key: K, value: Cache[K]) => {
        cacheStore.set(key, value)
        return { cachePath: join(cwd, '.oo', 'caches', `${String(key)}.json`) }
      }
    },
    logger: {
      stream: new PassThrough(),
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined
    },
    configs: [{ adapters: { cursor: {} } }, undefined]
  }
  return { cacheStore, ctx }
}

describe('cursor adapter session', () => {
  let tempDir: string | undefined

  afterEach(async () => {
    if (tempDir != null) await rm(tempDir, { recursive: true, force: true })
    tempDir = undefined
  })

  it('maps stream events and resumes later turns with the cached native chat id', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cursor-session-'))
    const fakeCursorPath = join(tempDir, 'fake-cursor.mjs')
    const argsPath = join(tempDir, 'args.jsonl')
    await writeFile(
      fakeCursorPath,
      [
        `#!${process.execPath}`,
        `import { appendFile } from 'node:fs/promises'`,
        `const args = process.argv.slice(2)`,
        `await appendFile(process.env.CURSOR_TEST_ARGS_PATH, JSON.stringify(args) + '\\n')`,
        `console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'cursor-chat-1' }))`,
        `console.log(JSON.stringify({ type: 'tool_call', subtype: 'started', call_id: 'call-1', tool_call: { readToolCall: { args: { path: 'README.md' } } } }))`,
        `console.log(JSON.stringify({ type: 'tool_call', subtype: 'completed', call_id: 'call-1', tool_call: { readToolCall: { result: 'ok' } } }))`,
        `console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: args.at(-1) }] } }))`,
        `console.log(JSON.stringify({ type: 'result', subtype: 'success' }))`
      ].join('\n')
    )
    await chmod(fakeCursorPath, 0o755)

    const events: AdapterOutputEvent[] = []
    const { cacheStore, ctx } = createCtx(tempDir, {
      __ONEWORKS_PROJECT_ADAPTER_CURSOR_CLI_PATH__: fakeCursorPath,
      __ONEWORKS_PROJECT_REAL_HOME__: tempDir,
      CURSOR_TEST_ARGS_PATH: argsPath
    })
    const session = await createCursorSession(ctx, {
      type: 'create',
      runtime: 'server',
      mode: 'stream',
      sessionId: 'session-1',
      description: 'first turn',
      onEvent: event => events.push(event)
    })

    await waitFor(() => events.filter(event => event.type === 'stop').length === 1)
    session.emit({ type: 'message', content: [{ type: 'text', text: 'second turn' }] })
    await waitFor(() => events.filter(event => event.type === 'stop').length === 2)
    session.stop?.()

    const invocations = (await readFile(argsPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as string[])
    expect(invocations[0]).not.toContain('--resume')
    expect(invocations[1]).toEqual(expect.arrayContaining(['--resume', 'cursor-chat-1', 'second turn']))
    expect(cacheStore.get('adapter.cursor.session')).toEqual({
      cursorSessionId: 'cursor-chat-1',
      title: 'OneWorks:session-1'
    })
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'init' }),
      expect.objectContaining({
        type: 'message',
        data: expect.objectContaining({
          content: [expect.objectContaining({ type: 'tool_use', name: 'adapter:cursor:readToolCall' })]
        })
      }),
      expect.objectContaining({
        type: 'message',
        data: expect.objectContaining({ content: 'first turn', role: 'assistant' })
      }),
      { type: 'exit', data: { exitCode: 0 } }
    ]))
  })

  it('pre-creates and caches a native chat id for direct sessions', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cursor-direct-session-'))
    const fakeCursorPath = join(tempDir, 'fake-cursor.mjs')
    const argsPath = join(tempDir, 'args.jsonl')
    await writeFile(
      fakeCursorPath,
      [
        `#!${process.execPath}`,
        `import { appendFile } from 'node:fs/promises'`,
        `const args = process.argv.slice(2)`,
        `await appendFile(process.env.CURSOR_TEST_ARGS_PATH, JSON.stringify(args) + '\\n')`,
        `if (args[0] === 'create-chat') console.log('cursor-direct-chat-1')`
      ].join('\n')
    )
    await chmod(fakeCursorPath, 0o755)

    const events: AdapterOutputEvent[] = []
    const { cacheStore, ctx } = createCtx(tempDir, {
      __ONEWORKS_PROJECT_ADAPTER_CURSOR_CLI_PATH__: fakeCursorPath,
      __ONEWORKS_PROJECT_REAL_HOME__: tempDir,
      CURSOR_TEST_ARGS_PATH: argsPath
    })
    await createCursorSession(ctx, {
      type: 'create',
      runtime: 'cli',
      mode: 'direct',
      sessionId: 'direct-session-1',
      description: 'first direct turn',
      onEvent: event => events.push(event)
    })

    await waitFor(() => events.some(event => event.type === 'exit'))
    const invocations = (await readFile(argsPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as string[])
    expect(invocations).toEqual([
      ['create-chat'],
      ['--resume', 'cursor-direct-chat-1', 'first direct turn']
    ])
    expect(cacheStore.get('adapter.cursor.session')).toEqual({
      cursorSessionId: 'cursor-direct-chat-1',
      title: 'OneWorks:direct-session-1'
    })
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'init' }),
      { type: 'exit', data: { exitCode: 0 } }
    ]))
  })

  it('emits a terminal failure when a direct resume cannot spawn Cursor', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cursor-direct-error-'))
    const events: AdapterOutputEvent[] = []
    const { cacheStore, ctx } = createCtx(tempDir, {
      __ONEWORKS_PROJECT_ADAPTER_CURSOR_CLI_PATH__: join(tempDir, 'missing-cursor'),
      __ONEWORKS_PROJECT_REAL_HOME__: tempDir
    })
    cacheStore.set('adapter.cursor.session', {
      cursorSessionId: 'cursor-existing-chat',
      title: 'OneWorks:direct-session-2'
    })

    await createCursorSession(ctx, {
      type: 'resume',
      runtime: 'cli',
      mode: 'direct',
      sessionId: 'direct-session-2',
      onEvent: event => events.push(event)
    })

    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'error', data: expect.objectContaining({ fatal: true }) }),
      expect.objectContaining({ type: 'exit', data: expect.objectContaining({ exitCode: 1 }) })
    ]))
  })
})
