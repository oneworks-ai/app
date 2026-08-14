/* eslint-disable max-lines -- lifecycle, identity, redaction, and terminal behavior share one fake-CLI harness. */
import '../src/adapter-config'

import { Buffer } from 'node:buffer'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it } from 'vitest'

import type { AdapterCtx, AdapterOutputEvent, Cache } from '@oneworks/types'

import { createQwenCodeSession } from '#~/runtime/session.js'

const waitFor = async (predicate: () => boolean, timeoutMs = 5_000) => {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('Timed out waiting for Qwen Code events')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const createCtx = (params: {
  binaryPath: string
  cwd: string
  cacheStore?: Map<keyof Cache, Cache[keyof Cache]>
  env?: Record<string, string>
}): AdapterCtx => {
  const cacheStore = params.cacheStore ?? new Map<keyof Cache, Cache[keyof Cache]>()
  return {
    ctxId: 'ctx-qwen-code-session-test',
    cwd: params.cwd,
    env: {
      __ONEWORKS_PROJECT_ADAPTER_QWEN_CODE_CLI_PATH__: params.binaryPath,
      __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: join(params.cwd, '.project-home'),
      __ONEWORKS_PROJECT_QWEN_CODE_NATIVE_HOOKS_AVAILABLE__: '0',
      __ONEWORKS_PROJECT_REAL_HOME__: join(params.cwd, 'real-home'),
      ...params.env
    },
    cache: {
      get: async <K extends keyof Cache>(key: K) => cacheStore.get(key) as Cache[K] | undefined,
      set: async <K extends keyof Cache>(key: K, value: Cache[K]) => {
        cacheStore.set(key, value)
        return { cachePath: join(params.cwd, '.oo', 'caches', `${key}.json`) }
      }
    },
    logger: {
      stream: new PassThrough(),
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined
    },
    configs: [{ adapters: { 'qwen-code': {} } }, undefined]
  }
}

const createFakeBinary = async (cwd: string, name: string, source: string[]) => {
  const binaryPath = join(cwd, name)
  await writeFile(binaryPath, [`#!${process.execPath}`, ...source].join('\n'))
  await chmod(binaryPath, 0o755)
  return binaryPath
}

describe('createQwenCodeSession', () => {
  it('projects partial messages and tool events while caching the native session id', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oneworks-qwen-code-session-'))
    tempDirs.push(cwd)
    const binaryPath = join(cwd, 'fake-qwen.mjs')
    const argsPath = join(cwd, 'args.json')
    const stdinPath = join(cwd, 'stdin.txt')
    await writeFile(
      binaryPath,
      [
        `#!${process.execPath}`,
        `import { writeFile } from 'node:fs/promises'`,
        `let prompt = ''`,
        `for await (const chunk of process.stdin) prompt += chunk`,
        `await writeFile(${
          JSON.stringify(argsPath)
        }, JSON.stringify({ args: process.argv.slice(2), home: process.env.HOME, qwenHome: process.env.QWEN_HOME, runtimeDir: process.env.QWEN_RUNTIME_DIR }))`,
        `await writeFile(${JSON.stringify(stdinPath)}, prompt)`,
        `const sessionId = '11111111-2222-4333-8444-555555555555'`,
        `console.log(JSON.stringify({ type: 'system', subtype: 'init', uuid: sessionId, session_id: sessionId, cwd: process.cwd(), tools: ['read_file'], model: 'qwen-test', qwen_code_version: '0.21.11', slash_commands: [], agents: [] }))`,
        `console.log(JSON.stringify({ type: 'stream_event', session_id: sessionId, event: { type: 'message_start', message: { id: 'message-1', model: 'qwen-test' } } }))`,
        `console.log(JSON.stringify({ type: 'stream_event', session_id: sessionId, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'QWEN_' } } }))`,
        `console.log(JSON.stringify({ type: 'stream_event', session_id: sessionId, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } } }))`,
        `console.log(JSON.stringify({ type: 'assistant', session_id: sessionId, message: { id: 'message-1', model: 'qwen-test', content: [{ type: 'text', text: 'QWEN_OK' }, { type: 'tool_use', id: 'tool-1', name: 'read_file', input: { path: 'README.md' } }], usage: { input_tokens: 2, output_tokens: 3 } } }))`,
        `console.log(JSON.stringify({ type: 'user', session_id: sessionId, uuid: 'result-1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', is_error: false, content: 'read' }] } }))`,
        `console.log(JSON.stringify({ type: 'result', subtype: 'success', session_id: sessionId, is_error: false, result: 'QWEN_OK', usage: { input_tokens: 2, output_tokens: 3 } }))`
      ].join('\n')
    )
    await chmod(binaryPath, 0o755)

    const ctx = createCtx({ binaryPath, cwd })
    const events: AdapterOutputEvent[] = []
    const session = await createQwenCodeSession(ctx, {
      type: 'create',
      runtime: 'cli',
      mode: 'stream',
      sessionId: 'oneworks-session',
      model: 'qwen-test',
      permissionMode: 'plan',
      description: 'hello qwen',
      systemPrompt: 'Follow repository rules.',
      onEvent: event => events.push(event)
    })

    await waitFor(() => events.some(event => event.type === 'exit'))
    session.kill()

    expect(events).toContainEqual(expect.objectContaining({
      type: 'init',
      data: expect.objectContaining({
        adapter: 'qwen-code',
        uuid: '11111111-2222-4333-8444-555555555555',
        version: '0.21.11'
      })
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'message',
      data: expect.objectContaining({ id: 'message-1', content: 'QWEN_OK' })
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'message',
      data: expect.objectContaining({
        content: [expect.objectContaining({ name: 'adapter:qwen-code:ReadFile' })]
      })
    }))
    expect(events.at(-2)).toEqual(expect.objectContaining({ type: 'stop' }))
    expect(events.at(-1)).toEqual({ type: 'exit', data: { exitCode: 0 } })
    await expect(ctx.cache.get('adapter.qwen-code.session')).resolves.toEqual({
      qwenSessionId: '11111111-2222-4333-8444-555555555555'
    })
    const invocation = JSON.parse(await readFile(argsPath, 'utf8')) as Record<string, any>
    expect(invocation.args).toEqual(expect.arrayContaining([
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--approval-mode',
      'plan'
    ]))
    expect(invocation.home).toBe(invocation.qwenHome)
    expect(invocation.runtimeDir).not.toBe(invocation.qwenHome)
    expect(await readFile(stdinPath, 'utf8')).toBe('hello qwen')
  })

  it('uses the cached native id for a subsequent resume process', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oneworks-qwen-code-linked-resume-'))
    tempDirs.push(cwd)
    const binaryPath = join(cwd, 'fake-qwen-linked-resume.mjs')
    const invocationsPath = join(cwd, 'invocations.jsonl')
    const nativeSessionId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    await writeFile(
      binaryPath,
      [
        `#!${process.execPath}`,
        `import { appendFile } from 'node:fs/promises'`,
        `for await (const _chunk of process.stdin) {}`,
        `await appendFile(${JSON.stringify(invocationsPath)}, JSON.stringify(process.argv.slice(2)) + '\\n')`,
        `console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: '${nativeSessionId}', cwd: process.cwd(), qwen_code_version: '0.21.11' }))`,
        `console.log(JSON.stringify({ type: 'assistant', session_id: '${nativeSessionId}', message: { id: 'message-linked', content: [{ type: 'text', text: 'linked' }] } }))`,
        `console.log(JSON.stringify({ type: 'result', subtype: 'success', session_id: '${nativeSessionId}', is_error: false }))`
      ].join('\n')
    )
    await chmod(binaryPath, 0o755)
    const cacheStore = new Map<keyof Cache, Cache[keyof Cache]>()
    const firstEvents: AdapterOutputEvent[] = []
    const firstCtx = createCtx({ binaryPath, cacheStore, cwd })
    await createQwenCodeSession(firstCtx, {
      type: 'create',
      runtime: 'cli',
      mode: 'stream',
      sessionId: 'same-oneworks-session',
      description: 'turn one',
      onEvent: event => firstEvents.push(event)
    })
    await waitFor(() => firstEvents.some(event => event.type === 'exit'))
    await expect(firstCtx.cache.get('adapter.qwen-code.session')).resolves.toEqual({
      qwenSessionId: nativeSessionId
    })

    const secondEvents: AdapterOutputEvent[] = []
    const secondCtx = createCtx({ binaryPath, cacheStore, cwd })
    await createQwenCodeSession(secondCtx, {
      type: 'resume',
      runtime: 'cli',
      mode: 'stream',
      sessionId: 'same-oneworks-session',
      description: 'turn two',
      onEvent: event => secondEvents.push(event)
    })
    await waitFor(() => secondEvents.some(event => event.type === 'exit'))

    const invocations = (await readFile(invocationsPath, 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as string[])
    expect(invocations).toHaveLength(2)
    expect(invocations[0]).not.toContain('--resume')
    expect(invocations[1]).toEqual(expect.arrayContaining(['--resume', nativeSessionId]))
    await expect(secondCtx.cache.get('adapter.qwen-code.session')).resolves.toEqual({
      qwenSessionId: nativeSessionId
    })
  })

  it('uses a pre-existing native id for a resume process', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oneworks-qwen-code-resume-'))
    tempDirs.push(cwd)
    const binaryPath = join(cwd, 'fake-qwen-resume.mjs')
    const argsPath = join(cwd, 'resume-args.json')
    await writeFile(
      binaryPath,
      [
        `#!${process.execPath}`,
        `import { writeFile } from 'node:fs/promises'`,
        `for await (const _chunk of process.stdin) {}`,
        `await writeFile(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)))`,
        `console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'native-original', cwd: process.cwd(), qwen_code_version: '0.21.11' }))`,
        `console.log(JSON.stringify({ type: 'assistant', session_id: 'native-original', message: { id: 'message-2', content: [{ type: 'text', text: 'resumed' }] } }))`,
        `console.log(JSON.stringify({ type: 'result', subtype: 'success', session_id: 'native-original', is_error: false }))`
      ].join('\n')
    )
    await chmod(binaryPath, 0o755)
    const cacheStore = new Map<keyof Cache, Cache[keyof Cache]>()
    cacheStore.set('adapter.qwen-code.session', { qwenSessionId: 'native-original' })
    const events: AdapterOutputEvent[] = []
    await createQwenCodeSession(createCtx({ binaryPath, cacheStore, cwd }), {
      type: 'resume',
      runtime: 'cli',
      mode: 'stream',
      sessionId: 'oneworks-resume',
      description: 'continue',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(JSON.parse(await readFile(argsPath, 'utf8'))).toEqual(expect.arrayContaining([
      '--resume',
      'native-original'
    ]))
    expect(events.filter(event => event.type === 'error')).toHaveLength(0)
    expect(events.filter(event => event.type === 'exit')).toEqual([{ type: 'exit', data: { exitCode: 0 } }])
  })

  it.each([
    { cacheValue: undefined, label: 'missing', mode: 'stream' as const },
    { cacheValue: { qwenSessionId: '' }, label: 'empty', mode: 'stream' as const },
    { cacheValue: undefined, label: 'missing', mode: 'direct' as const },
    { cacheValue: { qwenSessionId: '   ' }, label: 'blank', mode: 'direct' as const }
  ])('fails before spawning for a $label resume cache in $mode mode', async ({ cacheValue, mode }) => {
    const cwd = await mkdtemp(join(tmpdir(), 'oneworks-qwen-code-missing-resume-'))
    tempDirs.push(cwd)
    const markerPath = join(cwd, 'spawned.txt')
    const binaryPath = await createFakeBinary(cwd, `fake-qwen-missing-resume-${mode}.mjs`, [
      `import { writeFile } from 'node:fs/promises'`,
      `await writeFile(${JSON.stringify(markerPath)}, 'spawned')`
    ])
    const cacheStore = new Map<keyof Cache, Cache[keyof Cache]>()
    if (cacheValue != null) {
      cacheStore.set('adapter.qwen-code.session', cacheValue as Cache['adapter.qwen-code.session'])
    }
    const ctx = createCtx({ binaryPath, cacheStore, cwd })

    await expect(createQwenCodeSession(ctx, {
      type: 'resume',
      runtime: 'cli',
      mode,
      sessionId: `oneworks-missing-resume-${mode}`,
      description: 'continue',
      onEvent: () => undefined
    })).rejects.toThrow('no valid cached native session id')
    await expect(readFile(markerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(ctx.cache.get('adapter.qwen-code.session')).resolves.toEqual(cacheValue)
  })

  it.each([
    {
      label: 'init',
      records: [
        { type: 'system', subtype: 'init', session_id: 'different-native' },
        { type: 'result', subtype: 'success', session_id: 'cached-native', is_error: false }
      ]
    },
    {
      label: 'late assistant',
      records: [
        { type: 'system', subtype: 'init', session_id: 'cached-native' },
        {
          type: 'assistant',
          session_id: 'different-native',
          message: { id: 'message-mismatch', content: [{ type: 'text', text: 'wrong session' }] }
        },
        { type: 'result', subtype: 'success', session_id: 'cached-native', is_error: false }
      ]
    },
    {
      label: 'result',
      records: [
        { type: 'system', subtype: 'init', session_id: 'cached-native' },
        { type: 'result', subtype: 'success', session_id: 'different-native', is_error: false }
      ]
    }
  ])('fails a resume when the $label event changes native identity', async ({ records }) => {
    const cwd = await mkdtemp(join(tmpdir(), 'oneworks-qwen-code-resume-mismatch-'))
    tempDirs.push(cwd)
    const binaryPath = await createFakeBinary(cwd, 'fake-qwen-resume-mismatch.mjs', [
      `for await (const _chunk of process.stdin) {}`,
      ...records.map(record => `console.log(${JSON.stringify(JSON.stringify(record))})`)
    ])
    const cacheStore = new Map<keyof Cache, Cache[keyof Cache]>()
    cacheStore.set('adapter.qwen-code.session', { qwenSessionId: 'cached-native' })
    const ctx = createCtx({ binaryPath, cacheStore, cwd })
    const events: AdapterOutputEvent[] = []
    await createQwenCodeSession(ctx, {
      type: 'resume',
      runtime: 'cli',
      mode: 'stream',
      sessionId: 'oneworks-resume-mismatch',
      description: 'continue',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'exit'))

    expect(events.filter(event => event.type === 'error')).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ message: expect.stringContaining('expected "cached-native"') })
      })
    ])
    expect(events.filter(event => event.type === 'exit')).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ exitCode: 1 }) })
    ])
    expect(events.some(event => event.type === 'stop')).toBe(false)
    await expect(ctx.cache.get('adapter.qwen-code.session')).resolves.toEqual({
      qwenSessionId: 'cached-native'
    })
  })

  it('keeps the cached identity when a resume emits duplicate matching ids', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oneworks-qwen-code-resume-stable-'))
    tempDirs.push(cwd)
    const binaryPath = await createFakeBinary(cwd, 'fake-qwen-resume-stable.mjs', [
      `for await (const _chunk of process.stdin) {}`,
      `console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'cached-native' }))`,
      `console.log(JSON.stringify({ type: 'result', subtype: 'success', session_id: 'cached-native', is_error: false }))`
    ])
    const cacheStore = new Map<keyof Cache, Cache[keyof Cache]>()
    cacheStore.set('adapter.qwen-code.session', { qwenSessionId: 'cached-native' })
    const ctx = createCtx({ binaryPath, cacheStore, cwd })
    const events: AdapterOutputEvent[] = []
    await createQwenCodeSession(ctx, {
      type: 'resume',
      runtime: 'cli',
      mode: 'stream',
      sessionId: 'oneworks-resume-stable',
      description: 'continue',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'exit'))

    expect(events.filter(event => event.type === 'error')).toHaveLength(0)
    expect(events.filter(event => event.type === 'exit')).toEqual([{ type: 'exit', data: { exitCode: 0 } }])
    await expect(ctx.cache.get('adapter.qwen-code.session')).resolves.toEqual({
      qwenSessionId: 'cached-native'
    })
  })

  it('fails a stream resume that never emits a native session id', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oneworks-qwen-code-resume-no-id-'))
    tempDirs.push(cwd)
    const binaryPath = await createFakeBinary(cwd, 'fake-qwen-resume-no-id.mjs', [
      `for await (const _chunk of process.stdin) {}`,
      `console.log(JSON.stringify({ type: 'system', subtype: 'init' }))`,
      `console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false }))`
    ])
    const cacheStore = new Map<keyof Cache, Cache[keyof Cache]>()
    cacheStore.set('adapter.qwen-code.session', { qwenSessionId: 'cached-native' })
    const ctx = createCtx({ binaryPath, cacheStore, cwd })
    const events: AdapterOutputEvent[] = []

    await createQwenCodeSession(ctx, {
      type: 'resume',
      runtime: 'cli',
      mode: 'stream',
      sessionId: 'oneworks-resume-no-id',
      description: 'continue',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'exit'))

    expect(events.filter(event => event.type === 'error')).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ code: 'qwen_code_resume_identity_missing' })
      })
    ])
    expect(events.filter(event => event.type === 'exit')).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ exitCode: 1 }) })
    ])
    expect(events.some(event => event.type === 'stop')).toBe(false)
    await expect(ctx.cache.get('adapter.qwen-code.session')).resolves.toEqual({
      qwenSessionId: 'cached-native'
    })
  })

  it('redacts routed credentials and isolated paths from result, stderr, and exit events', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oneworks-qwen-code-redaction-'))
    tempDirs.push(cwd)
    const secret = 'fixture-secret-value-12345'
    const proxyCredential = 'https://proxy-user:proxy-password@example.test:8443'
    const mcpEnvSecret = 'mcp-env-output-secret-12345'
    const mcpHeaderSecret = 'mcp-header-output-secret-12345'
    const mcpOpaqueHeaderSecret = 'mcp-opaque-header-output-secret-12345'
    const mcpShortHeaderSecret = 'a'
    const binaryPath = await createFakeBinary(cwd, 'fake-qwen-redaction.mjs', [
      `import { readFile } from 'node:fs/promises'`,
      `import { join } from 'node:path'`,
      `for await (const _chunk of process.stdin) {}`,
      `const secret = process.env.OPENAI_API_KEY`,
      `const settings = JSON.parse(await readFile(join(process.env.QWEN_HOME, 'settings.json'), 'utf8'))`,
      `const shortHeader = settings.mcpServers.http.headers['X-Opaque']`,
      `const leaked = [secret, encodeURIComponent(secret), new URLSearchParams({ value: secret }).toString(), Buffer.from(secret).toString('base64'), process.env.HTTPS_PROXY, settings.mcpServers.stdio.env.API_TOKEN, settings.mcpServers.http.headers.Authorization, settings.mcpServers.http.headers['Opaque-Vendor'], 'X-Opaque=' + shortHeader, 'X-Opaque: ' + shortHeader, JSON.stringify({ 'X-Opaque': shortHeader }), 'cwd=/tmp/a-project model=alpha-a-model Unrelated=a', process.env.AWS_SHARED_CREDENTIALS_FILE, process.env.MYSQL_PWD, process.env.PASSWORD_FILE, process.env.PGPASSWORD, 'GITHUB_TOKEN=github-output-canary', 'AWS_SECRET_ACCESS_KEY=aws-output-canary', 'AWS_SHARED_CREDENTIALS_FILE=/private/output-aws-credentials', 'MYSQL_PWD=mysql-output-canary', 'PASSWORD_FILE=/private/output-password-file', 'PGPASSWORD=pg-output-canary', 'Subscription-Key=subscription-output-canary', 'PRIVATE_KEY=private-output-canary', 'COOKIE=cookie-output-canary', 'password=hunter2', process.env.QWEN_HOME, process.env.QWEN_RUNTIME_DIR].join(' | ')`,
      `console.error('stderr ' + leaked)`,
      `console.log('malformed ' + leaked)`,
      `console.log(JSON.stringify({ type: 'result', subtype: 'error', session_id: secret, is_error: true, error: { message: 'result ' + leaked } }))`
    ])
    const cacheStore = new Map<keyof Cache, Cache[keyof Cache]>()
    const ctx = createCtx({
      binaryPath,
      cacheStore,
      cwd,
      env: {
        AWS_SECRET_ACCESS_KEY: 'must-not-reach-child-aws',
        AWS_SHARED_CREDENTIALS_FILE: '/private/must-not-reach-child-aws-credentials',
        COOKIE: 'must-not-reach-child-cookie',
        GITHUB_TOKEN: 'must-not-reach-child-github',
        HTTPS_PROXY: proxyCredential,
        MYSQL_PWD: 'must-not-reach-child-mysql',
        OPENAI_API_KEY: secret,
        PASSWORD_FILE: '/private/must-not-reach-child-password-file',
        PGPASSWORD: 'must-not-reach-child-pg',
        PRIVATE_KEY: 'must-not-reach-child-private'
      }
    })
    const loggerCalls: unknown[][] = []
    ctx.logger = {
      stream: new PassThrough(),
      info: (...args: unknown[]) => loggerCalls.push(args),
      warn: (...args: unknown[]) => loggerCalls.push(args),
      error: (...args: unknown[]) => loggerCalls.push(args),
      debug: (...args: unknown[]) => loggerCalls.push(args)
    }
    const events: AdapterOutputEvent[] = []
    await createQwenCodeSession(ctx, {
      type: 'create',
      runtime: 'cli',
      mode: 'stream',
      sessionId: 'oneworks-redaction',
      description: 'run',
      assetPlan: {
        adapter: 'qwen-code',
        diagnostics: [],
        mcpServers: {
          http: {
            type: 'http',
            url: 'https://mcp.example.com',
            headers: {
              Authorization: `Bearer ${mcpHeaderSecret}`,
              'Opaque-Vendor': mcpOpaqueHeaderSecret,
              'X-Opaque': mcpShortHeaderSecret
            }
          },
          stdio: {
            command: process.execPath,
            args: ['fixture-mcp.mjs'],
            env: { API_TOKEN: mcpEnvSecret }
          }
        },
        overlays: []
      },
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'exit'))
    const serialized = JSON.stringify(events)

    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain(encodeURIComponent(secret))
    expect(serialized).not.toContain(Buffer.from(secret).toString('base64'))
    expect(serialized).not.toContain(proxyCredential)
    expect(serialized).not.toContain(mcpEnvSecret)
    expect(serialized).not.toContain(mcpHeaderSecret)
    expect(serialized).not.toContain(mcpOpaqueHeaderSecret)
    expect(serialized).not.toContain('X-Opaque=a')
    expect(serialized).not.toContain('X-Opaque: a')
    expect(serialized).not.toContain('"X-Opaque":"a"')
    expect(serialized).toContain('cwd=/tmp/a-project model=alpha-a-model Unrelated=a')
    expect(serialized).not.toContain('github-output-canary')
    expect(serialized).not.toContain('aws-output-canary')
    expect(serialized).not.toContain('private-output-canary')
    expect(serialized).not.toContain('cookie-output-canary')
    expect(serialized).not.toContain('mysql-output-canary')
    expect(serialized).not.toContain('pg-output-canary')
    expect(serialized).not.toContain('subscription-output-canary')
    expect(serialized).not.toContain('/private/output-aws-credentials')
    expect(serialized).not.toContain('/private/output-password-file')
    expect(serialized).not.toContain('must-not-reach-child-mysql')
    expect(serialized).not.toContain('must-not-reach-child-pg')
    expect(serialized).not.toContain('/private/must-not-reach-child-aws-credentials')
    expect(serialized).not.toContain('/private/must-not-reach-child-password-file')
    expect(serialized).not.toContain('hunter2')
    expect(serialized).not.toContain(join(cwd, '.project-home', 'caches', 'adapter-qwen-code'))
    expect(serialized).toContain('[REDACTED]')
    expect(serialized).toContain('[QWEN_HOME]')
    expect(serialized).toContain('[QWEN_RUNTIME_DIR]')
    expect(loggerCalls).toHaveLength(1)
    expect(JSON.stringify(loggerCalls)).not.toContain(secret)
    expect(JSON.stringify(loggerCalls)).not.toContain(join(cwd, '.project-home', 'caches', 'adapter-qwen-code'))
    expect(JSON.stringify([...cacheStore.entries()])).not.toContain(secret)
    await expect(ctx.cache.get('adapter.qwen-code.session')).resolves.toBeUndefined()
  })

  it('captures the same native session identity from direct-mode history', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oneworks-qwen-code-direct-'))
    tempDirs.push(cwd)
    const nativeSessionId = 'dddddddd-1111-4222-8333-444444444444'
    const binaryPath = await createFakeBinary(cwd, 'fake-qwen-direct.mjs', [
      `import { mkdir, writeFile } from 'node:fs/promises'`,
      `import { join } from 'node:path'`,
      `const chatsDir = join(process.env.QWEN_RUNTIME_DIR, 'projects', '-fixture', 'chats')`,
      `await mkdir(chatsDir, { recursive: true })`,
      `await writeFile(join(chatsDir, '${nativeSessionId}.jsonl'), JSON.stringify({ sessionId: '${nativeSessionId}', cwd: process.cwd() }) + '\\n')`
    ])
    const ctx = createCtx({ binaryPath, cwd })
    const events: AdapterOutputEvent[] = []
    await createQwenCodeSession(ctx, {
      type: 'create',
      runtime: 'cli',
      mode: 'direct',
      sessionId: 'oneworks-direct',
      description: 'direct prompt',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(events.filter(event => event.type === 'exit')).toEqual([{ type: 'exit', data: { exitCode: 0 } }])
    await expect(ctx.cache.get('adapter.qwen-code.session')).resolves.toEqual({
      qwenSessionId: nativeSessionId
    })
  })

  it('settles a rejected direct cache commit once without an unhandled rejection or tentative state', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oneworks-qwen-code-direct-cache-failure-'))
    tempDirs.push(cwd)
    const nativeSessionId = 'cccccccc-1111-4222-8333-444444444444'
    const secret = 'direct-cache-settlement-secret-12345'
    const binaryPath = await createFakeBinary(cwd, 'fake-qwen-direct-cache-failure.mjs', [
      `import { mkdir, writeFile } from 'node:fs/promises'`,
      `import { join } from 'node:path'`,
      `const chatsDir = join(process.env.QWEN_RUNTIME_DIR, 'projects', '-fixture', 'chats')`,
      `await mkdir(chatsDir, { recursive: true })`,
      `await writeFile(join(chatsDir, '${nativeSessionId}.jsonl'), JSON.stringify({ sessionId: '${nativeSessionId}', cwd: process.cwd() }) + '\\n')`
    ])
    const cacheStore = new Map<keyof Cache, Cache[keyof Cache]>()
    const ctx = createCtx({ binaryPath, cacheStore, cwd, env: { OPENAI_API_KEY: secret } })
    const privateRuntimeDir = join(
      cwd,
      '.project-home',
      'caches',
      'adapter-qwen-code',
      'sessions',
      'oneworks-direct-cache-failure',
      'runtime'
    )
    ctx.cache.set = async () => {
      throw new Error(`apiKey=${secret} path=${privateRuntimeDir}`)
    }
    const loggerCalls: unknown[][] = []
    ctx.logger.error = (...args: unknown[]) => loggerCalls.push(args)
    const events: AdapterOutputEvent[] = []
    const unhandled: unknown[] = []
    const captureUnhandled = (error: unknown) => unhandled.push(error)
    process.on('unhandledRejection', captureUnhandled)
    try {
      await createQwenCodeSession(ctx, {
        type: 'create',
        runtime: 'cli',
        mode: 'direct',
        sessionId: 'oneworks-direct-cache-failure',
        description: 'direct prompt',
        onEvent: event => events.push(event)
      })
      await waitFor(() => events.some(event => event.type === 'exit'))
      await new Promise(resolve => setTimeout(resolve, 20))
    } finally {
      process.off('unhandledRejection', captureUnhandled)
    }

    const boundary = JSON.stringify({ events, loggerCalls, cache: [...cacheStore] })
    expect(unhandled).toHaveLength(0)
    expect(events.filter(event => event.type === 'error')).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ code: 'qwen_code_direct_settlement_failed' })
      })
    ])
    expect(events.filter(event => event.type === 'exit')).toEqual([
      { type: 'exit', data: expect.objectContaining({ exitCode: 1 }) }
    ])
    expect(boundary).not.toContain(secret)
    expect(boundary).not.toContain(privateRuntimeDir)
    expect(boundary).toContain('[QWEN_RUNTIME_DIR]')
    expect(cacheStore.has('adapter.qwen-code.session')).toBe(false)
  })

  it('settles a direct history-discovery rejection once and leaves the cache unchanged', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oneworks-qwen-code-direct-history-failure-'))
    tempDirs.push(cwd)
    const binaryPath = await createFakeBinary(cwd, 'fake-qwen-direct-history-failure.mjs', [
      `import { mkdir, writeFile } from 'node:fs/promises'`,
      `import { join } from 'node:path'`,
      `const chatsDir = join(process.env.QWEN_RUNTIME_DIR, 'projects', '-fixture', 'chats')`,
      `await mkdir(chatsDir, { recursive: true })`,
      `await writeFile(join(chatsDir, 'broken.jsonl'), '{"sessionId":')`
    ])
    const cacheStore = new Map<keyof Cache, Cache[keyof Cache]>()
    const ctx = createCtx({ binaryPath, cacheStore, cwd })
    const loggerCalls: unknown[][] = []
    ctx.logger.warn = () => {
      throw new Error('PASSWORD_FILE=/private/direct-history-password-file')
    }
    ctx.logger.error = (...args: unknown[]) => loggerCalls.push(args)
    const events: AdapterOutputEvent[] = []

    await createQwenCodeSession(ctx, {
      type: 'create',
      runtime: 'cli',
      mode: 'direct',
      sessionId: 'oneworks-direct-history-failure',
      description: 'direct prompt',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'exit'))

    const boundary = JSON.stringify({ events, loggerCalls })
    expect(events.filter(event => event.type === 'error')).toHaveLength(1)
    expect(events.filter(event => event.type === 'exit')).toEqual([
      { type: 'exit', data: expect.objectContaining({ exitCode: 1 }) }
    ])
    expect(boundary).not.toContain('/private/direct-history-password-file')
    expect(boundary).toContain('[REDACTED]')
    expect(cacheStore.has('adapter.qwen-code.session')).toBe(false)
  })

  it('requires a direct resume to corroborate the exact cached native identity', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oneworks-qwen-code-direct-resume-'))
    tempDirs.push(cwd)
    const nativeSessionId = 'eeeeeeee-1111-4222-8333-444444444444'
    const binaryPath = await createFakeBinary(cwd, 'fake-qwen-direct-resume.mjs', [
      `import { mkdir, writeFile } from 'node:fs/promises'`,
      `import { join } from 'node:path'`,
      `const chatsDir = join(process.env.QWEN_RUNTIME_DIR, 'projects', '-fixture', 'chats')`,
      `await mkdir(chatsDir, { recursive: true })`,
      `await writeFile(join(chatsDir, '${nativeSessionId}.jsonl'), JSON.stringify({ sessionId: '${nativeSessionId}', cwd: process.cwd() }) + '\\n')`
    ])
    const cacheStore = new Map<keyof Cache, Cache[keyof Cache]>()
    cacheStore.set('adapter.qwen-code.session', { qwenSessionId: nativeSessionId })
    const ctx = createCtx({ binaryPath, cacheStore, cwd })
    const events: AdapterOutputEvent[] = []

    await createQwenCodeSession(ctx, {
      type: 'resume',
      runtime: 'cli',
      mode: 'direct',
      sessionId: 'oneworks-direct-resume',
      description: 'continue',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'exit'))

    expect(events.filter(event => event.type === 'error')).toHaveLength(0)
    expect(events.filter(event => event.type === 'exit')).toEqual([{ type: 'exit', data: { exitCode: 0 } }])
    await expect(ctx.cache.get('adapter.qwen-code.session')).resolves.toEqual({ qwenSessionId: nativeSessionId })
  })

  it('fails a direct resume with no observed native identity and preserves its cache', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oneworks-qwen-code-direct-resume-no-id-'))
    tempDirs.push(cwd)
    const binaryPath = await createFakeBinary(cwd, 'fake-qwen-direct-resume-no-id.mjs', [
      `process.exit(0)`
    ])
    const cacheStore = new Map<keyof Cache, Cache[keyof Cache]>()
    cacheStore.set('adapter.qwen-code.session', { qwenSessionId: 'cached-direct-native' })
    const ctx = createCtx({ binaryPath, cacheStore, cwd })
    const events: AdapterOutputEvent[] = []

    await createQwenCodeSession(ctx, {
      type: 'resume',
      runtime: 'cli',
      mode: 'direct',
      sessionId: 'oneworks-direct-resume-no-id',
      description: 'continue',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'exit'))

    expect(events.filter(event => event.type === 'error')).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ code: 'qwen_code_resume_identity_missing' })
      })
    ])
    expect(events.filter(event => event.type === 'exit')).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ exitCode: 1 }) })
    ])
    await expect(ctx.cache.get('adapter.qwen-code.session')).resolves.toEqual({
      qwenSessionId: 'cached-direct-native'
    })
  })

  it('fails a direct resume identity mismatch once and preserves the cached identity', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oneworks-qwen-code-direct-resume-mismatch-'))
    tempDirs.push(cwd)
    const cachedSessionId = 'aaaaaaaa-1111-4222-8333-444444444444'
    const observedSessionId = 'bbbbbbbb-1111-4222-8333-444444444444'
    const binaryPath = await createFakeBinary(cwd, 'fake-qwen-direct-resume-mismatch.mjs', [
      `import { mkdir, writeFile } from 'node:fs/promises'`,
      `import { join } from 'node:path'`,
      `const chatsDir = join(process.env.QWEN_RUNTIME_DIR, 'projects', '-fixture', 'chats')`,
      `await mkdir(chatsDir, { recursive: true })`,
      `await writeFile(join(chatsDir, '${observedSessionId}.jsonl'), JSON.stringify({ sessionId: '${observedSessionId}', cwd: process.cwd() }) + '\\n')`
    ])
    const cacheStore = new Map<keyof Cache, Cache[keyof Cache]>()
    cacheStore.set('adapter.qwen-code.session', { qwenSessionId: cachedSessionId })
    const ctx = createCtx({ binaryPath, cacheStore, cwd })
    const events: AdapterOutputEvent[] = []

    await createQwenCodeSession(ctx, {
      type: 'resume',
      runtime: 'cli',
      mode: 'direct',
      sessionId: 'oneworks-direct-resume-mismatch',
      description: 'continue',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'exit'))

    expect(events.filter(event => event.type === 'error')).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ code: 'qwen_code_resume_identity_mismatch' })
      })
    ])
    expect(events.filter(event => event.type === 'exit')).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ exitCode: 1 }) })
    ])
    await expect(ctx.cache.get('adapter.qwen-code.session')).resolves.toEqual({
      qwenSessionId: cachedSessionId
    })
  })

  it('emits one direct-mode exit when stop, interrupt, and process close race', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oneworks-qwen-code-direct-stop-race-'))
    tempDirs.push(cwd)
    const binaryPath = await createFakeBinary(cwd, 'fake-qwen-direct-stop-race.mjs', [
      `setInterval(() => undefined, 1_000)`
    ])
    const ctx = createCtx({ binaryPath, cwd })
    const events: AdapterOutputEvent[] = []
    const session = await createQwenCodeSession(ctx, {
      type: 'create',
      runtime: 'cli',
      mode: 'direct',
      sessionId: 'oneworks-direct-stop-race',
      description: 'run',
      onEvent: event => events.push(event)
    })

    session.stop?.()
    session.emit({ type: 'interrupt' })
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(events.filter(event => event.type === 'error')).toHaveLength(0)
    expect(events.filter(event => event.type === 'exit')).toEqual([
      { type: 'exit', data: { exitCode: 0 } }
    ])
    await expect(ctx.cache.get('adapter.qwen-code.session')).resolves.toBeUndefined()
  })

  it('redacts private runtime paths and secrets from direct history-discovery diagnostics', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oneworks-qwen-code-direct-history-redaction-'))
    tempDirs.push(cwd)
    const secret = 'history-discovery-secret-12345'
    const binaryPath = await createFakeBinary(cwd, 'fake-qwen-direct-history-redaction.mjs', [
      `import { mkdir, writeFile } from 'node:fs/promises'`,
      `import { join } from 'node:path'`,
      `const chatsDir = join(process.env.QWEN_RUNTIME_DIR, 'projects', '-fixture', 'chats')`,
      `await mkdir(chatsDir, { recursive: true })`,
      `await writeFile(join(chatsDir, process.env.OPENAI_API_KEY + '.jsonl'), '{"apiKey":"' + process.env.OPENAI_API_KEY + '", invalid')`
    ])
    const ctx = createCtx({ binaryPath, cwd, env: { OPENAI_API_KEY: secret } })
    const warnings: unknown[][] = []
    ctx.logger.warn = (...args: unknown[]) => warnings.push(args)
    const events: AdapterOutputEvent[] = []

    await createQwenCodeSession(ctx, {
      type: 'create',
      runtime: 'cli',
      mode: 'direct',
      sessionId: 'oneworks-direct-history-redaction',
      description: 'run',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'exit'))

    const serialized = JSON.stringify(warnings)
    expect(warnings).toHaveLength(1)
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain(join(cwd, '.project-home', 'caches', 'adapter-qwen-code'))
    expect(serialized).toContain('[QWEN_RUNTIME_DIR]')
  })

  it('fails closed on truncated NDJSON instead of treating EOF as success', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oneworks-qwen-code-truncated-'))
    tempDirs.push(cwd)
    const binaryPath = await createFakeBinary(cwd, 'fake-qwen-truncated.mjs', [
      `for await (const _chunk of process.stdin) {}`,
      `console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'truncated-native' }))`,
      `process.stdout.write('{"type":"result","is_error":false')`
    ])
    const ctx = createCtx({ binaryPath, cwd })
    const events: AdapterOutputEvent[] = []
    await createQwenCodeSession(ctx, {
      type: 'create',
      runtime: 'cli',
      mode: 'stream',
      sessionId: 'oneworks-truncated',
      description: 'run',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(events.filter(event => event.type === 'error')).toHaveLength(1)
    expect(events.find(event => event.type === 'error')).toEqual(expect.objectContaining({
      data: expect.objectContaining({ message: 'Malformed Qwen Code stream-json output.' })
    }))
    expect(events.filter(event => event.type === 'exit')).toEqual([
      expect.objectContaining({ type: 'exit', data: expect.objectContaining({ exitCode: 1 }) })
    ])
    expect(events.some(event => event.type === 'stop')).toBe(false)
    await expect(ctx.cache.get('adapter.qwen-code.session')).resolves.toBeUndefined()
  })

  it('accepts a valid final NDJSON record without a trailing newline and ignores unknown events', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oneworks-qwen-code-eof-record-'))
    tempDirs.push(cwd)
    const binaryPath = await createFakeBinary(cwd, 'fake-qwen-eof-record.mjs', [
      `for await (const _chunk of process.stdin) {}`,
      `console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'eof-native' }))`,
      `console.log(JSON.stringify({ type: 'future_event', payload: { ignored: true } }))`,
      `console.log(JSON.stringify({ type: 'assistant', session_id: 'eof-native', message: { id: 'eof-message', content: [{ type: 'text', text: 'done' }] } }))`,
      `process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', session_id: 'eof-native', is_error: false }))`
    ])
    const ctx = createCtx({ binaryPath, cwd })
    const events: AdapterOutputEvent[] = []
    await createQwenCodeSession(ctx, {
      type: 'create',
      runtime: 'cli',
      mode: 'stream',
      sessionId: 'oneworks-eof-record',
      description: 'run',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(events.filter(event => event.type === 'error')).toHaveLength(0)
    expect(events.filter(event => event.type === 'stop')).toHaveLength(1)
    expect(events.filter(event => event.type === 'exit')).toEqual([{ type: 'exit', data: { exitCode: 0 } }])
    await expect(ctx.cache.get('adapter.qwen-code.session')).resolves.toEqual({
      qwenSessionId: 'eof-native'
    })
  })

  it('turns a result error with exit zero into one fatal terminal failure', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oneworks-qwen-code-result-error-'))
    tempDirs.push(cwd)
    const binaryPath = await createFakeBinary(cwd, 'fake-qwen-result-error.mjs', [
      `for await (const _chunk of process.stdin) {}`,
      `console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'result-error-native' }))`,
      `console.log(JSON.stringify({ type: 'result', subtype: 'error', session_id: 'result-error-native', is_error: true, error: { message: 'provider rejected request' } }))`
    ])
    const ctx = createCtx({ binaryPath, cwd })
    const events: AdapterOutputEvent[] = []
    await createQwenCodeSession(ctx, {
      type: 'create',
      runtime: 'cli',
      mode: 'stream',
      sessionId: 'oneworks-result-error',
      description: 'run',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(events.filter(event => event.type === 'error')).toHaveLength(1)
    expect(events.find(event => event.type === 'error')).toEqual(expect.objectContaining({
      data: expect.objectContaining({ message: 'provider rejected request' })
    }))
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
    expect(events.some(event => event.type === 'stop')).toBe(false)
    await expect(ctx.cache.get('adapter.qwen-code.session')).resolves.toBeUndefined()
  })

  it('deduplicates spawn and nonzero-exit terminal events', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oneworks-qwen-code-terminal-'))
    tempDirs.push(cwd)
    const spawnEvents: AdapterOutputEvent[] = []
    await createQwenCodeSession(createCtx({ binaryPath: join(cwd, 'missing-qwen'), cwd }), {
      type: 'create',
      runtime: 'cli',
      mode: 'stream',
      sessionId: 'oneworks-spawn-error',
      description: 'run',
      onEvent: event => spawnEvents.push(event)
    })
    await waitFor(() => spawnEvents.some(event => event.type === 'exit'))
    expect(spawnEvents.filter(event => event.type === 'error')).toHaveLength(1)
    expect(spawnEvents.filter(event => event.type === 'exit')).toHaveLength(1)

    const binaryPath = await createFakeBinary(cwd, 'fake-qwen-nonzero.mjs', [
      `for await (const _chunk of process.stdin) {}`,
      `console.error('deliberate nonzero exit')`,
      `process.exit(52)`
    ])
    const nonzeroEvents: AdapterOutputEvent[] = []
    await createQwenCodeSession(createCtx({ binaryPath, cwd }), {
      type: 'create',
      runtime: 'cli',
      mode: 'stream',
      sessionId: 'oneworks-nonzero',
      description: 'run',
      onEvent: event => nonzeroEvents.push(event)
    })
    await waitFor(() => nonzeroEvents.some(event => event.type === 'exit'))
    expect(nonzeroEvents.filter(event => event.type === 'error')).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ code: 'config' }) })
    ])
    expect(nonzeroEvents.filter(event => event.type === 'exit')).toHaveLength(1)
  })

  it('emits one cancelled terminal after interrupting an active process', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oneworks-qwen-code-cancel-'))
    tempDirs.push(cwd)
    const binaryPath = await createFakeBinary(cwd, 'fake-qwen-cancel.mjs', [
      `process.on('SIGINT', () => process.exit(130))`,
      `for await (const _chunk of process.stdin) {}`,
      `console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'cancel-native' }))`,
      `setInterval(() => undefined, 1000)`
    ])
    const ctx = createCtx({ binaryPath, cwd })
    const events: AdapterOutputEvent[] = []
    const session = await createQwenCodeSession(ctx, {
      type: 'create',
      runtime: 'cli',
      mode: 'stream',
      sessionId: 'oneworks-cancel',
      description: 'run',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'init'))
    session.emit({ type: 'interrupt' })
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(events.filter(event => event.type === 'error')).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ code: 'cancelled' }) })
    ])
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
    expect(events.some(event => event.type === 'stop')).toBe(false)
    await expect(ctx.cache.get('adapter.qwen-code.session')).resolves.toBeUndefined()
  })

  it('emits exactly one terminal exit when stop races an active interrupt and process close', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oneworks-qwen-code-stop-active-'))
    tempDirs.push(cwd)
    const binaryPath = await createFakeBinary(cwd, 'fake-qwen-stop-active.mjs', [
      `let stopping = false`,
      `process.on('SIGINT', () => {`,
      `  if (stopping) return`,
      `  stopping = true`,
      `  setTimeout(() => process.exit(130), 40)`,
      `})`,
      `for await (const _chunk of process.stdin) {}`,
      `console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'stop-active-native' }))`,
      `setInterval(() => undefined, 1000)`
    ])
    const ctx = createCtx({ binaryPath, cwd })
    const events: AdapterOutputEvent[] = []
    const session = await createQwenCodeSession(ctx, {
      type: 'create',
      runtime: 'cli',
      mode: 'stream',
      sessionId: 'oneworks-stop-active',
      description: 'run',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'init'))

    session.emit({ type: 'interrupt' })
    session.stop?.()
    session.emit({ type: 'stop' })
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(events.filter(event => event.type === 'exit')).toEqual([{ type: 'exit', data: { exitCode: 0 } }])
    expect(events.filter(event => event.type === 'error')).toHaveLength(0)
    expect(events.filter(event => event.type === 'stop')).toHaveLength(0)
    await expect(ctx.cache.get('adapter.qwen-code.session')).resolves.toBeUndefined()
  })

  it('preserves an invalid cached resume id and never starts a fresh session', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oneworks-qwen-code-invalid-resume-'))
    tempDirs.push(cwd)
    const invocationsPath = join(cwd, 'invalid-resume-invocations.jsonl')
    const binaryPath = await createFakeBinary(cwd, 'fake-qwen-invalid-resume.mjs', [
      `import { appendFile } from 'node:fs/promises'`,
      `for await (const _chunk of process.stdin) {}`,
      `await appendFile(${JSON.stringify(invocationsPath)}, JSON.stringify(process.argv.slice(2)) + '\\n')`,
      `console.error('Session cached-native-id not found')`,
      `process.exit(1)`
    ])
    const cacheStore = new Map<keyof Cache, Cache[keyof Cache]>()
    cacheStore.set('adapter.qwen-code.session', { qwenSessionId: 'cached-native-id' })
    const ctx = createCtx({ binaryPath, cacheStore, cwd })
    const events: AdapterOutputEvent[] = []
    await createQwenCodeSession(ctx, {
      type: 'resume',
      runtime: 'cli',
      mode: 'stream',
      sessionId: 'oneworks-invalid-resume',
      description: 'continue',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect((await readFile(invocationsPath, 'utf8')).trim().split('\n')).toHaveLength(1)
    expect(events.filter(event => event.type === 'error')).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ code: 'qwen_code_resume_invalid' }) })
    ])
    await expect(ctx.cache.get('adapter.qwen-code.session')).resolves.toEqual({
      qwenSessionId: 'cached-native-id'
    })
  })
})
