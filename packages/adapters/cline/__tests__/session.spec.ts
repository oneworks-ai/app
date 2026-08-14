/* eslint-disable max-lines -- fake CLI lifecycle matrix covers the private Cline boundary end to end. */
import '../src/adapter-config'

import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { InitializeResponse } from '@agentclientprotocol/sdk'
import type { AdapterCtx, AdapterOutputEvent, Cache } from '@oneworks/types'

import { clineAdapterConfigSchema } from '#~/config-schema.js'
import { CLINE_AMBIGUOUS_EMPTY_TURN_MESSAGE } from '#~/runtime/client.js'
import { buildClineFreshJsonArgs, createFreshJsonClineSession } from '#~/runtime/fresh-json.js'
import type { ClinePreparedSession } from '#~/runtime/prepare.js'
import { prepareClineSession, validateClineExtraOptions } from '#~/runtime/prepare.js'
import { ClineRedactor } from '#~/runtime/redaction.js'
import { checkClineAcpGate, createClineSession, waitForClineAuthentication } from '#~/runtime/session.js'

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-cline.mjs')
const spawnErrorHarnessPath = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'spawn-error-harness.ts'
)
const startupExitHarnessPath = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'startup-exit-harness.ts'
)
const execFileAsync = promisify(execFile)

const waitFor = async (predicate: () => boolean, timeoutMs = 8_000) => {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for Cline adapter events')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

const settleWithin = async <T>(promise: Promise<T>, timeoutMs = 4_000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  return await Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Cline startup did not settle')), timeoutMs)
    })
  ]).finally(() => clearTimeout(timer))
}

const readFixtureTree = async (root: string): Promise<string> => {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const contents: string[] = []
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) contents.push(await readFixtureTree(path))
    else if (entry.isFile()) contents.push(await readFile(path, 'utf8').catch(() => ''))
  }
  return contents.join('\n')
}

const createCtx = (
  cwd: string,
  env: Record<string, string>,
  cacheStore = new Map<keyof Cache, Cache[keyof Cache]>(),
  source: 'managed' | 'path' | 'system' = 'managed'
) => {
  const ctx: AdapterCtx = {
    ctxId: 'cline-fixture-context',
    cwd,
    env: {
      ...env,
      __ONEWORKS_PROJECT_ADAPTER_CLINE_CLI_PATH__: fixturePath,
      __ONEWORKS_PROJECT_REAL_HOME__: cwd
    },
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
    configs: [{ adapters: { cline: { cli: { source } } } }, undefined]
  }
  return { cacheStore, ctx }
}

const answerNextPermission = async (
  session: Awaited<ReturnType<typeof createClineSession>>,
  events: AdapterOutputEvent[]
) => {
  await waitFor(() => events.some(event => event.type === 'interaction_request'))
  const request = events.find(event => event.type === 'interaction_request')
  if (request?.type !== 'interaction_request') throw new Error('Missing permission request')
  await session.respondInteraction?.(request.data.id, 'allow_once')
}

