/* eslint-disable max-lines -- ACP lifecycle and real child-process environment coverage share one harness. */
import { Buffer } from 'node:buffer'
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { AdapterCtx, AdapterEvent, AdapterOutputEvent, AdapterQueryOptions } from '@oneworks/types'

import '../src/adapter-config'
import { createGooseSession } from '../src/runtime/session'

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-goose-acp.mjs')
const mcpEnvFixturePath = resolve(dirname(fixturePath), 'fake-goose-mcp-env.mjs')
const LEGACY_CLI_LOADER_ENV = ['__IS_', 'LOADER_CLI__'].join('')
const LEGACY_HOOK_LOADER_ENV = ['__IS_', 'ONEWORKS_HOOK_LOADER__'].join('')
const temporaryRoots: string[] = []

const waitForEvent = async (
  events: AdapterOutputEvent[],
  predicate: (event: AdapterOutputEvent) => boolean,
  timeoutMs = 5_000
) => {
  const startedAt = Date.now()
  while (!events.some(predicate)) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for Goose adapter event: ${JSON.stringify(events)}`)
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 10))
  }
}

const readLog = async (path: string) => (
  (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(line =>
    JSON.parse(line) as {
      id?: number
      mcpChild?: boolean
      method?: string
      nodeRuntimeEnv?: Record<string, string>
      params?: Record<string, unknown>
      result?: unknown
      signal?: NodeJS.Signals | null
      startup?: boolean
      status?: number
    }
  )
)

const createHarness = async (params: {
  assetPlan?: AdapterQueryOptions['assetPlan']
  cache?: Map<string, unknown>
  env?: Record<string, string>
  type?: 'create' | 'resume'
  description?: string
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions' | 'dontAsk'
  binaryPath?: string
  timeouts?: {
    closeTimeoutMs?: number
    killTimeoutMs?: number
    requestTimeoutMs?: number
  }
} = {}) => {
  const root = await mkdtemp(resolve(tmpdir(), 'oneworks-goose-session-'))
  temporaryRoots.push(root)
  const logPath = resolve(root, 'acp.jsonl')
  const events: AdapterOutputEvent[] = []
  const logs: unknown[] = []
  const cache = params.cache ?? new Map<string, unknown>()
  const ctx = {
    ctxId: 'ctx-goose',
    cwd: process.cwd(),
    env: {
      __ONEWORKS_PROJECT_ADAPTER_GOOSE_CLI_PATH__: params.binaryPath ?? fixturePath,
      __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: resolve(root, '.project-home'),
      GOOSE_FAKE_LOG_FILE: logPath,
      GOOSE_MODEL: 'fixture-model',
      GOOSE_PROVIDER: 'ollama',
      ...params.env
    },
    cache: {
      get: async key => cache.get(key) as never,
      set: async (key, value) => {
        cache.set(key, value)
        return { cachePath: '' }
      }
    },
    configs: [],
    logger: {
      debug: (...args: unknown[]) => logs.push(args),
      error: (...args: unknown[]) => logs.push(args),
      info: (...args: unknown[]) => logs.push(args),
      warn: (...args: unknown[]) => logs.push(args),
      stream: process.stderr
    }
  } satisfies AdapterCtx
  const options = {
    type: params.type ?? 'create',
    runtime: 'server' as const,
    sessionId: 'oneworks-session',
    description: params.description,
    assetPlan: params.assetPlan,
    permissionMode: params.permissionMode,
    systemPrompt: 'Follow One Works instructions.',
    onEvent: (event: AdapterOutputEvent) => events.push(event)
  }
  return { cache, ctx, events, logPath, logs, options, timeouts: params.timeouts }
}

describe('goose ACP session lifecycle', () => {
  beforeAll(async () => chmod(fixturePath, 0o755))

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
  })

  it('streams text and tool events, handles permission, caches native id, and exits cleanly', async () => {
    const harness = await createHarness({ description: 'Run fixture.' })
    const session = await createGooseSession(harness.ctx, harness.options)

    await waitForEvent(harness.events, event => event.type === 'interaction_request')
    const interaction = harness.events.find(event => event.type === 'interaction_request')
    expect(interaction?.type).toBe('interaction_request')
    if (interaction?.type === 'interaction_request') {
      expect(interaction.data.payload.options).toEqual(expect.arrayContaining([
        expect.objectContaining({ value: 'allow_once' }),
        expect.objectContaining({ value: 'deny_once' })
      ]))
      expect(interaction.data.payload.options).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ value: 'allow-once' })
      ]))
      expect(interaction.data.payload.question).not.toContain('package.json')
      session.respondInteraction?.(interaction.data.id, 'allow_once')
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 50))
    const permissionLog = await readLog(harness.logPath)
    expect(permissionLog.find(entry => entry.id === 900)?.result).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' }
    })
    await waitForEvent(harness.events, event => event.type === 'stop')

    expect(harness.cache.get('adapter.goose.session')).toEqual({ gooseSessionId: 'fake-goose-session' })
    expect(harness.events.some(event => event.type === 'init' && event.data.version === '1.46.0')).toBe(true)
    expect(
      harness.events.some(event =>
        event.type === 'message' && event.data.id === 'assistant-1' && event.data.content === 'Hello world'
      )
    ).toBe(true)
    expect(harness.events.some(event =>
      event.type === 'message' && Array.isArray(event.data.content) &&
      event.data.content.some(item => item.type === 'tool_use' && item.id === 'tool-1')
    )).toBe(true)
    expect(harness.events.some(event =>
      event.type === 'message' && Array.isArray(event.data.content) &&
      event.data.content.some(item => item.type === 'tool_result' && item.tool_use_id === 'tool-1')
    )).toBe(true)
    expect(harness.events.some(event => event.type === 'usage' && event.data.inputTokens === 4)).toBe(true)

    session.stop?.()
    session.stop?.()
    await waitForEvent(harness.events, event => event.type === 'exit')
    expect(harness.events.filter(event => event.type === 'exit')).toHaveLength(1)
    const log = await readLog(harness.logPath)
    expect(log.find(entry => entry.id === 900)?.result).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' }
    })
    expect(log.filter(entry => entry.id === 900 && entry.result != null)).toHaveLength(1)
    expect(log.filter(entry => entry.method === 'session/close')).toHaveLength(1)
  }, 15_000)

  it('loads the cached native id in a second process and suppresses replay before live updates', async () => {
    const cache = new Map<string, unknown>()
    const processA = await createHarness({ cache, description: 'First turn.', permissionMode: 'bypassPermissions' })
    const sessionA = await createGooseSession(processA.ctx, processA.options)
    await waitForEvent(processA.events, event => event.type === 'stop')
    sessionA.stop?.()
    await waitForEvent(processA.events, event => event.type === 'exit')

    const processB = await createHarness({
      cache,
      type: 'resume',
      description: 'Second turn.',
      permissionMode: 'bypassPermissions'
    })
    const sessionB = await createGooseSession(processB.ctx, processB.options)
    await waitForEvent(processB.events, event => event.type === 'stop')
    sessionB.stop?.()
    await waitForEvent(processB.events, event => event.type === 'exit')

    const secondLog = await readLog(processB.logPath)
    expect(secondLog.find(entry => entry.method === 'session/load')?.params?.sessionId).toBe('fake-goose-session')
    expect(secondLog.some(entry => entry.method === 'session/new')).toBe(false)
    expect(processB.events.some(event => event.type === 'message' && event.data.id === 'replayed-message')).toBe(false)
    expect(processB.events.filter(event => event.type === 'message' && event.data.id === 'assistant-1')).toHaveLength(2)
    expect(
      processB.events.some(event =>
        event.type === 'message' && event.data.id === 'assistant-1' && event.data.content === 'Hello world'
      )
    ).toBe(true)
  }, 20_000)

  it('strips host Node loader state from Goose and configured MCP children across create and resume', async () => {
    const fixtureRoot = await mkdtemp(resolve(tmpdir(), 'oneworks-goose-mcp-child-'))
    temporaryRoots.push(fixtureRoot)
    const childLogPath = resolve(fixtureRoot, 'mcp-child.jsonl')
    const processPoison = {
      NODE_OPTIONS: '--require /private/process-host-loader.cjs',
      NODE_PATH: '/private/process-host-node-modules',
      [LEGACY_CLI_LOADER_ENV]: 'process',
      [LEGACY_HOOK_LOADER_ENV]: 'process',
      __ONEWORKS_CLI_HELPER_LOADER_ACTIVE__: 'process',
      __ONEWORKS_HOOK_LOADER_ACTIVE__: 'process',
      __ONEWORKS_PROJECT_REGISTER_LOADER__: 'file:///private/process-project-loader.mjs'
    }
    for (const [name, value] of Object.entries(processPoison)) vi.stubEnv(name, value)

    const configuredMcpEnv = {
      MCP_SCOPED_INPUT: 'selected-by-user',
      NODE_OPTIONS: '--require /private/mcp-host-loader.cjs',
      NODE_PATH: '/private/mcp-host-node-modules',
      [LEGACY_CLI_LOADER_ENV]: 'mcp',
      [LEGACY_HOOK_LOADER_ENV]: 'mcp',
      __ONEWORKS_CLI_HELPER_LOADER_ACTIVE__: 'mcp',
      __ONEWORKS_HOOK_LOADER_ACTIVE__: 'mcp',
      __ONEWORKS_PROJECT_REGISTER_LOADER__: 'file:///private/mcp-project-loader.mjs'
    }
    const assetPlan = {
      adapter: 'goose',
      diagnostics: [],
      mcpServers: {
        child: {
          command: process.execPath,
          args: [mcpEnvFixturePath, childLogPath],
          env: configuredMcpEnv
        }
      },
      overlays: []
    } as never
    const assetPlanBefore = JSON.stringify(assetPlan)
    const runtimePoison = {
      GOOSE_FAKE_RUN_MCP: '1',
      NODE_OPTIONS: '--require /private/context-host-loader.cjs',
      NODE_PATH: '/private/context-host-node-modules',
      [LEGACY_CLI_LOADER_ENV]: 'context',
      [LEGACY_HOOK_LOADER_ENV]: 'context',
      __ONEWORKS_CLI_HELPER_LOADER_ACTIVE__: 'context',
      __ONEWORKS_HOOK_LOADER_ACTIVE__: 'context',
      __ONEWORKS_PROJECT_REGISTER_LOADER__: 'file:///private/context-project-loader.mjs'
    }
    const cache = new Map<string, unknown>()

    for (const type of ['create', 'resume'] as const) {
      const harness = await createHarness({ assetPlan, cache, env: runtimePoison, type })
      const envBefore = { ...harness.ctx.env }
      const session = await createGooseSession(harness.ctx, harness.options)
      session.stop?.()
      session.stop?.()
      await waitForEvent(harness.events, event => event.type === 'exit')

      expect(harness.ctx.env).toEqual(envBefore)
      expect(JSON.stringify(assetPlan)).toBe(assetPlanBefore)
      const log = await readLog(harness.logPath)
      expect(log.find(entry => entry.startup)?.nodeRuntimeEnv ?? {}).toEqual({})
      expect(log.filter(entry => entry.mcpChild)).toEqual([
        expect.objectContaining({ mcpChild: true, signal: null, status: 0 })
      ])
      expect(log.filter(entry => entry.method === 'session/close')).toHaveLength(1)
      const startupMethod = type === 'create' ? 'session/new' : 'session/load'
      const servers = log.find(entry => entry.method === startupMethod)?.params?.mcpServers
      expect(servers).toEqual([
        expect.objectContaining({
          command: process.execPath,
          env: [{ name: 'MCP_SCOPED_INPUT', value: 'selected-by-user' }]
        })
      ])
    }

    const childEntries = (await readFile(childLogPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(childEntries).toEqual([
      { MCP_SCOPED_INPUT: 'selected-by-user' },
      { MCP_SCOPED_INPUT: 'selected-by-user' }
    ])
  }, 20_000)

  it('fails a missing native resume without silently creating a new session', async () => {
    const cache = new Map<string, unknown>([['adapter.goose.session', { gooseSessionId: 'missing-session' }]])
    const harness = await createHarness({ cache, type: 'resume', env: { GOOSE_FAKE_LOAD_ERROR: '1' } })

    await expect(createGooseSession(harness.ctx, harness.options)).rejects.toThrow('session does not exist')
    const log = await readLog(harness.logPath)
    expect(log.some(entry => entry.method === 'session/load')).toBe(true)
    expect(log.some(entry => entry.method === 'session/new')).toBe(false)
  })

  it('cancels an in-flight permission and prompt once, then tolerates repeated stop', async () => {
    const harness = await createHarness({
      description: 'Cancel fixture.',
      env: { GOOSE_FAKE_HOLD_PERMISSION: '1' }
    })
    const session = await createGooseSession(harness.ctx, harness.options)
    await waitForEvent(harness.events, event => event.type === 'interaction_request')

    session.emit?.({ type: 'interrupt' } as AdapterEvent)
    session.emit?.({ type: 'interrupt' } as AdapterEvent)
    await waitForEvent(harness.events, event => event.type === 'stop')
    session.stop?.()
    session.stop?.()
    await waitForEvent(harness.events, event => event.type === 'exit')

    const log = await readLog(harness.logPath)
    expect(log.filter(entry => entry.id === 900 && entry.result != null)).toHaveLength(1)
    expect(log.filter(entry => entry.method === 'session/cancel')).toHaveLength(1)
    expect(log.filter(entry => entry.method === 'session/close')).toHaveLength(1)
    expect(harness.events.filter(event => event.type === 'stop')).toHaveLength(1)
    expect(harness.events.filter(event => event.type === 'exit')).toHaveLength(1)
  }, 15_000)

  it.each([
    ['EOF', { GOOSE_FAKE_EOF_ON_PROMPT: '1' }, 0],
    ['non-zero exit', { GOOSE_FAKE_EXIT_NONZERO_ON_PROMPT: '1' }, 7]
  ])('settles an active prompt once on %s', async (_label, env, expectedCode) => {
    const harness = await createHarness({ description: 'Fail fixture.', env })
    await createGooseSession(harness.ctx, harness.options)

    await waitForEvent(harness.events, event => event.type === 'exit')
    await waitForEvent(harness.events, event => event.type === 'stop')
    expect(harness.events.filter(event => event.type === 'exit')).toHaveLength(1)
    expect(harness.events.find(event => event.type === 'exit')?.data.exitCode).toBe(expectedCode)
    expect(harness.events.filter(event => event.type === 'stop')).toHaveLength(1)
    expect(harness.events.filter(event => event.type === 'error' && event.data.fatal)).toHaveLength(1)
  }, 15_000)

  it('rejects a spawn error without hanging or duplicating terminal events', async () => {
    const harness = await createHarness({ binaryPath: resolve(temporaryRoots[0] ?? tmpdir(), 'missing-goose') })

    await expect(createGooseSession(harness.ctx, harness.options)).rejects.toThrow()
    expect(harness.events.filter(event => event.type === 'error' && event.data.fatal)).toHaveLength(1)
    expect(harness.events.filter(event => event.type === 'exit').length).toBeLessThanOrEqual(1)
  }, 15_000)

  it.each(
    [
      ['initialize', 'initialize', 'create'],
      ['new', 'session/new', 'create'],
      ['load', 'session/load', 'resume']
    ] as const
  )('bounds a nonresponsive %s startup RPC and kills the child', async (_label, method, type) => {
    const cache = type === 'resume'
      ? new Map<string, unknown>([['adapter.goose.session', { gooseSessionId: 'fake-goose-session' }]])
      : undefined
    const harness = await createHarness({
      cache,
      env: { GOOSE_FAKE_HANG_METHOD: method },
      type,
      timeouts: { requestTimeoutMs: 800 }
    })
    const startedAt = Date.now()

    await expect(createGooseSession(harness.ctx, harness.options, harness.timeouts))
      .rejects.toThrow(
        `Goose ACP ${
          method === 'session/new' ? 'session/new' : method === 'session/load' ? 'session/load' : 'initialize'
        } request timed out`
      )
    expect(Date.now() - startedAt).toBeLessThan(3_000)
  })

  it.each(
    [
      ['initialize', 'initialize', 'create'],
      ['new', 'session/new', 'create'],
      ['load', 'session/load', 'resume']
    ] as const
  )('redacts a failed %s startup RPC before rejecting the adapter query', async (_label, method, type) => {
    const secret = `sk-goose-startup-${method.replace('/', '-')}-secret-12345`
    const mcpSecret = `goose-startup-mcp-${method.replace('/', '-')}-secret-12345`
    const cache = type === 'resume'
      ? new Map<string, unknown>([['adapter.goose.session', { gooseSessionId: 'fake-goose-session' }]])
      : undefined
    const harness = await createHarness({
      assetPlan: {
        adapter: 'goose',
        diagnostics: [],
        mcpServers: {
          remote: {
            type: 'http',
            url: 'https://mcp.example.test',
            headers: { Authorization: `Bearer ${mcpSecret}` }
          }
        },
        overlays: []
      },
      cache,
      env: {
        GOOSE_FAKE_LEAK: '1',
        GOOSE_FAKE_LEAK_ENV_NAME: 'OPENAI_API_KEY',
        GOOSE_FAKE_STARTUP_ERROR_METHOD: method,
        GOOSE_PROVIDER: 'openai',
        OPENAI_API_KEY: secret
      },
      type
    })
    let thrown: unknown

    try {
      await createGooseSession(harness.ctx, harness.options)
    } catch (error) {
      thrown = error
    }
    await waitForEvent(harness.events, event => event.type === 'exit')

    expect(thrown).toBeInstanceOf(Error)
    const startupError = thrown as Error & { code?: number | string; context?: string }
    const expectedContext = method === 'initialize'
      ? 'initialize request'
      : method === 'session/new'
      ? 'session/new request'
      : 'session/load request'
    expect(startupError.name).toBe('GooseAcpStartupError')
    expect(startupError.context).toBe(expectedContext)
    expect(startupError.message).toContain(expectedContext)
    expect(startupError.message).toContain('-32000')
    expect(harness.events.filter(event => event.type === 'exit')).toHaveLength(1)

    const serialized = JSON.stringify({
      cache: [...harness.cache.entries()],
      error: {
        code: startupError.code,
        context: startupError.context,
        message: startupError.message,
        name: startupError.name,
        stack: startupError.stack
      },
      events: harness.events,
      logs: harness.logs
    })
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain(encodeURIComponent(secret))
    expect(serialized).not.toContain(Buffer.from(secret).toString('base64'))
    expect(serialized).not.toContain(mcpSecret)
    expect(serialized).not.toContain(encodeURIComponent(mcpSecret))
    expect(serialized).not.toContain(Buffer.from(mcpSecret).toString('base64'))
    expect(serialized).not.toContain(resolve(
      harness.ctx.env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__!,
      'caches'
    ))
    expect(serialized).toContain('[REDACTED]')
    expect(serialized).toContain('[GOOSE_SESSION_ROOT]')
  }, 15_000)

  it.each(
    [
      ['set mode', 'session/set_mode'],
      ['system prompt', '_goose/unstable/session/system-prompt/set']
    ] as const
  )('bounds a nonresponsive %s startup extension and still returns a usable handle', async (_label, method) => {
    const harness = await createHarness({
      env: { GOOSE_FAKE_HANG_METHOD: method },
      permissionMode: 'bypassPermissions',
      timeouts: { requestTimeoutMs: 800 }
    })
    const startedAt = Date.now()

    const session = await createGooseSession(harness.ctx, harness.options, harness.timeouts)
    expect(Date.now() - startedAt).toBeLessThan(3_000)
    session.stop?.()
    await waitForEvent(harness.events, event => event.type === 'exit')
  })

  it('times out close, escalates TERM to KILL, and settles repeated stop once', async () => {
    const harness = await createHarness({
      description: 'Complete before forced close.',
      env: {
        GOOSE_FAKE_HANG_METHOD: 'session/close',
        GOOSE_FAKE_IGNORE_TERM: '1'
      },
      permissionMode: 'bypassPermissions',
      timeouts: { closeTimeoutMs: 100, killTimeoutMs: 100, requestTimeoutMs: 1_000 }
    })
    const session = await createGooseSession(harness.ctx, harness.options, harness.timeouts)
    await waitForEvent(harness.events, event => event.type === 'stop')

    session.stop?.()
    session.stop?.()
    await waitForEvent(harness.events, event => event.type === 'exit')
    expect(harness.events.filter(event => event.type === 'exit')).toHaveLength(1)
    const log = await readLog(harness.logPath)
    expect(log.filter(entry => entry.method === 'session/close')).toHaveLength(1)
  }, 15_000)

  it('redacts exact and encoded provider credentials, isolated paths, and permission tool input', async () => {
    const secret = 'sk-goose-secret-value-12345'
    const harness = await createHarness({
      description: 'Leak fixture.',
      env: {
        GOOSE_FAKE_LEAK: '1',
        GOOSE_FAKE_LEAK_ENV_NAME: 'OPENAI_API_KEY',
        GOOSE_PROVIDER: 'openai',
        OPENAI_API_KEY: secret
      }
    })
    const session = await createGooseSession(harness.ctx, harness.options)
    await waitForEvent(harness.events, event => event.type === 'interaction_request')
    const interaction = harness.events.find(event => event.type === 'interaction_request')
    if (interaction?.type !== 'interaction_request') throw new Error('Missing interaction')
    session.respondInteraction?.(interaction.data.id, 'allow_once')
    await waitForEvent(harness.events, event => event.type === 'stop')
    session.stop?.()
    await waitForEvent(harness.events, event => event.type === 'exit')

    const serialized = JSON.stringify({
      cache: [...harness.cache.entries()],
      events: harness.events,
      logs: harness.logs
    })
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain(encodeURIComponent(secret))
    expect(serialized).not.toContain(Buffer.from(secret).toString('base64'))
    expect(serialized).not.toContain(resolve(
      harness.ctx.env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__!,
      'caches'
    ))
    expect(serialized).toContain('[REDACTED]')
    expect(serialized).toContain('[GOOSE_SESSION_ROOT]')
    expect(interaction.data.payload.question).toBe('Allow Goose to run read?')
  }, 15_000)
})
