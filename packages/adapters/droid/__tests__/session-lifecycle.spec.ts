/* eslint-disable max-lines -- lifecycle, queue, and redaction assertions share one fake-peer fixture. */
import '../src/adapter-config'

import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import type { AdapterCtx, AdapterOutputEvent, Cache } from '@oneworks/types'

import { createDroidSession } from '../src/runtime/session'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const waitFor = async (predicate: () => boolean | Promise<boolean>, timeoutMs = 5_000) => {
  const startedAt = Date.now()
  while (!(await predicate())) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('Timed out waiting for Factory Droid events')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

const installFake = async (root: string) => {
  const templatePath = fileURLToPath(new URL('../__fixtures__/fake-droid.mjs', import.meta.url))
  const binaryPath = join(root, 'fake-droid.mjs')
  const source = (await readFile(templatePath, 'utf8'))
    .replace('#!NODE_EXECUTABLE_PLACEHOLDER', `#!${process.execPath}`)
  await writeFile(binaryPath, source)
  await chmod(binaryPath, 0o755)
  return binaryPath
}

const createCtx = (params: {
  binaryPath: string
  askUserOnMessage?: boolean
  cache: Map<keyof Cache, Cache[keyof Cache]>
  echoAuthStderr?: boolean
  closeError?: boolean
  failLoad?: boolean
  interruptError?: boolean
  malformedOnMessage?: boolean
  mismatchLoad?: boolean
  permissionOnMessage?: boolean
  queueTurns?: number
  rpcErrorOnMessage?: boolean
  failMessageNumber?: number
  secretTitle?: boolean
  logs?: unknown[]
  logPath: string
  root: string
}): AdapterCtx => ({
  ctxId: 'ctx-droid-lifecycle',
  cwd: params.root,
  env: {
    __ONEWORKS_PROJECT_ADAPTER_DROID_CLI_PATH__: params.binaryPath,
    __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: join(params.root, 'project-home'),
    __ONEWORKS_PROJECT_REAL_HOME__: join(params.root, 'real-home'),
    FACTORY_API_KEY: 'factory-exact-api-secret-123456',
    FACTORY_TOKEN: 'factory-exact-token-secret-654321',
    FACTORY_REFRESH_TOKEN: 'must-not-cross-boundary',
    FAKE_DROID_LOG: params.logPath,
    ...(params.askUserOnMessage === true ? { FAKE_DROID_ASK_USER_ON_MESSAGE: '1' } : {}),
    ...(params.closeError === true ? { FAKE_DROID_CLOSE_ERROR: '1' } : {}),
    ...(params.echoAuthStderr === true ? { FAKE_DROID_ECHO_AUTH_STDERR: '1' } : {}),
    ...(params.failLoad === true ? { FAKE_DROID_FAIL_LOAD: '1' } : {}),
    ...(params.interruptError === true ? { FAKE_DROID_INTERRUPT_ERROR: '1' } : {}),
    ...(params.mismatchLoad === true ? { FAKE_DROID_MISMATCH_LOAD: '1' } : {}),
    ...(params.permissionOnMessage === true ? { FAKE_DROID_PERMISSION_ON_MESSAGE: '1' } : {}),
    ...(params.queueTurns == null ? {} : { FAKE_DROID_QUEUE_TURNS: String(params.queueTurns) }),
    ...(params.failMessageNumber == null
      ? {}
      : { FAKE_DROID_FAIL_MESSAGE_NUMBER: String(params.failMessageNumber) }),
    ...(params.malformedOnMessage === true ? { FAKE_DROID_MALFORMED_ON_MESSAGE: '1' } : {}),
    ...(params.rpcErrorOnMessage === true ? { FAKE_DROID_RPC_ERROR_ON_MESSAGE: '1' } : {}),
    ...(params.secretTitle === true ? { FAKE_DROID_SECRET_TITLE: '1' } : {})
  },
  cache: {
    get: async key => params.cache.get(key) as never,
    set: async (key, value) => {
      params.cache.set(key, value)
      return { cachePath: join(params.root, 'cache.json') }
    }
  },
  logger: {
    stream: new PassThrough(),
    info: () => undefined,
    warn: (...args: unknown[]) => {
      params.logs?.push(args)
    },
    error: () => undefined,
    debug: () => undefined
  },
  configs: [{ adapters: { droid: {} } }, undefined]
})

describe('factory Droid fake CLI lifecycle', () => {
  it('completes an official-shaped multi-select request with one SDK-valid opaque answer string', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-droid-ask-user-'))
    tempDirs.push(root)
    const binaryPath = await installFake(root)
    const logPath = join(root, 'requests.jsonl')
    const events: AdapterOutputEvent[] = []
    const session = await createDroidSession(
      createCtx({
        askUserOnMessage: true,
        binaryPath,
        cache: new Map(),
        logPath,
        root
      }),
      {
        type: 'create',
        runtime: 'cli',
        sessionId: 'oneworks-session-ask-user',
        model: 'default',
        permissionMode: 'default',
        assetPlan: { adapter: 'droid', diagnostics: [], mcpServers: {}, overlays: [] },
        onEvent: event => events.push(event)
      }
    )
    session.emit({ type: 'message', content: [{ type: 'text', text: 'ask me' }] })
    await waitFor(() => events.some(event => event.type === 'interaction_request'))
    const interaction = events.find(event => event.type === 'interaction_request')
    if (interaction?.type !== 'interaction_request') throw new Error('missing ask_user interaction')
    await session.respondInteraction?.(
      interaction.data.id,
      ['history', 'custom target', 'runtime']
    )
    await waitFor(() => events.some(event => event.type === 'stop'))
    await session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))

    const requests = (await readFile(logPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    const response = requests.find(request => request.type === 'response' && request.id === 'fake-ask-user-1')
    expect(response?.result).toEqual({
      answers: [{ index: 1, question: 'Which targets?', answer: 'runtime, history, custom target' }]
    })
    expect(events.filter(event => event.type === 'stop')).toHaveLength(1)
    expect(events.filter(event => event.type === 'error')).toHaveLength(0)
  })

  it('creates, streams without duplicate terminal events, caches native id, and resumes in a new child', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-droid-lifecycle-'))
    tempDirs.push(root)
    const binaryPath = await installFake(root)
    const logPath = join(root, 'requests.jsonl')
    const cache = new Map<keyof Cache, Cache[keyof Cache]>()
    const ctx = createCtx({ binaryPath, cache, echoAuthStderr: true, logPath, root })
    await mkdir(join(root, '.factory'), { recursive: true })
    await writeFile(join(root, '.factory', 'mcp.json'), '{"untrusted":true}\n')
    const firstEvents: AdapterOutputEvent[] = []
    const first = await createDroidSession(ctx, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'oneworks-session-1',
      model: 'default',
      permissionMode: 'default',
      assetPlan: { adapter: 'droid', diagnostics: [], mcpServers: {}, overlays: [] },
      onEvent: event => firstEvents.push(event)
    })
    first.emit({ type: 'message', content: [{ type: 'text', text: 'first turn' }] })
    await waitFor(() => firstEvents.some(event => event.type === 'stop'))
    first.emit({ type: 'interrupt' })
    await waitFor(async () => (await readFile(logPath, 'utf8')).includes('droid.interrupt_session'))
    await first.stop?.()
    await waitFor(() => firstEvents.some(event => event.type === 'exit'))

    expect(firstEvents.filter(event => event.type === 'stop')).toHaveLength(1)
    expect(firstEvents.filter(event => event.type === 'exit')).toHaveLength(1)
    expect(firstEvents.filter(event => event.type === 'error')).toHaveLength(0)
    expect(JSON.stringify(firstEvents)).not.toContain('factory-exact-api-secret-123456')
    expect(JSON.stringify(firstEvents)).toContain('[REDACTED]')
    expect(firstEvents.filter(event => event.type === 'message' && event.data.id.includes(':text:'))).toHaveLength(1)
    expect(cache.get('adapter.droid.session')).toEqual(expect.objectContaining({
      droidSessionId: 'factory-native-session-1'
    }))

    const secondEvents: AdapterOutputEvent[] = []
    const second = await createDroidSession(ctx, {
      type: 'resume',
      runtime: 'cli',
      sessionId: 'oneworks-session-1',
      model: 'default',
      permissionMode: 'default',
      assetPlan: { adapter: 'droid', diagnostics: [], mcpServers: {}, overlays: [] },
      onEvent: event => secondEvents.push(event)
    })
    second.emit({ type: 'message', content: [{ type: 'text', text: 'resumed turn' }] })
    await waitFor(() => secondEvents.some(event => event.type === 'stop'))
    await second.stop?.()
    await waitFor(() => secondEvents.some(event => event.type === 'exit'))

    expect(secondEvents.filter(event => event.type === 'stop')).toHaveLength(1)
    expect(secondEvents.filter(event => (
      event.type === 'message' && Array.isArray(event.data.content) &&
      event.data.content.some(item => item.type === 'text' && item.text === 'TURN_1_OK')
    ))).toHaveLength(1)
    expect(secondEvents).toContainEqual(expect.objectContaining({
      type: 'init',
      data: expect.objectContaining({ title: 'Fake Droid resumed' })
    }))
    const requests = (await readFile(logPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(requests.map(request => request.method)).toEqual([
      'droid.initialize_session',
      'droid.add_user_message',
      'droid.interrupt_session',
      'droid.close_session',
      'droid.load_session',
      'droid.add_user_message',
      'droid.close_session'
    ])
    expect(requests.find(request => request.method === 'droid.load_session')?.params.sessionId)
      .toBe('factory-native-session-1')
    expect(requests.every(request => request.factoryProtocolVersion === '1.151.0')).toBe(true)
    expect(requests.every(request => request.processCwd !== root)).toBe(true)
    expect(JSON.stringify(requests)).not.toContain('factory-exact-api-secret-123456')
    expect(JSON.stringify(requests)).not.toContain('factory-exact-token-secret-654321')
    expect(JSON.stringify(requests)).not.toContain('must-not-cross-boundary')
    expect(dirname(requests[0].params.cwd)).not.toContain('.factory')
    await expect(stat(join(root, 'real-home', '.factory'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('settles consecutive queued messages exactly once across create and resume children', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-droid-queued-turns-'))
    tempDirs.push(root)
    const binaryPath = await installFake(root)
    const logPath = join(root, 'requests.jsonl')
    const cache = new Map<keyof Cache, Cache[keyof Cache]>()
    const ctx = createCtx({ binaryPath, cache, logPath, queueTurns: 3, root })

    const run = async (type: 'create' | 'resume') => {
      const events: AdapterOutputEvent[] = []
      const session = await createDroidSession(ctx, {
        type,
        runtime: 'cli',
        sessionId: 'oneworks-session-queued',
        model: 'default',
        permissionMode: 'default',
        assetPlan: { adapter: 'droid', diagnostics: [], mcpServers: {}, overlays: [] },
        onEvent: event => events.push(event)
      })
      for (const text of ['one', 'two', 'three']) {
        session.emit({ type: 'message', content: [{ type: 'text', text }] })
      }
      await waitFor(() => events.filter(event => event.type === 'stop').length === 3)
      await session.stop?.()
      await waitFor(() => events.some(event => event.type === 'exit'))
      expect(events.filter(event => event.type === 'stop')).toHaveLength(3)
      return events
    }

    await run('create')
    await run('resume')
    const requests = (await readFile(logPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(requests.filter(request => request.method === 'droid.add_user_message')).toHaveLength(6)
    expect(requests.filter(request => request.method === 'droid.load_session')).toEqual([
      expect.objectContaining({ params: expect.objectContaining({ sessionId: 'factory-native-session-1' }) })
    ])
  })

  it('drains accepted queued turns on interrupt and fatal failure without inventing a terminal for a rejected turn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-droid-queued-drain-'))
    tempDirs.push(root)
    const binaryPath = await installFake(root)
    const cache = new Map<keyof Cache, Cache[keyof Cache]>()
    const interruptEvents: AdapterOutputEvent[] = []
    const interrupted = await createDroidSession(
      createCtx({
        binaryPath,
        cache,
        logPath: join(root, 'interrupt.jsonl'),
        queueTurns: 3,
        root
      }),
      {
        type: 'create',
        runtime: 'cli',
        sessionId: 'queued-interrupt',
        model: 'default',
        permissionMode: 'default',
        assetPlan: { adapter: 'droid', diagnostics: [], mcpServers: {}, overlays: [] },
        onEvent: event => interruptEvents.push(event)
      }
    )
    interrupted.emit({ type: 'message', content: [{ type: 'text', text: 'one' }] })
    interrupted.emit({ type: 'message', content: [{ type: 'text', text: 'two' }] })
    await waitFor(async () =>
      (await readFile(join(root, 'interrupt.jsonl'), 'utf8'))
        .split('\n').filter(line => line.includes('droid.add_user_message')).length === 2
    )
    interrupted.emit({ type: 'interrupt' })
    await waitFor(() => interruptEvents.filter(event => event.type === 'stop').length === 2)
    await interrupted.stop?.()

    const fatalEvents: AdapterOutputEvent[] = []
    const failed = await createDroidSession(
      createCtx({
        binaryPath,
        cache: new Map(),
        failMessageNumber: 3,
        logPath: join(root, 'fatal.jsonl'),
        queueTurns: 4,
        root
      }),
      {
        type: 'create',
        runtime: 'cli',
        sessionId: 'queued-fatal',
        model: 'default',
        permissionMode: 'default',
        assetPlan: { adapter: 'droid', diagnostics: [], mcpServers: {}, overlays: [] },
        onEvent: event => fatalEvents.push(event)
      }
    )
    for (const text of ['one', 'two', 'three']) {
      failed.emit({ type: 'message', content: [{ type: 'text', text }] })
    }
    await waitFor(() => fatalEvents.some(event => event.type === 'exit'))
    expect(fatalEvents.filter(event => event.type === 'stop')).toHaveLength(2)
    expect(fatalEvents.filter(event => event.type === 'error' && event.data.fatal)).toHaveLength(1)
  })

  it('fails a missing native load without silently creating a replacement session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-droid-load-failure-'))
    tempDirs.push(root)
    const binaryPath = await installFake(root)
    const logPath = join(root, 'requests.jsonl')
    const cache = new Map<keyof Cache, Cache[keyof Cache]>([[
      'adapter.droid.session',
      { droidSessionId: 'missing-native-session' }
    ]])
    const ctx = createCtx({ binaryPath, cache, failLoad: true, logPath, root })

    await expect(createDroidSession(ctx, {
      type: 'resume',
      runtime: 'cli',
      sessionId: 'oneworks-session-missing',
      model: 'default',
      permissionMode: 'default',
      assetPlan: { adapter: 'droid', diagnostics: [], mcpServers: {}, overlays: [] },
      onEvent: () => undefined
    })).rejects.toThrow('native session not found')

    const requests = (await readFile(logPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(requests.map(request => request.method)).toEqual(['droid.load_session'])
  })

  it('rejects a load response associated with a different native session id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-droid-load-mismatch-'))
    tempDirs.push(root)
    const binaryPath = await installFake(root)
    const logPath = join(root, 'requests.jsonl')
    const cache = new Map<keyof Cache, Cache[keyof Cache]>()
    const createCtxValue = createCtx({ binaryPath, cache, logPath, root })
    const first = await createDroidSession(createCtxValue, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'oneworks-session-mismatch',
      model: 'default',
      permissionMode: 'default',
      assetPlan: { adapter: 'droid', diagnostics: [], mcpServers: {}, overlays: [] },
      onEvent: () => undefined
    })
    await first.stop?.()

    await expect(createDroidSession(
      createCtx({
        binaryPath,
        cache,
        logPath,
        mismatchLoad: true,
        root
      }),
      {
        type: 'resume',
        runtime: 'cli',
        sessionId: 'oneworks-session-mismatch',
        model: 'default',
        permissionMode: 'default',
        assetPlan: { adapter: 'droid', diagnostics: [], mcpServers: {}, overlays: [] },
        onEvent: () => undefined
      }
    )).rejects.toThrow('different-native-session, expected factory-native-session-1')

    const requests = (await readFile(logPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(requests.map(request => request.method)).toEqual([
      'droid.initialize_session',
      'droid.close_session',
      'droid.load_session'
    ])
  })

  it('interrupts a pending message and permission with one correlated denial and no fatal duplicate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-droid-interrupt-pending-'))
    tempDirs.push(root)
    const binaryPath = await installFake(root)
    const logPath = join(root, 'requests.jsonl')
    const cache = new Map<keyof Cache, Cache[keyof Cache]>()
    const events: AdapterOutputEvent[] = []
    const session = await createDroidSession(
      createCtx({
        binaryPath,
        cache,
        logPath,
        permissionOnMessage: true,
        root
      }),
      {
        type: 'create',
        runtime: 'cli',
        sessionId: 'oneworks-session-pending',
        model: 'default',
        permissionMode: 'default',
        assetPlan: { adapter: 'droid', diagnostics: [], mcpServers: {}, overlays: [] },
        onEvent: event => events.push(event)
      }
    )
    session.emit({ type: 'message', content: [{ type: 'text', text: 'needs permission' }] })
    await waitFor(() => events.some(event => event.type === 'interaction_request'))
    session.emit({ type: 'interrupt' })
    await waitFor(async () => {
      const log = await readFile(logPath, 'utf8')
      return log.includes('droid.interrupt_session') && log.includes('fake-permission-1')
    })
    await session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))

    const requests = (await readFile(logPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    const permissionResponses = requests.filter(request =>
      request.type === 'response' && request.id === 'fake-permission-1'
    )
    expect(permissionResponses).toEqual([expect.objectContaining({ result: { selectedOption: 'cancel' } })])
    expect(requests.filter(request => request.method === 'droid.interrupt_session')).toHaveLength(1)
    expect(events.filter(event => event.type === 'error')).toHaveLength(0)
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
  })

  it('terminates after a fatal outbound RPC error and redacts peer message/data before events', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-droid-rpc-fatal-'))
    tempDirs.push(root)
    const binaryPath = await installFake(root)
    const logPath = join(root, 'requests.jsonl')
    const events: AdapterOutputEvent[] = []
    const session = await createDroidSession(
      createCtx({
        binaryPath,
        cache: new Map(),
        logPath,
        root,
        rpcErrorOnMessage: true
      }),
      {
        type: 'create',
        runtime: 'cli',
        sessionId: 'oneworks-session-rpc-fatal',
        model: 'default',
        permissionMode: 'default',
        assetPlan: { adapter: 'droid', diagnostics: [], mcpServers: {}, overlays: [] },
        onEvent: event => events.push(event)
      }
    )
    session.emit({ type: 'message', content: [{ type: 'text', text: 'fail safely' }] })
    await waitFor(() => events.some(event => event.type === 'exit'))

    const serialized = JSON.stringify(events)
    expect(events.filter(event => event.type === 'error' && event.data.fatal)).toHaveLength(1)
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
    expect(serialized).toContain('PEER_RPC_USEFUL')
    expect(serialized).toContain('[REDACTED]')
    expect(serialized).not.toContain('factory-exact-api-secret-123456')
    expect(serialized).not.toContain('factory_live_credentialshaped123456789')
    const requests = (await readFile(logPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(requests.map(request => request.method)).toEqual([
      'droid.initialize_session',
      'droid.add_user_message'
    ])
  })

  it('redacts malformed-frame diagnostics and settles fatal/exit once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-droid-malformed-fatal-'))
    tempDirs.push(root)
    const binaryPath = await installFake(root)
    const events: AdapterOutputEvent[] = []
    const session = await createDroidSession(
      createCtx({
        binaryPath,
        cache: new Map(),
        logPath: join(root, 'requests.jsonl'),
        malformedOnMessage: true,
        root
      }),
      {
        type: 'create',
        runtime: 'cli',
        sessionId: 'oneworks-session-malformed-fatal',
        model: 'default',
        permissionMode: 'default',
        assetPlan: { adapter: 'droid', diagnostics: [], mcpServers: {}, overlays: [] },
        onEvent: event => events.push(event)
      }
    )
    session.emit({ type: 'message', content: [{ type: 'text', text: 'malformed safely' }] })
    await waitFor(() => events.some(event => event.type === 'exit'))

    const serialized = JSON.stringify(events)
    expect(events.filter(event => event.type === 'error' && event.data.fatal)).toHaveLength(1)
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
    expect(serialized).toContain('MALFORMED_USEFUL')
    expect(serialized).toContain('[REDACTED]')
    expect(serialized).not.toContain('factory-exact-token-secret-654321')
    expect(serialized).not.toContain('factory_live_credentialshaped123456789')
  })

  it('terminates after an interrupt RPC failure and emits one redacted fatal/exit pair', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-droid-interrupt-fatal-'))
    tempDirs.push(root)
    const binaryPath = await installFake(root)
    const events: AdapterOutputEvent[] = []
    const session = await createDroidSession(
      createCtx({
        binaryPath,
        cache: new Map(),
        interruptError: true,
        logPath: join(root, 'requests.jsonl'),
        root
      }),
      {
        type: 'create',
        runtime: 'cli',
        sessionId: 'oneworks-session-interrupt-fatal',
        model: 'default',
        permissionMode: 'default',
        assetPlan: { adapter: 'droid', diagnostics: [], mcpServers: {}, overlays: [] },
        onEvent: event => events.push(event)
      }
    )
    session.emit({ type: 'interrupt' })
    await waitFor(() => events.some(event => event.type === 'exit'))

    const serialized = JSON.stringify(events)
    expect(events.filter(event => event.type === 'error' && event.data.fatal)).toHaveLength(1)
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
    expect(serialized).toContain('INTERRUPT_USEFUL')
    expect(serialized).toContain('[REDACTED]')
    expect(serialized).not.toContain('factory-exact-token-secret-654321')
    expect(serialized).not.toContain('factory_live_credentialshaped123456789')
  })

  it('redacts close RPC reason and stderr at runtime event and logger boundaries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-droid-close-redaction-'))
    tempDirs.push(root)
    const binaryPath = await installFake(root)
    const events: AdapterOutputEvent[] = []
    const logs: unknown[] = []
    const cache = new Map<keyof Cache, Cache[keyof Cache]>()
    const session = await createDroidSession(
      createCtx({
        binaryPath,
        cache,
        closeError: true,
        logPath: join(root, 'requests.jsonl'),
        logs,
        root,
        secretTitle: true
      }),
      {
        type: 'create',
        runtime: 'cli',
        sessionId: 'oneworks-session-close-redaction',
        model: 'default',
        permissionMode: 'default',
        assetPlan: { adapter: 'droid', diagnostics: [], mcpServers: {}, overlays: [] },
        onEvent: event => events.push(event)
      }
    )
    await session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))

    const serialized = JSON.stringify({ events, logs, snapshot: [...cache.entries()] })
    expect(serialized).toContain('CLOSE_REASON_USEFUL')
    expect(serialized).toContain('CLOSE_STDERR_USEFUL')
    expect(serialized).toContain('SNAPSHOT_USEFUL')
    expect(serialized).toContain('[REDACTED]')
    expect(serialized).not.toContain('factory-exact-api-secret-123456')
    expect(serialized).not.toContain('factory-exact-token-secret-654321')
    expect(serialized).not.toContain('factory_live_credentialshaped123456789')
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
  })
})
