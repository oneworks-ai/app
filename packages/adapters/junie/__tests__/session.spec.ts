/* eslint-disable max-lines -- The fake lifecycle suite verifies one end-to-end transaction matrix. */
import '../src/adapter-config'

import { access, chmod, copyFile, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it } from 'vitest'

import type { AdapterCtx, AdapterOutputEvent, Cache } from '@oneworks/types'

import { createJunieSession } from '#~/runtime/session.js'
import { resolveJunieAdapterConfig } from '#~/runtime/shared.js'

const fakeFixtureUrl = new URL('../__fixtures__/fake-junie.mjs', import.meta.url)

const withProcessPlatform = async <T>(platform: NodeJS.Platform, task: () => Promise<T>) => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { ...descriptor, value: platform })
  try {
    return await task()
  } finally {
    if (descriptor != null) Object.defineProperty(process, 'platform', descriptor)
  }
}

const waitFor = async (predicate: () => boolean, timeoutMs = 5_000) => {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('Timed out waiting for Junie session events')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

const createCtx = (
  cwd: string,
  env: Record<string, string>,
  params: {
    adapterConfig?: Record<string, unknown>
    cachedSessionId?: string
  } = {}
) => {
  const cacheStore = new Map<keyof Cache, Cache[keyof Cache]>()
  if (params.cachedSessionId != null) {
    cacheStore.set('adapter.junie.session', {
      junieSessionId: params.cachedSessionId,
      title: 'OneWorks:existing-session'
    })
  }
  const cacheWrites: Array<{ key: keyof Cache; value: Cache[keyof Cache] }> = []
  const ctx: AdapterCtx = {
    ctxId: 'ctx-junie-session-test',
    cwd,
    env: {
      __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: join(cwd, '.oo'),
      ...env
    },
    cache: {
      get: async <K extends keyof Cache>(key: K) => cacheStore.get(key) as Cache[K] | undefined,
      set: async <K extends keyof Cache>(key: K, value: Cache[K]) => {
        cacheWrites.push({ key, value })
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
    configs: [{ adapters: { junie: params.adapterConfig ?? {} } }, undefined]
  }
  return { cacheStore, cacheWrites, ctx }
}

const readCalls = async (callsPath: string) => (
  (await readFile(callsPath, 'utf8')).trim().split('\n').map(line =>
    JSON.parse(line) as {
      args: string[]
      authPresence: Record<string, boolean>
      env: {
        DBUS_SESSION_BUS_ADDRESS?: string
        HOME?: string
        JUNIE_DATA?: string
        XDG_CONFIG_HOME?: string
        XDG_RUNTIME_DIR?: string
        keys: string[]
      }
    }
  )
)

const expectSingleFatalTermination = (events: AdapterOutputEvent[], code: string) => {
  expect(events.filter(event => event.type === 'error' && event.data.fatal !== false)).toEqual([
    expect.objectContaining({ type: 'error', data: expect.objectContaining({ code, fatal: true }) })
  ])
  expect(events.filter(event => event.type === 'stop')).toHaveLength(1)
  expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
  const fatalIndex = events.findIndex(event => event.type === 'error' && event.data.fatal !== false)
  const stopIndex = events.findIndex(event => event.type === 'stop')
  const exitIndex = events.findIndex(event => event.type === 'exit')
  expect(fatalIndex).toBeGreaterThanOrEqual(0)
  expect(stopIndex).toBeGreaterThan(fatalIndex)
  expect(exitIndex).toBeGreaterThan(stopIndex)
  expect(events.at(-1)).toEqual(expect.objectContaining({
    type: 'exit',
    data: expect.objectContaining({ exitCode: expect.any(Number) })
  }))
}

const readTextTree = async (root: string): Promise<string> => {
  const entries = await readdir(root, { withFileTypes: true })
  const contents = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return readTextTree(path)
    if (!entry.isFile()) return ''
    return readFile(path, 'utf8')
  }))
  return contents.join('\n')
}