describe('cline ACP session lifecycle', () => {
  let tempDir: string | undefined

  afterEach(async () => {
    if (tempDir != null) await rm(tempDir, { recursive: true, force: true })
    tempDir = undefined
  })

  it('marks native authentication inheritance unsupported in adapter configuration', () => {
    expect(clineAdapterConfigSchema.safeParse({ inheritNativeAuth: true }).success).toBe(false)
    expect(clineAdapterConfigSchema.parse({ inheritNativeAuth: false })).toEqual({ inheritNativeAuth: false })
    expect(clineAdapterConfigSchema.safeParse({ authTimeoutMs: 59_999 }).success).toBe(false)
    expect(clineAdapterConfigSchema.parse({ authTimeoutMs: 120_000 })).toEqual({ authTimeoutMs: 120_000 })
  })

  it.each(
    [
      [{
        protocolVersion: 2,
        agentCapabilities: { loadSession: true },
        agentInfo: { name: 'cline', version: '3.0.54' }
      }, 'protocolVersion'],
      [{
        protocolVersion: 1,
        agentCapabilities: { loadSession: true },
        agentInfo: { name: 'not-cline', version: '3.0.54' }
      }, 'agentInfo.name'],
      [{
        protocolVersion: 1,
        agentCapabilities: { loadSession: false },
        agentInfo: { name: 'cline', version: '3.0.54' }
      }, 'loadSession']
    ] as const
  )('rejects an incompatible ACP %s gate', (initialize, reason) => {
    expect(checkClineAcpGate(initialize as InitializeResponse)).toEqual(expect.objectContaining({
      compatible: false,
      reason: expect.stringContaining(reason)
    }))
  })

  it.each(['cline', 'cline-pass', 'openai-codex'] as const)(
    'authenticates with %s before create and twice-resumed cross-process load',
    async (authMethod) => {
      await chmod(fixturePath, 0o755)
      tempDir = await mkdtemp(join(tmpdir(), `ow-cline-auth-resume-${authMethod}-`))
      const lifecyclePath = join(tempDir, 'lifecycle.txt')
      const cacheStore = new Map<keyof Cache, Cache[keyof Cache]>()
      const run = async (type: 'create' | 'resume', configuredMethod: boolean) => {
        const events: AdapterOutputEvent[] = []
        const prepared = createCtx(tempDir!, {
          CLINE_FAKE_AUTH: 'advertised',
          CLINE_FAKE_LIFECYCLE_PATH: lifecyclePath
        }, cacheStore)
        if (configuredMethod) {
          prepared.ctx.configs[0]!.adapters!.cline = {
            authMethod,
            cli: { source: 'managed' }
          }
        }
        const session = await createClineSession(prepared.ctx, {
          type,
          runtime: 'server',
          sessionId: 'cline-auth-resume',
          onEvent: event => events.push(event)
        })
        await waitFor(() => events.some(event => event.type === 'init'))
        session.stop?.()
        await waitFor(() => events.some(event => event.type === 'exit'))
      }

      await run('create', true)
      await run('resume', false)
      await run('resume', false)

      expect(cacheStore.get('adapter.cline.session')).toEqual({
        authenticatedMethodId: authMethod,
        nativeSessionId: 'cline-native-fixture-1',
        protocolVersion: 1,
        version: '3.0.54'
      })
      expect((await readFile(lifecyclePath, 'utf8')).trim().split('\n')).toEqual([
        `auth:${authMethod}`,
        'new:cline-native-fixture-1',
        `auth:${authMethod}`,
        'load:cline-native-fixture-1',
        `auth:${authMethod}`,
        'load:cline-native-fixture-1'
      ])
    }
  )

  it('does not apply the 20 second control deadline to an unbounded authentication wait', async () => {
    vi.useFakeTimers()
    try {
      let finish: () => void = () => undefined
      const authentication = waitForClineAuthentication(
        new Promise<void>(resolve => {
          finish = resolve
        })
      )
      await vi.advanceTimersByTimeAsync(21_000)
      finish()
      await expect(authentication).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps configured authentication stoppable after returning the startup handle', async () => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-auth-stop-'))
    const lifecyclePath = join(tempDir, 'lifecycle.txt')
    const events: AdapterOutputEvent[] = []
    const prepared = createCtx(tempDir, {
      CLINE_FAKE_AUTH: 'advertised',
      CLINE_FAKE_AUTH_DELAY_MS: '5000',
      CLINE_FAKE_LIFECYCLE_PATH: lifecyclePath
    })
    prepared.ctx.configs[0]!.adapters!.cline = { authMethod: 'cline', cli: { source: 'managed' } }
    const session = await createClineSession(prepared.ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'cline-auth-stop',
      onEvent: event => events.push(event)
    })
    expect(events.filter(event => event.type === 'operation')).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ type: 'operation_started' }) })
    ])
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(events.filter(event => event.type === 'operation')).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ type: 'operation_started' }) }),
      expect.objectContaining({ data: expect.objectContaining({ type: 'operation_failed' }) })
    ])
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
    expect(await readFile(lifecyclePath, 'utf8')).toBe('auth:cline\n')
  })

  it('settles child exit during authentication once before session creation', async () => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-auth-exit-'))
    const lifecyclePath = join(tempDir, 'lifecycle.txt')
    const events: AdapterOutputEvent[] = []
    const prepared = createCtx(tempDir, {
      CLINE_FAKE_AUTH: 'exit',
      CLINE_FAKE_LIFECYCLE_PATH: lifecyclePath
    })
    prepared.ctx.configs[0]!.adapters!.cline = { authMethod: 'cline', cli: { source: 'managed' } }
    await createClineSession(prepared.ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'cline-auth-exit',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(events.filter(event => event.type === 'operation')).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ type: 'operation_started' }) }),
      expect.objectContaining({ data: expect.objectContaining({ type: 'operation_failed' }) })
    ])
    expect(events.filter(event => event.type === 'error')).toHaveLength(1)
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
    expect(await readFile(lifecyclePath, 'utf8')).toBe('auth:cline\n')
  })

  it.each(
    [
      ['exit-before-initialize', 1, /exited unexpectedly/u],
      ['exit-during-initialize', 6, /EOF|exited unexpectedly/u],
      ['initialize-reject', 1, /fake initialize rejected/u],
      ['exit-during-new', 7, /EOF|exited unexpectedly/u]
    ] as const
  )(
    'settles post-spawn startup mode %s once without caching partial state',
    async (mode, expectedExitCode, message) => {
      await chmod(fixturePath, 0o755)
      tempDir = await mkdtemp(join(tmpdir(), `ow-cline-startup-${mode}-`))
      const events: AdapterOutputEvent[] = []
      const prepared = createCtx(tempDir, { CLINE_FAKE_MODE: mode })
      await settleWithin(createClineSession(prepared.ctx, {
        type: 'create',
        runtime: 'server',
        sessionId: `cline-startup-${mode}`,
        description: 'STARTUP_SETTLEMENT_SECRET',
        onEvent: event => events.push(event)
      }))
      await waitFor(() => events.some(event => event.type === 'exit'))

      const errorIndex = events.findIndex(event => event.type === 'error')
      const exitIndex = events.findIndex(event => event.type === 'exit')
      expect(errorIndex).toBeGreaterThanOrEqual(0)
      expect(exitIndex).toBeGreaterThan(errorIndex)
      expect(events.filter(event => event.type === 'error')).toEqual([
        expect.objectContaining({
          data: expect.objectContaining({ fatal: true, message: expect.stringMatching(message) })
        })
      ])
      expect(events.filter(event => event.type === 'exit')).toEqual([
        expect.objectContaining({ data: expect.objectContaining({ exitCode: expectedExitCode }) })
      ])
      expect(events.some(event => event.type === 'stop')).toBe(false)
      expect(prepared.cacheStore.size).toBe(0)
      expect(JSON.stringify(events)).not.toContain('STARTUP_SETTLEMENT_SECRET')
      expect(await readFixtureTree(tempDir)).not.toContain('STARTUP_SETTLEMENT_SECRET')
    }
  )

  it('settles a separate-process load exit without replacing the successful native cache', async () => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-startup-load-'))
    const cacheStore = new Map<keyof Cache, Cache[keyof Cache]>()
    const createdEvents: AdapterOutputEvent[] = []
    const created = await createClineSession(createCtx(tempDir, {}, cacheStore).ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'cline-startup-load',
      onEvent: event => createdEvents.push(event)
    })
    await waitFor(() => createdEvents.some(event => event.type === 'init'))
    created.stop?.()
    await waitFor(() => createdEvents.some(event => event.type === 'exit'))
    const cacheBeforeLoad = structuredClone(cacheStore.get('adapter.cline.session'))

    const resumedEvents: AdapterOutputEvent[] = []
    await settleWithin(createClineSession(
      createCtx(tempDir, { CLINE_FAKE_MODE: 'exit-during-load' }, cacheStore).ctx,
      {
        type: 'resume',
        runtime: 'server',
        sessionId: 'cline-startup-load',
        onEvent: event => resumedEvents.push(event)
      }
    ))
    await waitFor(() => resumedEvents.some(event => event.type === 'exit'))
    expect(resumedEvents.map(event => event.type)).toEqual(['error', 'exit'])
    expect(resumedEvents[0]).toEqual(expect.objectContaining({ data: expect.objectContaining({ fatal: true }) }))
    expect(resumedEvents[1]).toEqual(expect.objectContaining({ data: expect.objectContaining({ exitCode: 8 }) }))
    expect(cacheStore.get('adapter.cline.session')).toEqual(cacheBeforeLoad)
  })

  it('settles an authentication exit and repeated stop race exactly once', async () => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-startup-auth-stop-race-'))
    const events: AdapterOutputEvent[] = []
    const prepared = createCtx(tempDir, { CLINE_FAKE_AUTH: 'exit' })
    prepared.ctx.configs[0]!.adapters!.cline = { authMethod: 'cline', cli: { source: 'managed' } }
    const session = await settleWithin(createClineSession(prepared.ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'cline-startup-auth-stop-race',
      onEvent: event => events.push(event)
    }))
    session.stop?.()
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
    expect(events.filter(event => event.type === 'error')).toHaveLength(0)
    expect(events.filter(event => event.type === 'stop')).toHaveLength(0)
    expect(events.filter(event => event.type === 'operation')).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ type: 'operation_started' }) }),
      expect.objectContaining({ data: expect.objectContaining({ type: 'operation_failed' }) })
    ])
    expect(prepared.cacheStore.size).toBe(0)
  })

  it('returns a startup interaction handle before explicit ACP authentication blocks', async () => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-auth-choice-'))
    const lifecyclePath = join(tempDir, 'lifecycle.txt')
    const events: AdapterOutputEvent[] = []
    const session = await createClineSession(
      createCtx(tempDir, {
        CLINE_FAKE_AUTH: 'advertised',
        CLINE_FAKE_LIFECYCLE_PATH: lifecyclePath
      }).ctx,
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'cline-auth-choice',
        onEvent: event => events.push(event)
      }
    )
    const interaction = events.find(event => event.type === 'interaction_request')
    if (interaction?.type !== 'interaction_request') throw new Error('Missing Cline auth interaction')
    expect(interaction.data.payload.options?.map(option => option.value)).toEqual([
      'cline',
      'cline-pass',
      'openai-codex'
    ])
    expect(existsSync(lifecyclePath)).toBe(false)
    await session.respondInteraction?.(interaction.data.id, 'cline-pass')
    await waitFor(() => events.some(event => event.type === 'init'))
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect((await readFile(lifecyclePath, 'utf8')).trim().split('\n')).toEqual([
      'auth:cline-pass',
      'new:cline-native-fixture-1'
    ])
  })

  it('does not apply the control deadline to the human authentication-method choice', async () => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-auth-choice-deadline-'))
    const events: AdapterOutputEvent[] = []
    const session = await createClineSession(
      createCtx(tempDir, { CLINE_FAKE_AUTH: 'advertised' }).ctx,
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'cline-auth-choice-deadline',
        onEvent: event => events.push(event)
      },
      { controlTimeoutMs: 2_000 }
    )
    const interaction = events.find(event => event.type === 'interaction_request')
    if (interaction?.type !== 'interaction_request') throw new Error('Missing Cline auth interaction')
    await new Promise(resolve => setTimeout(resolve, 2_500))
    await session.respondInteraction?.(interaction.data.id, 'cline')
    await waitFor(() => events.some(event => event.type === 'init'))
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(events.filter(event => event.type === 'error')).toHaveLength(0)
  })

  it.each(
    [
      ['unknown', undefined, /unverified authentication method/u],
      ['duplicate', undefined, /duplicate authentication method/u],
      ['unsupported-type', undefined, /unsupported type/u],
      ['none', 'cline', /was not advertised/u],
      ['fail', 'cline', /fake auth failed/u],
      ['timeout', 'cline', /authenticate timed out/u]
    ] as const
  )('fails closed before session creation for ACP auth case %s', async (authMode, authMethod, message) => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), `ow-cline-auth-${authMode}-`))
    const lifecyclePath = join(tempDir, 'lifecycle.txt')
    const events: AdapterOutputEvent[] = []
    const prepared = createCtx(tempDir, {
      AWS_PROFILE: 'fixture-profile',
      AWS_SHARED_CREDENTIALS_FILE: '/isolated/aws-credentials',
      CLINE_FAKE_AUTH: authMode,
      CLINE_FAKE_LIFECYCLE_PATH: lifecyclePath
    })
    prepared.ctx.configs[0]!.adapters!.cline = {
      ...(authMethod == null ? {} : { authMethod }),
      cli: { source: 'managed' },
      credentialEnv: ['AWS_SHARED_CREDENTIALS_FILE', 'AWS_PROFILE'],
      provider: 'bedrock'
    }
    await createClineSession(prepared.ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: `cline-auth-${authMode}`,
      onEvent: event => events.push(event)
    }, {
      ...(authMode === 'timeout' ? { authenticationTimeoutMs: 1_000 } : {}),
      controlTimeoutMs: 1_000,
      gracefulCloseMs: 20,
      termCloseMs: 50
    })
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(events.filter(event => event.type === 'error')).toHaveLength(1)
    expect(events.find(event => event.type === 'error')).toEqual(expect.objectContaining({
      data: expect.objectContaining({ message: expect.stringMatching(message), fatal: true })
    }))
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
    expect(await readFile(lifecyclePath, 'utf8').catch(() => '')).not.toMatch(/(?:new|load):/u)
    expect(JSON.stringify(events)).not.toContain('sk-authsecret1234567890')
  })

  it('settles an explicitly cancelled startup authentication once before newSession', async () => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-auth-cancel-'))
    const lifecyclePath = join(tempDir, 'lifecycle.txt')
    const events: AdapterOutputEvent[] = []
    const prepared = createCtx(tempDir, {
      AWS_PROFILE: 'fixture-profile',
      AWS_SHARED_CREDENTIALS_FILE: '/isolated/aws-credentials',
      CLINE_FAKE_AUTH: 'advertised',
      CLINE_FAKE_LIFECYCLE_PATH: lifecyclePath
    })
    prepared.ctx.configs[0]!.adapters!.cline = {
      cli: { source: 'managed' },
      credentialEnv: ['AWS_SHARED_CREDENTIALS_FILE', 'AWS_PROFILE'],
      provider: 'bedrock'
    }
    const session = await createClineSession(
      prepared.ctx,
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'cline-auth-cancel',
        onEvent: event => events.push(event)
      }
    )
    const interaction = events.find(event => event.type === 'interaction_request')
    if (interaction?.type !== 'interaction_request') throw new Error('Missing Cline auth interaction')
    await session.respondInteraction?.(interaction.data.id, 'cancel')
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(events.filter(event => event.type === 'error')).toHaveLength(1)
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
    expect(existsSync(lifecyclePath)).toBe(false)
  })

  it('projects live text/tool/permission and resumes by native id without replay duplicates', async () => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-lifecycle-'))
    const argsPath = join(tempDir, 'args.jsonl')
    const lifecyclePath = join(tempDir, 'lifecycle.txt')
    const cacheStore = new Map<keyof Cache, Cache[keyof Cache]>()
    const firstEvents: AdapterOutputEvent[] = []
    const lifecycleEnv = {
      CLINE_FAKE_ARGS_PATH: argsPath,
      CLINE_FAKE_LIFECYCLE_PATH: lifecyclePath
    }
    const firstCtx = createCtx(tempDir, lifecycleEnv, cacheStore).ctx
    const first = await createClineSession(firstCtx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'cline-oneworks-session',
      description: 'turn-one',
      onEvent: event => firstEvents.push(event)
    })
    await answerNextPermission(first, firstEvents)
    await waitFor(() => firstEvents.some(event => event.type === 'stop'))
    first.stop?.()
    await waitFor(() => firstEvents.some(event => event.type === 'exit'))

    expect(cacheStore.get('adapter.cline.session')).toEqual({
      nativeSessionId: 'cline-native-fixture-1',
      protocolVersion: 1,
      version: '3.0.54'
    })
    expect(firstEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'init', data: expect.objectContaining({ adapter: 'cline', version: '3.0.54' }) }),
      expect.objectContaining({
        type: 'message',
        data: expect.objectContaining({ content: 'reply:turn-one' })
      }),
      expect.objectContaining({
        type: 'message',
        data: expect.objectContaining({
          content: [expect.objectContaining({ type: 'tool_result', content: 'fixture-result' })]
        })
      })
    ]))

    const resumedEvents: AdapterOutputEvent[] = []
    const resumed = await createClineSession(
      createCtx(tempDir, lifecycleEnv, cacheStore).ctx,
      {
        type: 'resume',
        runtime: 'server',
        sessionId: 'cline-oneworks-session',
        description: 'turn-two',
        onEvent: event => resumedEvents.push(event)
      }
    )
    await answerNextPermission(resumed, resumedEvents)
    await waitFor(() => resumedEvents.some(event => event.type === 'stop'))
    resumed.stop?.()
    await waitFor(() => resumedEvents.some(event => event.type === 'exit'))

    const messagePayload = JSON.stringify(resumedEvents.filter(event => event.type === 'message'))
    expect(messagePayload).toContain('reply:turn-two')
    expect(messagePayload).not.toContain('replayed-text')
    expect(messagePayload).not.toContain('[image]')

    const secondResumeEvents: AdapterOutputEvent[] = []
    const secondResume = await createClineSession(createCtx(tempDir, lifecycleEnv, cacheStore).ctx, {
      type: 'resume',
      runtime: 'server',
      sessionId: 'cline-oneworks-session',
      description: 'turn-three',
      onEvent: event => secondResumeEvents.push(event)
    })
    await answerNextPermission(secondResume, secondResumeEvents)
    await waitFor(() => secondResumeEvents.some(event => event.type === 'stop'))
    secondResume.stop?.()
    await waitFor(() => secondResumeEvents.some(event => event.type === 'exit'))
    expect(JSON.stringify(secondResumeEvents.filter(event => event.type === 'message'))).toContain('reply:turn-three')

    const invocations = (await readFile(argsPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as string[])
    expect(invocations).toHaveLength(3)
    expect(invocations.every(args => args.includes('--acp'))).toBe(true)
    expect((await readFile(lifecyclePath, 'utf8')).trim().split('\n')).toEqual([
      'new:cline-native-fixture-1',
      'load:cline-native-fixture-1',
      'load:cline-native-fixture-1'
    ])
  })

  it('deduplicates replay only by native identity and preserves equal live content across turns', async () => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-replay-identity-'))
    const cacheStore = new Map<keyof Cache, Cache[keyof Cache]>()
    cacheStore.set('adapter.cline.session', {
      nativeSessionId: 'cline-native-fixture-1',
      protocolVersion: 1,
      version: '3.0.54'
    })
    const events: AdapterOutputEvent[] = []
    const session = await createClineSession(createCtx(tempDir, {}, cacheStore).ctx, {
      type: 'resume',
      runtime: 'server',
      sessionId: 'cline-replay-identity',
      description: 'REPLAY_ID',
      permissionMode: 'dontAsk',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.filter(event => event.type === 'stop').length === 1)
    expect(JSON.stringify(events.filter(event => event.type === 'message'))).not.toContain('replayed-text')
    expect(JSON.stringify(events.filter(event => event.type === 'message'))).toContain('live-text')

    session.emit({ type: 'message', content: [{ type: 'text', text: 'SAME_PUNCT' }] })
    await waitFor(() => events.filter(event => event.type === 'stop').length === 2)
    session.emit({ type: 'message', content: [{ type: 'text', text: 'SAME_PUNCT' }] })
    await waitFor(() => events.filter(event => event.type === 'stop').length === 3)
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))

    const punctuation = events.flatMap(event => (
      event.type === 'message' && typeof event.data.content === 'string' && event.data.content.startsWith('!')
        ? [event.data.content]
        : []
    ))
    expect(punctuation).toEqual(['!', '!!', '!', '!!'])
  })

  it('exposes isolated system/skill paths to ACP without copying native credentials', async () => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-isolation-'))
    const providerSettingsPath = join(tempDir, '.cline', 'data', 'settings', 'providers.json')
    const skillDir = join(tempDir, 'selected-skill')
    const preparePath = join(tempDir, 'prepare.jsonl')
    await Promise.all([
      mkdir(dirname(providerSettingsPath), { recursive: true }),
      mkdir(skillDir, { recursive: true })
    ])
    await Promise.all([
      writeFile(providerSettingsPath, '{"apiKey":"NATIVE_SECRET_FIXTURE"}\n'),
      writeFile(join(skillDir, 'SKILL.md'), '# Probe skill\n')
    ])
    const providerHashBefore = createHash('sha256').update(await readFile(providerSettingsPath)).digest('hex')
    const events: AdapterOutputEvent[] = []
    const session = await createClineSession(
      createCtx(tempDir, {
        CLINE_FAKE_PREPARE_PATH: preparePath
      }).ctx,
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'cline-isolation-session',
        systemPrompt: 'ISOLATED SYSTEM PROBE',
        assetPlan: {
          adapter: 'cline',
          diagnostics: [],
          mcpServers: {},
          overlays: [{
            assetId: 'skill:probe',
            kind: 'skill',
            sourcePath: skillDir,
            targetPath: 'skills/probe'
          }]
        },
        onEvent: event => events.push(event)
      }
    )
    await waitFor(() => events.some(event => event.type === 'init'))
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))

    const probe = JSON.parse((await readFile(preparePath, 'utf8')).trim()) as Record<string, unknown>
    expect(probe).toEqual(expect.objectContaining({
      skillEntries: ['probe'],
      systemRule: expect.stringContaining('ISOLATED SYSTEM PROBE')
    }))
    expect(probe.home).not.toBe(tempDir)
    expect(probe.configDir).not.toBe(join(tempDir, '.cline'))
    expect(probe.dataDir).not.toBe(join(tempDir, '.cline', 'data'))
    expect(probe.hooksDir).not.toBe(join(tempDir, '.cline', 'hooks'))
    expect(createHash('sha256').update(await readFile(providerSettingsPath)).digest('hex')).toBe(providerHashBefore)
    expect(JSON.stringify(probe)).not.toContain('NATIVE_SECRET_FIXTURE')
    expect(probe.undocumentedProviderEnv).toEqual({})
  })

  it('passes only the explicitly selected provider credential to the child process', async () => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-selected-credential-'))
    const capturePath = join(tempDir, 'child-env.json')
    const selectedSecret = 'OPENAI_SELECTED_SECRET_123456789'
    const rejectedSecrets = [
      'AWS_AMBIENT_SECRET_123456789',
      'GOOGLE_FILE_SECRET_123456789',
      'GIT_INTERNAL_SECRET_123456789'
    ]
    const events: AdapterOutputEvent[] = []
    const prepared = createCtx(tempDir, {
      AWS_SECRET_ACCESS_KEY: rejectedSecrets[0],
      AWS_SHARED_CREDENTIALS_FILE: '/private/aws/credentials',
      CLINE_FAKE_CAPTURE_PATH: capturePath,
      GIT_INTERNAL_TOKEN: rejectedSecrets[2],
      GOOGLE_APPLICATION_CREDENTIALS: rejectedSecrets[1],
      OPENAI_API_KEY: selectedSecret
    })
    prepared.ctx.configs[0]!.adapters!.cline = {
      cli: { source: 'managed' },
      credentialEnv: ['OPENAI_API_KEY'],
      provider: 'openai'
    }
    const session = await createClineSession(prepared.ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'cline-selected-credential',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'init'))
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))

    expect(JSON.parse(await readFile(capturePath, 'utf8'))).toEqual({ CLINE_API_KEY: selectedSecret })
    await rm(capturePath)
    const persisted = await readFixtureTree(tempDir)
    expect(persisted).not.toContain(selectedSecret)
    for (const rejected of rejectedSecrets) expect(persisted).not.toContain(rejected)
    expect(JSON.stringify(events)).not.toContain(selectedSecret)
    const conflicting = createCtx(tempDir, { OPENAI_API_KEY: selectedSecret })
    conflicting.ctx.configs[0]!.adapters!.cline = {
      authMethod: 'cline',
      cli: { source: 'managed' },
      credentialEnv: ['OPENAI_API_KEY'],
      provider: 'openai'
    }
    await expect(prepareClineSession(conflicting.ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'cline-conflicting-auth',
      onEvent: () => undefined
    })).rejects.toThrow(/authMethod cannot be combined with a selected API-key credential/u)
  })

  it('authenticates before create and cross-process resume with selected Bedrock and Vertex credentials', async () => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-native-credentials-'))
    const fixtures: Array<{
      env: Record<string, string>
      expected: Record<string, string>
      provider: string
      selected: string[]
    }> = [
      {
        provider: 'bedrock',
        selected: ['AWS_SHARED_CREDENTIALS_FILE', 'AWS_PROFILE'],
        env: {
          AWS_PROFILE: 'fixture-profile',
          AWS_SHARED_CREDENTIALS_FILE: '/isolated/aws-credentials',
          GOOGLE_APPLICATION_CREDENTIALS: '/ambient/google.json'
        },
        expected: {
          AWS_PROFILE: 'fixture-profile',
          AWS_SHARED_CREDENTIALS_FILE: '/isolated/aws-credentials'
        }
      },
      {
        provider: 'vertex',
        selected: ['GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT'],
        env: {
          AWS_SHARED_CREDENTIALS_FILE: '/ambient/aws-credentials',
          GOOGLE_APPLICATION_CREDENTIALS: '/isolated/google.json',
          GOOGLE_CLOUD_PROJECT: 'fixture-project'
        },
        expected: {
          GOOGLE_APPLICATION_CREDENTIALS: '/isolated/google.json',
          GOOGLE_CLOUD_PROJECT: 'fixture-project'
        }
      }
    ]
    for (const fixture of fixtures) {
      const lifecyclePath = join(tempDir, `${fixture.provider}-lifecycle.txt`)
      const cacheStore = new Map<keyof Cache, Cache[keyof Cache]>()
      for (const type of ['create', 'resume'] as const) {
        const capturePath = join(tempDir, `${fixture.provider}-${type}.json`)
        const prepared = createCtx(tempDir, {
          ...fixture.env,
          CLINE_FAKE_AUTH: 'advertised',
          CLINE_FAKE_CAPTURE_PATH: capturePath,
          CLINE_FAKE_LIFECYCLE_PATH: lifecyclePath
        }, cacheStore)
        prepared.ctx.configs[0]!.adapters!.cline = {
          authMethod: 'cline',
          cli: { source: 'managed' },
          credentialEnv: [...fixture.selected],
          provider: fixture.provider
        }
        const events: AdapterOutputEvent[] = []
        const session = await createClineSession(prepared.ctx, {
          type,
          runtime: 'server',
          sessionId: `cline-${fixture.provider}-credentials`,
          onEvent: event => events.push(event)
        })
        await waitFor(() => events.some(event => event.type === 'init'))
        session.stop?.()
        await waitFor(() => events.some(event => event.type === 'exit'))
        expect(JSON.parse(await readFile(capturePath, 'utf8'))).toEqual(fixture.expected)
        await rm(capturePath)
        expect(JSON.stringify(events)).not.toContain(Object.values(fixture.expected)[0])
      }
      expect((await readFile(lifecyclePath, 'utf8')).trim().split('\n')).toEqual([
        'auth:cline',
        'new:cline-native-fixture-1',
        'auth:cline',
        'load:cline-native-fixture-1'
      ])
      expect(JSON.stringify([...cacheStore.entries()])).not.toContain(Object.values(fixture.expected)[0])
    }
    const persisted = await readFixtureTree(tempDir)
    for (const fixture of fixtures) {
      for (const value of Object.values(fixture.expected)) expect(persisted).not.toContain(value)
    }
  })

  it('cancels an active prompt and settles a pending turn once', async () => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-cancel-'))
    const events: AdapterOutputEvent[] = []
    const session = await createClineSession(createCtx(tempDir, {}).ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'cline-cancel-session',
      description: 'CANCEL',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'session_update'))
    session.emit({ type: 'interrupt' })
    await waitFor(() => events.some(event => event.type === 'stop'))
    session.stop?.()
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(events.filter(event => event.type === 'stop')).toHaveLength(1)
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
  })

  it('stops during startup authentication without creating a session or reporting prompt failure', async () => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-auth-startup-stop-'))
    const lifecyclePath = join(tempDir, 'lifecycle.txt')
    const events: AdapterOutputEvent[] = []
    const session = await createClineSession(
      createCtx(tempDir, {
        CLINE_FAKE_AUTH: 'advertised',
        CLINE_FAKE_LIFECYCLE_PATH: lifecyclePath
      }).ctx,
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'cline-auth-startup-stop',
        onEvent: event => events.push(event)
      },
      { gracefulCloseMs: 30, termCloseMs: 60 }
    )
    expect(events.some(event => event.type === 'interaction_request')).toBe(true)
    session.stop?.()
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
    expect(events.some(event => event.type === 'error' && event.data.code === 'cline_prompt_failure')).toBe(false)
    expect(existsSync(lifecyclePath)).toBe(false)
  })

  it('waits for an unresponsive ACP child to die after TERM/KILL before its single exit', async () => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-acp-stop-'))
    const events: AdapterOutputEvent[] = []
    const session = await createClineSession(
      createCtx(tempDir, {
        CLINE_FAKE_MODE: 'acp-unresponsive'
      }).ctx,
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'cline-acp-stop',
        description: 'ACP_HANG',
        onEvent: event => events.push(event)
      },
      { controlTimeoutMs: 1_000, gracefulCloseMs: 30, termCloseMs: 60 }
    )
    await waitFor(() => events.some(event => event.type === 'session_update'))
    const pid = session.pid
    session.stop?.()
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
    expect(events.find(event => event.type === 'exit')).toEqual(expect.objectContaining({
      data: expect.objectContaining({ exitCode: 0 })
    }))
    expect(events.some(event => event.type === 'error' && event.data.code === 'cline_prompt_failure')).toBe(false)
    if (pid != null) expect(() => process.kill(pid, 0)).toThrow()
  })

  it('turns an ambiguous empty end_turn into one generic terminal failure', async () => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-empty-'))
    const events: AdapterOutputEvent[] = []
    await createClineSession(createCtx(tempDir, {}).ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'cline-empty-session',
      description: 'EMPTY',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(events.filter(event => event.type === 'error')).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          code: 'cline_ambiguous_empty_turn',
          fatal: true,
          message: CLINE_AMBIGUOUS_EMPTY_TURN_MESSAGE
        })
      })
    ])
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
    expect(events.some(event => event.type === 'stop')).toBe(false)
  })

  it('uses fresh-only JSON without --id when a path CLI misses the version gate', async () => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-fallback-'))
    const argsPath = join(tempDir, 'args.jsonl')
    const events: AdapterOutputEvent[] = []
    const session = await createClineSession(
      createCtx(
        tempDir,
        {
          CLINE_FAKE_ARGS_PATH: argsPath,
          CLINE_FAKE_VERSION: '3.0.55'
        },
        undefined,
        'path'
      ).ctx,
      {
        type: 'resume',
        runtime: 'server',
        sessionId: 'cline-fallback-session',
        description: 'fresh-turn',
        permissionMode: 'dontAsk',
        onEvent: event => events.push(event)
      }
    )
    await waitFor(() => events.some(event => event.type === 'stop'))
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))
    const invocations = (await readFile(argsPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as string[])
    expect(invocations).toHaveLength(2)
    expect(invocations[1]).toContain('--json')
    expect(invocations[1]).not.toContain('--id')
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'error',
        data: expect.objectContaining({ code: 'cline_fresh_only_fallback', fatal: false })
      }),
      expect.objectContaining({
        type: 'message',
        data: expect.objectContaining({ content: 'fresh:fresh-turn' })
      })
    ]))
  })

  it('redacts prompts and environment secrets from fresh-only JSON diagnostics', async () => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-fallback-redaction-'))
    const events: AdapterOutputEvent[] = []
    await createClineSession(
      createCtx(
        tempDir,
        {
          CLINE_FAKE_API_KEY: 'FRESH_SECRET_FIXTURE',
          CLINE_FAKE_MODE: 'fresh-nonzero',
          CLINE_FAKE_VERSION: '3.0.55'
        },
        undefined,
        'path'
      ).ctx,
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'cline-fallback-redaction',
        description: 'FRESH SECRET PROMPT',
        permissionMode: 'dontAsk',
        onEvent: event => events.push(event)
      }
    )
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(events.filter(event => event.type === 'error')).toHaveLength(2)
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
    expect(JSON.stringify(events)).not.toContain('FRESH SECRET PROMPT')
    expect(JSON.stringify(events)).not.toContain('FRESH_SECRET_FIXTURE')
    expect(JSON.stringify(events)).toContain('[REDACTED]')
  })

  it.each(
    [
      ['eof-on-prompt', 1],
      ['nonzero-on-prompt', 7]
    ] as const
  )('settles %s as one terminal failure', async (mode, expectedProcessCode) => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), `ow-cline-${mode}-`))
    const events: AdapterOutputEvent[] = []
    await createClineSession(createCtx(tempDir, { CLINE_FAKE_MODE: mode }).ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: `cline-${mode}`,
      description: 'trigger',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'exit'))
    const exit = events.find(event => event.type === 'exit')
    expect(exit).toEqual(expect.objectContaining({
      type: 'exit',
      data: expect.objectContaining({ exitCode: expectedProcessCode })
    }))
    expect(events.filter(event => event.type === 'error')).toHaveLength(1)
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
    if (mode === 'nonzero-on-prompt') {
      expect(JSON.stringify(events)).not.toContain('trigger')
      expect(JSON.stringify(events)).toContain('[REDACTED]')
    }
  })

  it('settles a pending permission when the ACP child exits', async () => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-pending-permission-'))
    const events: AdapterOutputEvent[] = []
    await createClineSession(createCtx(tempDir, { CLINE_FAKE_MODE: 'pending-permission-exit' }).ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'cline-pending-permission',
      description: 'trigger pending permission',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(events.filter(event => event.type === 'interaction_request')).toHaveLength(1)
    expect(events.filter(event => event.type === 'error')).toHaveLength(1)
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
  })

  it('settles a spawn error once without exposing prompts in diagnostics', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-spawn-'))
    const events: AdapterOutputEvent[] = []
    const { ctx } = createCtx(tempDir, {})
    ctx.env.__ONEWORKS_PROJECT_ADAPTER_CLINE_CLI_PATH__ = join(tempDir, 'missing-cline')
    await createClineSession(ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'cline-spawn-session',
      description: 'TOP SECRET PROMPT',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(events.filter(event => event.type === 'error')).toHaveLength(1)
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
    expect(JSON.stringify(events)).not.toContain('TOP SECRET PROMPT')
  })

  it('does not let a missing binary produce SDK EPIPE stderr diagnostics', async () => {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ['--conditions=__oneworks__', '-r', 'esbuild-register', spawnErrorHarnessPath],
      { cwd: process.cwd(), encoding: 'utf8' }
    )
    const events = JSON.parse(stdout) as AdapterOutputEvent[]
    expect(stderr).toBe('')
    expect(JSON.stringify(events)).not.toContain('ACP write error')
    expect(JSON.stringify(events)).not.toContain('DO NOT EXPOSE THIS PROMPT')
    expect(events.filter(event => event.type === 'error')).toHaveLength(1)
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'error', data: expect.objectContaining({ fatal: true }) }),
      expect.objectContaining({ type: 'exit', data: expect.objectContaining({ exitCode: 1 }) })
    ]))
  }, 15_000)

  it('does not leak an unhandled rejection when a true-equivalent child exits after spawn', async () => {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        '--unhandled-rejections=strict',
        '--conditions=__oneworks__',
        '-r',
        'esbuild-register',
        startupExitHarnessPath
      ],
      { cwd: process.cwd(), encoding: 'utf8' }
    )
    const result = JSON.parse(stdout) as {
      cacheSize: number
      events: AdapterOutputEvent[]
      logs: string[]
    }
    expect(stderr).toBe('')
    expect(result.cacheSize).toBe(0)
    expect(result.logs.join('')).not.toContain('STARTUP_HARNESS_SECRET')
    expect(JSON.stringify(result.events)).not.toContain('STARTUP_HARNESS_SECRET')
    expect(result.events.map(event => event.type)).toEqual(['error', 'exit'])
    expect(result.events[0]).toEqual(expect.objectContaining({ data: expect.objectContaining({ fatal: true }) }))
    expect(result.events[1]).toEqual(expect.objectContaining({ data: expect.objectContaining({ exitCode: 1 }) }))
  }, 15_000)

  it('pipes a prompt larger than ARG_MAX exactly over fresh JSON stdin without argv exposure', async () => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-large-stdin-'))
    const argsPath = join(tempDir, 'args.jsonl')
    const stdinPath = join(tempDir, 'stdin.txt')
    const prompt = `ARG_MAX_SECRET_${'x'.repeat(600_000)}`
    const events: AdapterOutputEvent[] = []
    const session = await createClineSession(
      createCtx(
        tempDir,
        {
          CLINE_FAKE_ARGS_PATH: argsPath,
          CLINE_FAKE_STDIN_PATH: stdinPath,
          CLINE_FAKE_VERSION: '3.0.55'
        },
        undefined,
        'path'
      ).ctx,
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'cline-large-stdin',
        description: prompt,
        permissionMode: 'dontAsk',
        onEvent: event => events.push(event)
      }
    )
    await waitFor(() => events.some(event => event.type === 'stop'))
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))

    const invocations = (await readFile(argsPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as string[])
    expect(invocations).toHaveLength(2)
    expect(invocations.flat()).not.toContain(prompt)
    expect(invocations[1]).not.toContain('ARG_MAX_SECRET_')
    expect(await readFile(stdinPath, 'utf8')).toBe(prompt)
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'message',
        data: expect.objectContaining({ content: `fresh-bytes:${prompt.length}` })
      })
    ]))
  })

  it('settles an unresponsive active fresh child exactly once and rejects post-stop sends', async () => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-fresh-stop-'))
    const argsPath = join(tempDir, 'args.jsonl')
    const stdinPath = join(tempDir, 'stdin.txt')
    const events: AdapterOutputEvent[] = []
    const session = await createClineSession(
      createCtx(
        tempDir,
        {
          CLINE_FAKE_ARGS_PATH: argsPath,
          CLINE_FAKE_MODE: 'fresh-unresponsive',
          CLINE_FAKE_STDIN_PATH: stdinPath,
          CLINE_FAKE_VERSION: '3.0.55'
        },
        undefined,
        'path'
      ).ctx,
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'cline-fresh-stop',
        permissionMode: 'dontAsk',
        onEvent: event => events.push(event)
      }
    )
    session.emit({ type: 'message', content: [{ type: 'text', text: 'stop-me' }] })
    await waitFor(() => existsSync(stdinPath))
    session.stop?.()
    session.stop?.()
    session.emit({ type: 'message', content: [{ type: 'text', text: 'must-not-run' }] })
    await waitFor(() => events.some(event => event.type === 'exit'))
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
    expect(events.find(event => event.type === 'exit')).toEqual(expect.objectContaining({
      data: expect.objectContaining({ exitCode: 0 })
    }))
    expect((await readFile(argsPath, 'utf8')).trim().split('\n')).toHaveLength(2)
  }, 15_000)

  it('settles a fresh JSON spawn error once without placing its prompt in diagnostics', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-fresh-spawn-'))
    const events: AdapterOutputEvent[] = []
    const redactor = new ClineRedactor({})
    const session = createFreshJsonClineSession(
      {
        args: ['--acp', '--auto-approve', 'false'],
        binaryPath: join(tempDir, 'missing-cline'),
        configDir: join(tempDir, 'config'),
        cwd: tempDir,
        dataDir: join(tempDir, 'data'),
        credentialMode: 'none',
        hooksDir: join(tempDir, 'hooks'),
        source: 'path',
        spawnEnv: { PATH: process.env.PATH ?? '' }
      },
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'cline-fresh-spawn',
        permissionMode: 'dontAsk',
        onEvent: event => events.push(event)
      },
      event => events.push(event),
      redactor
    )
    session.emit({ type: 'message', content: [{ type: 'text', text: 'FRESH SPAWN SECRET PROMPT' }] })
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(events.filter(event => event.type === 'error')).toHaveLength(1)
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
    expect(JSON.stringify(events)).not.toContain('FRESH SPAWN SECRET PROMPT')
  })

  it('maps only verified noninteractive permission modes to fresh JSON argv', () => {
    const prepared: ClinePreparedSession = {
      args: ['--acp', '--auto-approve', 'false', '--plan'],
      binaryPath: fixturePath,
      configDir: '/tmp/config',
      cwd: '/tmp/workspace',
      dataDir: '/tmp/data',
      credentialMode: 'none',
      hooksDir: '/tmp/hooks',
      source: 'path' as const,
      spawnEnv: {}
    }
    for (const mode of ['dontAsk', 'bypassPermissions'] as const) {
      const args = buildClineFreshJsonArgs(prepared, mode)
      expect(args).toContain('--yolo')
      expect(args).not.toContain('--auto-approve')
      expect(args).not.toContain('--acp')
    }
    const planArgs = buildClineFreshJsonArgs(prepared, 'plan')
    expect(planArgs).toContain('--plan')
    expect(planArgs).not.toContain('--yolo')
    for (const mode of ['default', 'acceptEdits', undefined] as const) {
      expect(() => buildClineFreshJsonArgs(prepared, mode)).toThrow(/cannot represent One Works permission mode/u)
    }
  })

  it.each(
    [
      ['fresh-run-result-only', ['fresh:coherent'], false],
      ['fresh-fragmented', ['fresh:c', 'fresh:coherent'], false],
      ['fresh-mismatch', ['streamed'], true]
    ] as const
  )('reconciles fresh structured output mode %s without duplicate final bubbles', async (
    mode,
    expectedText,
    shouldFail
  ) => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), `ow-cline-${mode}-`))
    const events: AdapterOutputEvent[] = []
    const session = createFreshJsonClineSession(
      {
        args: ['--acp', '--auto-approve', 'false'],
        binaryPath: fixturePath,
        configDir: join(tempDir, 'config'),
        cwd: tempDir,
        dataDir: join(tempDir, 'data'),
        credentialMode: 'none',
        hooksDir: join(tempDir, 'hooks'),
        source: 'path',
        spawnEnv: {
          CLINE_FAKE_MODE: mode,
          PATH: process.env.PATH ?? ''
        }
      },
      {
        type: 'create',
        runtime: 'server',
        sessionId: `cline-${mode}`,
        description: 'coherent',
        permissionMode: 'dontAsk',
        onEvent: event => events.push(event)
      },
      event => events.push(event),
      new ClineRedactor({})
    )
    await waitFor(() => events.some(event => event.type === (shouldFail ? 'exit' : 'stop')))
    if (!shouldFail) {
      session.stop?.()
      await waitFor(() => events.some(event => event.type === 'exit'))
    }
    const texts = events.flatMap(event => (
      event.type === 'message' && typeof event.data.content === 'string' ? [event.data.content] : []
    ))
    expect(texts).toEqual(expectedText)
    if (mode === 'fresh-fragmented') {
      const ids = events.flatMap(event => (
        event.type === 'message' && typeof event.data.content === 'string' ? [event.data.id] : []
      ))
      expect(new Set(ids)).toHaveLength(1)
    }
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
    expect(events.some(event => event.type === 'error')).toBe(shouldFail)
  })

  it('preserves fresh text-tool-text chronology while suppressing the repeated final result', async () => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-fresh-interleaved-'))
    const events: AdapterOutputEvent[] = []
    const session = createFreshJsonClineSession(
      {
        args: ['--acp', '--auto-approve', 'false'],
        binaryPath: fixturePath,
        configDir: join(tempDir, 'config'),
        cwd: tempDir,
        dataDir: join(tempDir, 'data'),
        credentialMode: 'none',
        hooksDir: join(tempDir, 'hooks'),
        source: 'path',
        spawnEnv: { CLINE_FAKE_MODE: 'fresh-interleaved', PATH: process.env.PATH ?? '' }
      },
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'cline-fresh-interleaved',
        description: 'unused',
        permissionMode: 'dontAsk',
        onEvent: event => events.push(event)
      },
      event => events.push(event),
      new ClineRedactor({})
    )
    await waitFor(() => events.some(event => event.type === 'stop'))
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))
    const deliverables = events.filter(event => event.type === 'message')
    expect(deliverables.map(event => event.type === 'message' ? event.data.content : undefined)).toEqual([
      'before',
      [expect.objectContaining({ type: 'tool_use', id: 'fresh-tool' })],
      [expect.objectContaining({ type: 'tool_result', tool_use_id: 'fresh-tool' })],
      'after'
    ])
    const textIds = deliverables.flatMap(event => (
      event.type === 'message' && typeof event.data.content === 'string' ? [event.data.id] : []
    ))
    expect(new Set(textIds)).toHaveLength(2)
  })

  it('keeps cumulative ACP text only within each contiguous chronological segment', async () => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-chunks-'))
    const events: AdapterOutputEvent[] = []
    const session = await createClineSession(createCtx(tempDir, {}).ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'cline-chunks',
      description: 'CHUNKS',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'stop'))
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))

    const textMessages = events.filter((event): event is Extract<AdapterOutputEvent, { type: 'message' }> => (
      event.type === 'message' && typeof event.data.content === 'string'
    ))
    expect(textMessages).toHaveLength(3)
    expect(textMessages[0]?.data.id).not.toBe(textMessages[1]?.data.id)
    expect(textMessages[1]?.data.id).toBe(textMessages[2]?.data.id)
    expect(textMessages.map(event => event.data.content)).toEqual([
      'first **',
      'bold**\n```ts\n',
      'bold**\n```ts\nconst ok = true\n```'
    ])
    const toolIndex = events.findIndex(event => (
      event.type === 'message' && Array.isArray(event.data.content) && event.data.content[0]?.type === 'tool_use'
    ))
    expect(events.indexOf(textMessages[0]!)).toBeLessThan(toolIndex)
    expect(toolIndex).toBeLessThan(events.indexOf(textMessages[1]!))
    expect(JSON.stringify(events)).not.toContain('private thought')
  })

  it.each(
    [
      ['dontAsk', 'READ'],
      ['bypassPermissions', 'READ'],
      ['acceptEdits', 'EDIT']
    ] as const
  )('maps %s automatic permission to native allow_once only', async (permissionMode, prompt) => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), `ow-cline-permission-${permissionMode}-`))
    const permissionPath = join(tempDir, 'permission.jsonl')
    const events: AdapterOutputEvent[] = []
    const session = await createClineSession(
      createCtx(tempDir, {
        CLINE_FAKE_PERMISSION_PATH: permissionPath
      }).ctx,
      {
        type: 'create',
        runtime: 'server',
        sessionId: `cline-${permissionMode}`,
        description: prompt,
        permissionMode,
        onEvent: event => events.push(event)
      }
    )
    await waitFor(() => events.some(event => event.type === 'stop'))
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(JSON.parse((await readFile(permissionPath, 'utf8')).trim())).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once-fixture' }
    })
    expect(events.some(event => event.type === 'interaction_request')).toBe(false)
  })

  it('normalizes stored permission decisions to request-scoped native options and never exposes always', async () => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-permission-normalization-'))
    const permissionPath = join(tempDir, 'permission.jsonl')
    const events: AdapterOutputEvent[] = []
    const session = await createClineSession(
      createCtx(tempDir, {
        CLINE_FAKE_PERMISSION_PATH: permissionPath
      }).ctx,
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'cline-permission-normalization',
        description: 'READ',
        onEvent: event => events.push(event)
      }
    )
    await waitFor(() => events.some(event => event.type === 'interaction_request'))
    const request = events.find(event => event.type === 'interaction_request')
    if (request?.type !== 'interaction_request') throw new Error('Missing Cline permission')
    expect(request.data.payload.options).toEqual([
      expect.objectContaining({ value: 'allow_once' }),
      expect.objectContaining({ value: 'deny_once' })
    ])
    expect(JSON.stringify(request)).not.toContain('allow_always')
    await session.respondInteraction?.(request.data.id, 'allow_session')
    await waitFor(() => events.some(event => event.type === 'stop'))
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(JSON.parse((await readFile(permissionPath, 'utf8')).trim())).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once-fixture' }
    })
  })

  it('cancels visibly when Cline omits request-scoped allow_once', async () => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-permission-missing-'))
    const permissionPath = join(tempDir, 'permission.jsonl')
    const events: AdapterOutputEvent[] = []
    const session = await createClineSession(
      createCtx(tempDir, {
        CLINE_FAKE_MODE: 'no-allow-once',
        CLINE_FAKE_PERMISSION_PATH: permissionPath
      }).ctx,
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'cline-permission-missing',
        description: 'READ',
        permissionMode: 'dontAsk',
        onEvent: event => events.push(event)
      }
    )
    await waitFor(() => events.some(event => event.type === 'stop'))
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'error',
        data: expect.objectContaining({ code: 'cline_permission_allow_once_unavailable' })
      })
    ]))
    expect(JSON.parse((await readFile(permissionPath, 'utf8')).trim())).toEqual({
      outcome: { outcome: 'cancelled' }
    })
  })

  it('maps plan mode to the verified flag while keeping native approvals request-scoped', async () => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-plan-'))
    const argsPath = join(tempDir, 'args.jsonl')
    const events: AdapterOutputEvent[] = []
    const session = await createClineSession(createCtx(tempDir, { CLINE_FAKE_ARGS_PATH: argsPath }).ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'cline-plan',
      description: 'READ',
      permissionMode: 'plan',
      onEvent: event => events.push(event)
    })
    await answerNextPermission(session, events)
    await waitFor(() => events.some(event => event.type === 'stop'))
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))
    const args = JSON.parse((await readFile(argsPath, 'utf8')).trim()) as string[]
    expect(args).toEqual(expect.arrayContaining(['--plan', '--auto-approve', 'false']))
  })

  it('omits ACP context usage instead of fabricating token or cost usage', async () => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-usage-'))
    const events: AdapterOutputEvent[] = []
    const session = await createClineSession(createCtx(tempDir, {}).ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'cline-usage',
      description: 'USAGE',
      permissionMode: 'dontAsk',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'stop'))
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(events.filter(event => event.type === 'usage')).toHaveLength(0)
    expect(events.filter(event => event.type === 'error' && event.data.code === 'cline_context_usage_unsupported'))
      .toHaveLength(1)
    expect(JSON.stringify(events)).not.toContain('"inputTokens":100')
    expect(JSON.stringify(events)).not.toContain('"inputTokens":200')
  })

  it('redacts credential values and encoded/token forms from all ACP child-derived events', async () => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-acp-redaction-'))
    const events: AdapterOutputEvent[] = []
    await createClineSession(
      createCtx(tempDir, {
        AWS_SECRET_ACCESS_KEY: 'AWS_SECRET_FIXTURE_LONG',
        AZURE_STORAGE_ACCOUNT_KEY: 'AZURE_SECRET_FIXTURE_LONG'
      }).ctx,
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'cline-acp-redaction',
        description: 'SECRET_ACP',
        onEvent: event => events.push(event)
      }
    )
    await waitFor(() => events.some(event => event.type === 'exit'))
    const serialized = JSON.stringify(events)
    expect(serialized).not.toContain('AWS_SECRET_FIXTURE_LONG')
    expect(serialized).not.toContain(Buffer.from('AWS_SECRET_FIXTURE_LONG').toString('base64'))
    expect(serialized).not.toContain('sk-secretfixture12345678')
    expect(serialized).toContain('[REDACTED]')
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
  })

  it('accepts only verified safe extra options and rejects controlled aliases and smuggling', () => {
    expect(() =>
      validateClineExtraOptions([
        '--thinking=high',
        '--compaction',
        'basic',
        '--retries',
        '3',
        '-t',
        '15',
        '--verbose',
        '-v'
      ])
    ).not.toThrow()
    const rejected = [
      '--acp',
      '--json',
      '--auto-approve',
      '--yolo',
      '--id',
      '--cwd',
      '--system',
      '--provider',
      '--model',
      '--key',
      '--config',
      '--data-dir',
      '--hooks-dir',
      '--worktree',
      '--kanban',
      '--zen',
      '--update',
      '-p',
      '-s',
      '-c',
      '-P',
      '-k',
      '-m',
      '-i',
      '-vp',
      '--provider=secret',
      '--model=service,model',
      '--',
      'positional',
      '--compaction=--id',
      '--timeout',
      '--id'
    ]
    for (const option of rejected) {
      expect(() => validateClineExtraOptions([option])).toThrow(/does not allow extra option/u)
    }
  })

  it('uses official provider argv only and rejects unverified service models before spawn', async () => {
    await chmod(fixturePath, 0o755)
    tempDir = await mkdtemp(join(tmpdir(), 'ow-cline-provider-'))
    const argsPath = join(tempDir, 'args.jsonl')
    const prepared = createCtx(tempDir, { CLINE_FAKE_ARGS_PATH: argsPath })
    prepared.ctx.configs[0]!.adapters!.cline = {
      cli: { source: 'managed' },
      provider: 'native-provider'
    }
    const events: AdapterOutputEvent[] = []
    const session = await createClineSession(prepared.ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'cline-provider',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'init'))
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))
    const args = JSON.parse((await readFile(argsPath, 'utf8')).trim()) as string[]
    expect(args.slice(args.indexOf('--provider'), args.indexOf('--provider') + 2)).toEqual([
      '--provider',
      'native-provider'
    ])

    const rejectedRoot = await mkdtemp(join(tmpdir(), 'ow-cline-model-reject-'))
    await expect(createClineSession(createCtx(rejectedRoot, {}).ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'cline-model-reject',
      model: 'openai,gpt-5',
      onEvent: () => undefined
    })).rejects.toThrow(/only supports its native Default model/u)
    expect(existsSync(join(rejectedRoot, '.oneworks'))).toBe(false)

    const unsafeProviderRoot = await mkdtemp(join(tmpdir(), 'ow-cline-provider-reject-'))
    const unsafe = createCtx(unsafeProviderRoot, {})
    unsafe.ctx.configs[0]!.adapters!.cline = { cli: { source: 'managed' }, provider: '--key' }
    await expect(createClineSession(unsafe.ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'cline-provider-reject',
      onEvent: () => undefined
    })).rejects.toThrow(/Unsafe Cline provider id/u)
    expect(existsSync(join(unsafeProviderRoot, '.oneworks'))).toBe(false)
    await Promise.all([
      rm(rejectedRoot, { recursive: true, force: true }),
      rm(unsafeProviderRoot, { recursive: true, force: true })
    ])
  })
})