describe('junie fake CLI lifecycle', () => {
  let tempDir: string | undefined

  afterEach(async () => {
    if (tempDir != null) await rm(tempDir, { recursive: true, force: true })
    tempDir = undefined
  })

  const prepareFake = async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ow-junie-session-'))
    const binaryPath = join(tempDir, 'fake-junie.mjs')
    await copyFile(fakeFixtureUrl, binaryPath)
    await chmod(binaryPath, 0o755)
    return {
      binaryPath,
      callsPath: (_sessionId: string) => join(tempDir!, '.fake-junie-calls.jsonl'),
      env: {
        __ONEWORKS_PROJECT_ADAPTER_JUNIE_CLI_PATH__: binaryPath
      }
    }
  }

  it('handles chunked events, caches the native id, and resumes stream and direct paths', async () => {
    const fake = await prepareFake()
    const events: AdapterOutputEvent[] = []
    const { cacheStore, ctx } = createCtx(tempDir!, fake.env)
    const session = await createJunieSession(ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'oneworks-junie-1',
      description: 'first turn',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.filter(event => event.type === 'stop').length === 1)
    session.emit({ type: 'message', content: [{ type: 'text', text: 'second turn' }] })
    await waitFor(() => events.filter(event => event.type === 'stop').length === 2)

    const resumedEvents: AdapterOutputEvent[] = []
    await createJunieSession(ctx, {
      type: 'resume',
      runtime: 'cli',
      mode: 'direct',
      sessionId: 'oneworks-junie-1',
      description: 'direct follow-up',
      onEvent: event => resumedEvents.push(event)
    })
    await waitFor(() => resumedEvents.some(event => event.type === 'exit'))

    const calls = await readCalls(fake.callsPath('oneworks-junie-1'))
    expect(calls).toHaveLength(3)
    expect(calls[0].args).not.toContain('--resume')
    expect(calls[0].args).toEqual(expect.arrayContaining(['--output-format', 'json-stream', '--task', 'first turn']))
    expect(calls[0].args).toEqual(expect.arrayContaining([
      '--config-default-locations=false',
      '--mcp-default-locations=false',
      '--skill-default-locations=false',
      '--agent-default-location=false',
      '--command-default-location=false',
      '--model-default-locations=false'
    ]))
    expect(calls[1].args).toEqual(expect.arrayContaining([
      '--session-id=session-fake-native',
      '--resume',
      '--task',
      'second turn'
    ]))
    expect(calls[2].args).toEqual(expect.arrayContaining([
      '--session-id=session-fake-native',
      '--resume',
      '--output-format',
      'text',
      '--task',
      'direct follow-up'
    ]))
    expect(cacheStore.get('adapter.junie.session')).toEqual({
      junieSessionId: 'session-fake-native',
      title: 'OneWorks:oneworks-junie-1'
    })
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'message', data: expect.objectContaining({ content: 'fake response' }) }),
      expect.objectContaining({ type: 'error', data: expect.objectContaining({ fatal: false }) }),
      { type: 'exit', data: { exitCode: 0 } }
    ]))
    expect(calls[0].env.HOME).toContain('/caches/adapter-junie/sessions/oneworks-junie-1/home')
    expect(calls[0].env.JUNIE_DATA).toContain('/caches/adapter-junie/sessions/oneworks-junie-1/data')
    expect(calls[0].env.XDG_CONFIG_HOME).toContain('/caches/adapter-junie/sessions/oneworks-junie-1/home/.config')
  })

  it('passes only minimal runtime and selected-provider auth env without persisting secret values', async () => {
    const fake = await prepareFake()
    const secretValues = {
      JUNIE_API_KEY: 'sentinel-junie-account-token',
      JUNIE_ANTHROPIC_API_KEY: 'sentinel-junie-anthropic-token',
      ANTHROPIC_API_KEY: 'sentinel-anthropic-token',
      JUNIE_OPENAI_API_KEY: 'sentinel-junie-openai-token',
      OPENAI_API_KEY: 'sentinel-openai-token',
      AWS_SECRET_ACCESS_KEY: 'sentinel-aws-token',
      AZURE_OPENAI_API_KEY: 'sentinel-azure-token',
      GITHUB_TOKEN: 'sentinel-github-token',
      INTERNAL_SECRET: 'sentinel-internal-token'
    }
    const events: AdapterOutputEvent[] = []
    const { cacheStore, ctx } = createCtx(tempDir!, {
      ...fake.env,
      ...secretValues,
      __ONEWORKS_PROJECT_JUNIE_HOOK_COMMAND__: 'node sanitized-hook.js',
      __ONEWORKS_PROJECT_JUNIE_NATIVE_HOOKS_AVAILABLE__: '1'
    }, {
      adapterConfig: { provider: 'anthropic' }
    })
    const session = await createJunieSession(ctx, {
      type: 'create',
      runtime: 'server',
      mode: 'stream',
      sessionId: 'oneworks-minimal-env',
      description: 'environment isolation',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.filter(event => event.type === 'stop').length === 1)

    ctx.env.JUNIE_API_KEY = undefined
    ctx.env.JUNIE_ANTHROPIC_API_KEY = undefined
    ctx.env.ANTHROPIC_API_KEY = undefined
    session.emit({ type: 'message', content: [{ type: 'text', text: 'auth refresh turn' }] })
    await waitFor(() => events.filter(event => event.type === 'stop').length === 2)

    const callsPath = fake.callsPath('oneworks-minimal-env')
    const [call, refreshedCall] = await readCalls(callsPath)
    expect(call.authPresence).toEqual(expect.objectContaining({
      JUNIE_API_KEY: true,
      JUNIE_ANTHROPIC_API_KEY: true,
      ANTHROPIC_API_KEY: true,
      JUNIE_OPENAI_API_KEY: false,
      OPENAI_API_KEY: false,
      AWS_SECRET_ACCESS_KEY: false,
      AZURE_OPENAI_API_KEY: false,
      GITHUB_TOKEN: false,
      INTERNAL_SECRET: false
    }))
    expect(call.env.keys).not.toEqual(expect.arrayContaining([
      'NODE_OPTIONS',
      'SSH_AUTH_SOCK',
      '__ONEWORKS_PROJECT_RUNTIME_BROKER_TOKEN__'
    ]))
    expect(call.env.keys).toEqual(expect.arrayContaining([
      'HOME',
      'JUNIE_DATA',
      'JUNIE_HOME',
      'PATH',
      'XDG_CACHE_HOME',
      'XDG_CONFIG_HOME',
      'XDG_DATA_HOME'
    ]))
    expect(refreshedCall.authPresence).toEqual(expect.objectContaining({
      JUNIE_API_KEY: false,
      JUNIE_ANTHROPIC_API_KEY: false,
      ANTHROPIC_API_KEY: false,
      OPENAI_API_KEY: false,
      AWS_SECRET_ACCESS_KEY: false,
      AZURE_OPENAI_API_KEY: false,
      GITHUB_TOKEN: false,
      INTERNAL_SECRET: false
    }))

    const stagedText = await readTextTree(tempDir!)
    const serializedRuntime = JSON.stringify({ events, cache: [...cacheStore.entries()] })
    expect(stagedText).toContain('StopFailure')
    expect(stagedText).toContain('sanitized-hook.js')
    for (const secret of Object.values(secretValues)) {
      expect(stagedText).not.toContain(secret)
      expect(serializedRuntime).not.toContain(secret)
    }
  })

  it('preserves only validated Linux credential-store locators across create and resume children', async () => {
    await withProcessPlatform('linux', async () => {
      const fake = await prepareFake()
      const events: AdapterOutputEvent[] = []
      const runtimeDir = '/run/user/1000'
      const sessionBus = 'unix:path=/run/user/1000/bus,guid=0123456789abcdef0123456789abcdef'
      const { ctx } = createCtx(tempDir!, {
        ...fake.env,
        DBUS_SESSION_BUS_ADDRESS: sessionBus,
        XDG_RUNTIME_DIR: runtimeDir,
        AWS_SECRET_ACCESS_KEY: 'must-not-reach-linux-child',
        GITHUB_TOKEN: 'must-not-reach-linux-child'
      })
      const session = await createJunieSession(ctx, {
        type: 'create',
        runtime: 'server',
        sessionId: 'oneworks-linux-locators',
        description: 'first linux turn',
        onEvent: event => events.push(event)
      })
      await waitFor(() => events.filter(event => event.type === 'stop').length === 1)
      session.emit({ type: 'message', content: [{ type: 'text', text: 'resume linux turn' }] })
      await waitFor(() => events.filter(event => event.type === 'stop').length === 2)

      const calls = await readCalls(fake.callsPath('oneworks-linux-locators'))
      expect(calls).toHaveLength(2)
      for (const call of calls) {
        expect(call.env.DBUS_SESSION_BUS_ADDRESS).toBe(sessionBus)
        expect(call.env.XDG_RUNTIME_DIR).toBe(runtimeDir)
        expect(call.env.keys).not.toEqual(expect.arrayContaining(['AWS_SECRET_ACCESS_KEY', 'GITHUB_TOKEN']))
      }
      expect(calls[1].args).toEqual(expect.arrayContaining([
        '--session-id=session-fake-native',
        '--resume'
      ]))
    })
  })

  it('scrubs nested and embedded configContent credentials from create and resume persistence', async () => {
    const fake = await prepareFake()
    const secrets = [
      'sentinel-byok-openai-secret',
      'sentinel-byok-anthropic-secret',
      'sentinel-embedded-secret',
      'sentinel-raw-secret'
    ]
    const configContent = {
      theme: 'dark',
      tokenBudget: 4096,
      byok: {
        provider: 'openai',
        openai: {
          apiKey: secrets[0],
          baseUrl: 'https://api.example.test/v1',
          model: 'verified-model'
        },
        anthropic: secrets[1]
      },
      embedded: JSON.stringify({
        nested: { authorization: `Bearer ${secrets[2]}`, enabled: true }
      }),
      raw: `apiKey=${secrets[3]}`,
      nested: { featureEnabled: true, label: 'legitimate content' }
    }
    const events: AdapterOutputEvent[] = []
    const { cacheStore, ctx } = createCtx(tempDir!, {
      ...fake.env,
      __ONEWORKS_PROJECT_JUNIE_HOOK_COMMAND__: 'node sanitized-hook.js',
      __ONEWORKS_PROJECT_JUNIE_NATIVE_HOOKS_AVAILABLE__: '1'
    }, {
      adapterConfig: { configContent }
    })
    const session = await createJunieSession(ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'oneworks-config-scrub',
      description: 'config scrub create',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.filter(event => event.type === 'stop').length === 1)
    session.emit({ type: 'message', content: [{ type: 'text', text: 'config scrub resume' }] })
    await waitFor(() => events.filter(event => event.type === 'stop').length === 2)

    const originalRuntimeConfig = resolveJunieAdapterConfig(ctx).configContent as Record<string, unknown>
    expect((originalRuntimeConfig.byok as Record<string, unknown>).anthropic).toBe(secrets[1])
    const configPath = join(
      tempDir!,
      '.oo',
      'caches',
      'adapter-junie',
      'sessions',
      'oneworks-config-scrub',
      'config',
      'oneworks.json'
    )
    const persisted = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>
    expect(persisted).toEqual(expect.objectContaining({
      theme: 'dark',
      tokenBudget: 4096,
      nested: { featureEnabled: true, label: 'legitimate content' },
      byok: {
        provider: 'openai',
        openai: {
          baseUrl: 'https://api.example.test/v1',
          model: 'verified-model'
        }
      },
      hooks: expect.any(Object)
    }))
    expect(JSON.parse(String(persisted.embedded))).toEqual({ nested: { enabled: true } })
    expect(persisted).not.toHaveProperty('raw')

    const stagedText = await readTextTree(tempDir!)
    const serializedRuntime = JSON.stringify({ events, cache: [...cacheStore.entries()] })
    for (const secret of secrets) {
      expect(stagedText).not.toContain(secret)
      expect(serializedRuntime).not.toContain(secret)
    }
    const calls = await readCalls(fake.callsPath('oneworks-config-scrub'))
    expect(calls).toHaveLength(2)
    expect(calls[1].args).toEqual(expect.arrayContaining([
      '--session-id=session-fake-native',
      '--resume'
    ]))
  })

  it.each<[
    string,
    { adapterConfig?: Record<string, unknown>; requestEffort?: 'max' }
  ]>([
    ['request', { requestEffort: 'max' }],
    ['persisted config', { adapterConfig: { effort: 'max' } }]
  ])('rejects an unsupported %s effort before spawning the CLI', async (_label, setup) => {
    const fake = await prepareFake()
    const events: AdapterOutputEvent[] = []
    const { cacheWrites, ctx } = createCtx(tempDir!, fake.env, {
      adapterConfig: setup.adapterConfig
    })

    await expect(createJunieSession(ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'oneworks-invalid-effort',
      description: 'must not spawn',
      effort: setup.requestEffort,
      onEvent: event => events.push(event)
    })).rejects.toThrow('supports only low, medium, high effort')
    await expect(readFile(fake.callsPath('oneworks-invalid-effort'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
    expect(events).toEqual([])
    expect(cacheWrites).toEqual([])
  })

  it.each([
    ['split', ['--effort', 'max']],
    ['equal', ['--effort=max']],
    ['repeated', ['--effort=low', '--effort=high']],
    ['case', ['--EFFORT=high']],
    ['short alias', ['-e=max']],
    ['attached short alias', ['-emax']],
    ['compatibility alias', ['-effort', 'high']],
    ['terminator', ['--', '--effort=high']]
  ])('rejects a %s advanced effort override before prepare or spawn', async (_label, extraOptions) => {
    const fake = await prepareFake()
    const events: AdapterOutputEvent[] = []
    const { cacheWrites, ctx } = createCtx(tempDir!, fake.env)

    await expect(createJunieSession(ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'oneworks-invalid-extra-effort',
      description: 'must not spawn',
      effort: 'medium',
      extraOptions,
      onEvent: event => events.push(event)
    })).rejects.toThrow('does not allow controlled or credential option')
    await expect(readFile(fake.callsPath('oneworks-invalid-extra-effort'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(access(join(tempDir!, '.oo', 'caches', 'adapter-junie'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    expect(events).toEqual([])
    expect(cacheWrites).toEqual([])
  })

  it.each([
    ['model split', ['--model', 'override-model']],
    ['model equal/case', ['--MoDeL=override-model']],
    ['model repeated', ['--model=one', '--model=two']],
    ['provider split', ['--provider', 'openai']],
    ['provider equal/case', ['--PrOvIdEr=openai']],
    ['review equal', ['--review=false']],
    ['agent mode split', ['--agent-mode', 'classic']],
    ['skip update equal/case', ['--SKIP-UPDATE-CHECK=false']],
    ['statistics split', ['--share-anonymous-statistics', 'true']],
    ['statistics repeated', ['--share-anonymous-statistics=true', '--share-anonymous-statistics=false']],
    ['project alias', ['-p', '/tmp/override']],
    ['project attached alias', ['-p/tmp/override']],
    ['cache alias equal', ['-c=/tmp/override']],
    ['cache attached alias', ['-c/tmp/override']],
    ['auth alias/case', ['-A', 'credential']],
    ['auth attached alias/case', ['-ACredential']],
    ['argument terminator', ['--', '--model=override-model']]
  ])('rejects a %s adapter-owned advanced option before prepare or spawn', async (_label, extraOptions) => {
    const fake = await prepareFake()
    const events: AdapterOutputEvent[] = []
    const { cacheWrites, ctx } = createCtx(tempDir!, fake.env, {
      adapterConfig: {
        provider: 'anthropic',
        review: true,
        agentMode: 'chat',
        disableAutoUpdate: true,
        shareAnonymousStatistics: false
      }
    })

    await expect(createJunieSession(ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'oneworks-controlled-extra',
      description: 'must not spawn',
      model: 'selected-model',
      extraOptions,
      onEvent: event => events.push(event)
    })).rejects.toThrow('does not allow controlled or credential option')
    await expect(readFile(fake.callsPath('oneworks-controlled-extra'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(access(join(tempDir!, '.oo', 'caches', 'adapter-junie'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    expect(events).toEqual([])
    expect(cacheWrites).toEqual([])
  })

  it.each(['session-only', 'step-only', 'assistant-eof', 'missing-result', 'create-failure-after-session'])(
    'rejects an exit-zero %s stream without a confirmed result event',
    async scenario => {
      const fake = await prepareFake()
      const events: AdapterOutputEvent[] = []
      const { cacheStore, cacheWrites, ctx } = createCtx(tempDir!, fake.env)
      await createJunieSession(ctx, {
        type: 'create',
        runtime: 'server',
        mode: 'stream',
        sessionId: `oneworks-${scenario}`,
        description: `scenario:${scenario}`,
        onEvent: event => events.push(event)
      })
      await waitFor(() => events.some(event => event.type === 'exit'))

      expectSingleFatalTermination(events, 'junie_protocol_incomplete_stream')
      expect(events.at(-1)).toEqual({ type: 'exit', data: { exitCode: 1 } })
      expect(cacheWrites).toEqual([])
      expect(cacheStore.get('adapter.junie.session')).toBeUndefined()
    }
  )

  it.each([
    ['result-missing-result', 'junie_protocol_invalid_result'],
    ['result-missing-error-code', 'junie_protocol_invalid_result'],
    ['result-invalid-error-code', 'junie_protocol_invalid_result'],
    ['result-invalid-usage', 'junie_protocol_invalid_result'],
    ['result-late-invalid', 'junie_protocol_invalid_result'],
    ['truncated-result', 'junie_protocol_invalid_json']
  ])('rejects a malformed create terminal %s without committing its tentative id', async (scenario, code) => {
    const fake = await prepareFake()
    const events: AdapterOutputEvent[] = []
    const { cacheStore, cacheWrites, ctx } = createCtx(tempDir!, fake.env)
    await createJunieSession(ctx, {
      type: 'create',
      runtime: 'server',
      mode: 'stream',
      sessionId: `oneworks-${scenario}`,
      description: `scenario:${scenario}`,
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'exit'))

    expectSingleFatalTermination(events, code)
    expect(cacheWrites).toEqual([])
    expect(cacheStore.get('adapter.junie.session')).toBeUndefined()
  })

  it.each([
    'result-missing-result',
    'result-missing-error-code',
    'result-invalid-error-code',
    'result-invalid-usage',
    'result-late-invalid',
    'truncated-result'
  ])('keeps the exact cached id when resume receives malformed terminal %s', async scenario => {
    const fake = await prepareFake()
    const events: AdapterOutputEvent[] = []
    const { cacheStore, cacheWrites, ctx } = createCtx(tempDir!, fake.env, {
      cachedSessionId: 'session-fake-native'
    })
    await createJunieSession(ctx, {
      type: 'resume',
      runtime: 'server',
      mode: 'stream',
      sessionId: `oneworks-resume-${scenario}`,
      description: `scenario:${scenario}`,
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'exit'))

    expectSingleFatalTermination(
      events,
      scenario === 'truncated-result' ? 'junie_protocol_invalid_json' : 'junie_protocol_invalid_result'
    )
    expect(cacheWrites).toEqual([])
    expect(cacheStore.get('adapter.junie.session')).toEqual({
      junieSessionId: 'session-fake-native',
      title: 'OneWorks:existing-session'
    })
    const [call] = await readCalls(fake.callsPath(`oneworks-resume-${scenario}`))
    expect(call.args).toEqual(expect.arrayContaining([
      '--session-id=session-fake-native',
      '--resume'
    ]))
  })

  it('accepts result followed by ordinary late events without projecting late output', async () => {
    const fake = await prepareFake()
    const events: AdapterOutputEvent[] = []
    const { cacheStore, ctx } = createCtx(tempDir!, fake.env)
    await createJunieSession(ctx, {
      type: 'create',
      runtime: 'server',
      mode: 'stream',
      sessionId: 'oneworks-result-late-ordinary',
      description: 'scenario:result-late-ordinary',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'exit'))

    expect(events.at(-1)).toEqual({ type: 'exit', data: { exitCode: 0 } })
    expect(events.filter(event => event.type === 'stop')).toHaveLength(1)
    expect(JSON.stringify(events)).not.toContain('must be ignored after result')
    expect(cacheStore.get('adapter.junie.session')).toEqual(expect.objectContaining({
      junieSessionId: 'session-fake-native'
    }))
  })

  it('fails a late unknown terminal event and does not commit its tentative session id', async () => {
    const fake = await prepareFake()
    const events: AdapterOutputEvent[] = []
    const { cacheStore, cacheWrites, ctx } = createCtx(tempDir!, fake.env)
    await createJunieSession(ctx, {
      type: 'create',
      runtime: 'server',
      mode: 'stream',
      sessionId: 'oneworks-late-terminal',
      description: 'scenario:late-unknown-terminal',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'exit'))

    expectSingleFatalTermination(events, 'junie_protocol_unknown_terminal')
    expect(cacheWrites).toEqual([])
    expect(cacheStore.get('adapter.junie.session')).toBeUndefined()
  })

  it('requires a successful result to expose a native session id', async () => {
    const fake = await prepareFake()
    const events: AdapterOutputEvent[] = []
    const { cacheWrites, ctx } = createCtx(tempDir!, fake.env)
    await createJunieSession(ctx, {
      type: 'create',
      runtime: 'server',
      mode: 'stream',
      sessionId: 'oneworks-result-without-session',
      description: 'scenario:result-without-session',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'exit'))

    expectSingleFatalTermination(events, 'junie_session_id_missing')
    expect(cacheWrites).toEqual([])
  })

  it.each([
    ['truncated', 'junie_protocol_invalid_json'],
    ['nonzero', 'junie_process_exit'],
    ['result-nonzero', 'junie_process_exit'],
    ['error-after-session', 'junie_cli_error'],
    ['empty-stream', 'junie_protocol_empty_stream']
  ])('surfaces %s stream failures', async (scenario, expectedCode) => {
    const fake = await prepareFake()
    const events: AdapterOutputEvent[] = []
    const { cacheStore, cacheWrites, ctx } = createCtx(tempDir!, fake.env)
    await createJunieSession(ctx, {
      type: 'create',
      runtime: 'server',
      mode: 'stream',
      sessionId: `oneworks-${scenario}`,
      description: `scenario:${scenario}`,
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'error',
      data: expect.objectContaining({ code: expectedCode, fatal: true })
    }))
    expect(events.at(-1)).toEqual(expect.objectContaining({
      type: 'exit',
      data: expect.objectContaining({ exitCode: expect.any(Number) })
    }))
    expectSingleFatalTermination(events, expectedCode)
    expect(cacheWrites).toEqual([])
    expect(cacheStore.get('adapter.junie.session')).toBeUndefined()
  })

  it('keeps a cached resume id unchanged when Junie emits a different id', async () => {
    const fake = await prepareFake()
    const events: AdapterOutputEvent[] = []
    const { cacheStore, cacheWrites, ctx } = createCtx(tempDir!, fake.env, {
      cachedSessionId: 'session-fake-native'
    })
    await createJunieSession(ctx, {
      type: 'resume',
      runtime: 'server',
      mode: 'stream',
      sessionId: 'oneworks-resume-mismatch',
      description: 'scenario:resume-mismatch',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'exit'))

    expectSingleFatalTermination(events, 'junie_protocol_session_id_mismatch')
    expect(cacheWrites).toEqual([])
    expect(cacheStore.get('adapter.junie.session')).toEqual({
      junieSessionId: 'session-fake-native',
      title: 'OneWorks:existing-session'
    })
    const [call] = await readCalls(fake.callsPath('oneworks-resume-mismatch'))
    expect(call.args).toEqual(expect.arrayContaining([
      '--session-id=session-fake-native',
      '--resume'
    ]))
  })

  it('keeps direct create explicit and reports that its native id is unobservable', async () => {
    const fake = await prepareFake()
    const events: AdapterOutputEvent[] = []
    const { cacheStore, cacheWrites, ctx } = createCtx(tempDir!, fake.env)
    await createJunieSession(ctx, {
      type: 'create',
      runtime: 'cli',
      mode: 'direct',
      sessionId: 'oneworks-direct-create',
      description: 'direct create',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'exit'))
    const [call] = await readCalls(fake.callsPath('oneworks-direct-create'))
    expect(call.args).not.toContain('--resume')
    expect(call.args.some(arg => arg.startsWith('--session-id'))).toBe(false)
    expect(events).toContainEqual(expect.objectContaining({
      type: 'error',
      data: expect.objectContaining({
        code: 'junie_direct_session_id_unobservable',
        fatal: false
      })
    }))
    expect(cacheWrites).toEqual([])
    expect(cacheStore.get('adapter.junie.session')).toBeUndefined()
  })

  it('cancels a running CLI and releases the child process', async () => {
    const fake = await prepareFake()
    const events: AdapterOutputEvent[] = []
    const { cacheStore, cacheWrites, ctx } = createCtx(tempDir!, fake.env)
    const session = await createJunieSession(ctx, {
      type: 'create',
      runtime: 'server',
      mode: 'stream',
      sessionId: 'oneworks-cancel',
      description: 'scenario:spawn-hang',
      onEvent: event => events.push(event)
    })
    await waitFor(() => session.pid != null)
    session.kill()
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(events.at(-1)).toEqual({ type: 'exit', data: { exitCode: 130 } })
    expect(cacheWrites).toEqual([])
    expect(cacheStore.get('adapter.junie.session')).toBeUndefined()
  })

  it('reports spawn errors and ignores repeated terminal output', async () => {
    const fake = await prepareFake()
    const duplicateEvents: AdapterOutputEvent[] = []
    const { cacheStore, cacheWrites, ctx } = createCtx(tempDir!, fake.env)
    await createJunieSession(ctx, {
      type: 'create',
      runtime: 'server',
      mode: 'stream',
      sessionId: 'oneworks-duplicate',
      description: 'scenario:duplicate-terminal',
      onEvent: event => duplicateEvents.push(event)
    })
    await waitFor(() => duplicateEvents.some(event => event.type === 'exit'))
    expect(duplicateEvents.filter(event => event.type === 'stop')).toHaveLength(1)
    const cacheBeforeSpawnError = cacheStore.get('adapter.junie.session')
    const writeCountBeforeSpawnError = cacheWrites.length

    const spawnEvents: AdapterOutputEvent[] = []
    ctx.env.__ONEWORKS_PROJECT_ADAPTER_JUNIE_CLI_PATH__ = join(tempDir!, 'missing-junie')
    await createJunieSession(ctx, {
      type: 'create',
      runtime: 'server',
      mode: 'stream',
      sessionId: 'oneworks-spawn-error',
      description: 'spawn',
      onEvent: event => spawnEvents.push(event)
    })
    await waitFor(() => spawnEvents.some(event => event.type === 'exit'))
    expectSingleFatalTermination(spawnEvents, 'junie_spawn_error')
    expect(cacheWrites).toHaveLength(writeCountBeforeSpawnError)
    expect(cacheStore.get('adapter.junie.session')).toEqual(cacheBeforeSpawnError)
  })
})
