import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { run } from '#~/run.js'
import { JUNIE_AUTH_ENV_KEYS } from '@oneworks/adapter-junie/auth-env'
import type { AdapterCtx, AdapterOutputEvent, AssetDiagnostic, Config, WorkspaceAssetBundle } from '@oneworks/types'
import { getCachePath, setCache } from '@oneworks/utils/cache'
import type { Logger } from '@oneworks/utils/create-logger'
import { resolveDroidAdapterConfig } from '../../adapters/droid/src/runtime/adapter-config'

import gooseAdapter from '../../adapters/goose/src/index'

import { createQwenRuntimeRedactor } from '../../adapters/qwen-code/src/runtime/session/shared.js'

const {
  prepareMock,
  loadAdapterMock,
  callHookMock,
  createAdapterHookBridgeMock,
  initMock,
  queryMock
} = vi.hoisted(() => ({
  prepareMock: vi.fn(),
  loadAdapterMock: vi.fn(),
  callHookMock: vi.fn(),
  createAdapterHookBridgeMock: vi.fn(),
  initMock: vi.fn(),
  queryMock: vi.fn()
}))

vi.mock('#~/prepare.js', () => ({
  prepare: prepareMock
}))

vi.mock('@oneworks/types', () => ({
  defineAdapter: (adapter: unknown) => adapter,
  NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES: 50 * 1024 * 1024,
  loadAdapter: loadAdapterMock,
  resolveAdapterRuntimeTarget: (adapterKey: string, options?: { config?: { adapters?: Record<string, unknown> } }) => {
    const adapterConfig = options?.config?.adapters?.[adapterKey]
    const packageId = adapterConfig != null && typeof adapterConfig === 'object' && !Array.isArray(adapterConfig)
      ? (adapterConfig as Record<string, unknown>).packageId
      : undefined
    const loadSpecifier = typeof packageId === 'string' && packageId.trim() !== ''
      ? packageId.trim()
      : adapterKey
    const runtimeAdapter = loadSpecifier === '@oneworks/adapter-codex'
      ? 'codex'
      : loadSpecifier === '@oneworks/adapter-junie' || loadSpecifier === 'adapter-junie'
      ? 'junie'
      : loadSpecifier === '@oneworks/adapter-dsh'
      ? 'dsh'
      : adapterKey
    return {
      instanceKey: adapterKey,
      loadSpecifier,
      runtimeAdapter,
      ...(typeof packageId === 'string' ? { packageId } : {})
    }
  },
  sanitizePackageName: (packageName: string) => packageName.replace(/^@/, '').replace(/[\\/]/g, '__')
}))

vi.mock('@oneworks/hooks', () => ({
  callHook: callHookMock,
  createAdapterHookBridge: createAdapterHookBridgeMock
}))

type TestCtx = AdapterCtx & {
  assets: WorkspaceAssetBundle
}

const createLogger = (): Logger => ({
  stream: new PassThrough(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
})

const createAssets = (): WorkspaceAssetBundle => ({
  cwd: '/tmp/project',
  pluginConfigs: undefined,
  pluginInstances: [],
  assets: [],
  rules: [],
  specs: [],
  entities: [],
  skills: [],
  channelLinks: [],
  workspaces: [],
  mcpServers: {},
  hookPlugins: [],
  opencodeOverlayAssets: [],
  defaultIncludeMcpServers: [],
  defaultExcludeMcpServers: []
})

const createAdapters = (adapters: Record<string, unknown>) => (
  adapters as NonNullable<NonNullable<AdapterCtx['configs'][0]>['adapters']>
)

const tempDirs: string[] = []

const createCtx = (): TestCtx => ({
  ctxId: 'ctx-1',
  cwd: '/tmp/project',
  env: {},
  cache: {
    set: vi.fn().mockResolvedValue({ cachePath: '/tmp/project/.oo/cache/base.json' }),
    get: vi.fn()
  } as AdapterCtx['cache'],
  logger: createLogger(),
  configs: [
    {
      adapters: createAdapters({
        codex: {}
      })
    },
    undefined
  ] as unknown as AdapterCtx['configs'],
  assets: createAssets()
})

describe('task run adapter init', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    initMock.mockResolvedValue(undefined)
    queryMock.mockResolvedValue({
      kill: vi.fn(),
      emit: vi.fn()
    })
    loadAdapterMock.mockResolvedValue({
      init: initMock,
      query: queryMock
    })
    createAdapterHookBridgeMock.mockReturnValue({
      start: vi.fn().mockResolvedValue(undefined),
      prepareInitialPrompt: vi.fn(async (prompt?: string) => prompt),
      wrapSession: vi.fn((session: unknown) => session),
      enqueueAfterPendingHooks: vi.fn(),
      handleOutput: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined)
    })
    callHookMock.mockResolvedValue({ continue: true })
  })

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  it('runs adapter init before query', async () => {
    const ctx = createCtx()
    prepareMock.mockResolvedValue([ctx])

    await run({
      adapter: 'codex',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-cli',
      description: 'hello',
      onEvent: vi.fn()
    })

    expect(loadAdapterMock).toHaveBeenCalledWith('codex')
    expect(initMock).toHaveBeenCalledTimes(1)
    expect(initMock).toHaveBeenCalledWith(ctx)
    expect(queryMock).toHaveBeenCalledTimes(1)
    const initCallOrder = initMock.mock.invocationCallOrder[0]
    const queryCallOrder = queryMock.mock.invocationCallOrder[0]
    expect(initCallOrder).toBeDefined()
    expect(queryCallOrder).toBeDefined()
    if (initCallOrder == null || queryCallOrder == null) {
      throw new Error('expected init and query to be invoked')
    }
    expect(initCallOrder).toBeLessThan(queryCallOrder)
  })

  it('does not persist the runtime-only shared-model capability in task cache', async () => {
    const ctx = createCtx()
    ctx.env.__ONEWORKS_PROJECT_CODEX_SHARED_MODEL_TOKEN__ = 'runtime-secret'
    ctx.configs = [{
      adapters: createAdapters({ codex: {} }),
      modelServices: {
        'oneworks-codex': {
          apiBaseUrl: 'http://127.0.0.1:8787/api/internal/codex-shared-model/v1',
          apiKey: 'runtime-secret',
          models: ['gpt-example']
        }
      }
    }, undefined]
    ctx.configState = {
      mergedConfig: ctx.configs[0]!
    }
    prepareMock.mockResolvedValue([ctx])

    await run({ adapter: 'codex', cwd: ctx.cwd, env: {} }, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-no-capability-cache',
      description: 'hello',
      onEvent: vi.fn()
    })

    const cached = (ctx.cache.set as ReturnType<typeof vi.fn>).mock.calls
      .find(([key]) => key === 'base')?.[1]
    expect(JSON.stringify(cached)).not.toContain('runtime-secret')
    expect(JSON.stringify(cached)).not.toContain('/api/internal/codex-shared-model')
  })

  it('keeps the DeepSeek API key live without persisting it in task cache', async () => {
    const ctx = createCtx()
    ctx.env.DEEPSEEK_API_KEY = 'deepseek-runtime-secret'
    ctx.env.DEEPSEEK_BASE_URL = 'https://example.invalid/v1'
    const secretConfig = {
      adapters: createAdapters({
        dsh: { baseUrl: 'https://config-secret.example.invalid/v1' },
        review: {
          packageId: '@oneworks/adapter-dsh',
          baseUrl: 'https://alias-secret.example.invalid/v1'
        }
      } as any),
      env: {
        DEEPSEEK_API_KEY: 'deepseek-runtime-secret',
        DEEPSEEK_BASE_URL: 'https://example.invalid/v1'
      }
    }
    ctx.configs = [secretConfig, undefined]
    ctx.configState = {
      effectiveProjectConfig: secretConfig,
      projectConfig: secretConfig,
      userConfig: undefined,
      mergedConfig: secretConfig,
      globalConfig: secretConfig,
      globalSource: {
        rawConfig: secretConfig,
        resolvedConfig: secretConfig,
        resolvedExtendSources: [{ rawConfig: secretConfig, resolvedConfig: secretConfig }]
      }
    } as any
    prepareMock.mockResolvedValue([ctx])

    await run({ adapter: 'dsh', cwd: ctx.cwd, env: {} }, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-dsh-secret-boundary',
      description: 'hello',
      onEvent: vi.fn()
    })

    const cached = (ctx.cache.set as ReturnType<typeof vi.fn>).mock.calls
      .find(([key]) => key === 'base')?.[1]
    expect(JSON.stringify(cached)).not.toContain('deepseek-runtime-secret')
    expect(JSON.stringify(cached)).not.toContain('example.invalid')
    expect(JSON.stringify(cached)).not.toContain('config-secret')
    expect(JSON.stringify(cached)).not.toContain('alias-secret')
    expect(queryMock.mock.calls[0]?.[0].env.DEEPSEEK_API_KEY).toBe('deepseek-runtime-secret')
    expect(queryMock.mock.calls[0]?.[0].env.DEEPSEEK_BASE_URL).toContain('example.invalid')
    expect(ctx.env.DEEPSEEK_API_KEY).toBe('deepseek-runtime-secret')
    expect(ctx.env.DEEPSEEK_BASE_URL).toContain('example.invalid')
  })

  it('keeps a Cline startup failure out of cache/log/hook boundaries, runs TaskStop, and permits retry', async () => {
    const ctx = createCtx()
    const credential = 'cline-task-secret-value'
    const sensitiveValues = [
      credential,
      '/private/aws-shared-credentials',
      '/private/google-application-credentials.json',
      'git-internal-secret-value'
    ]
    createAdapterHookBridgeMock.mockReturnValue({
      start: vi.fn().mockResolvedValue(undefined),
      prepareInitialPrompt: vi.fn(async (prompt?: string) => prompt),
      wrapSession: vi.fn((session: unknown) => session),
      enqueueAfterPendingHooks: vi.fn((runHook: () => Promise<unknown>) => void runHook()),
      handleOutput: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined)
    })
    queryMock.mockImplementation(async (_ctx, options) => {
      options.onEvent({
        type: 'error',
        data: { code: 'cline_acp_eof', fatal: true, message: 'Cline startup failed [REDACTED].' }
      })
      options.onEvent({ type: 'exit', data: { exitCode: 1, stderr: '[REDACTED]' } })
      return { kill: vi.fn(), emit: vi.fn() }
    })
    ctx.env = {
      AWS_SECRET_ACCESS_KEY: credential,
      AWS_SHARED_CREDENTIALS_FILE: sensitiveValues[1],
      AZURE_STORAGE_ACCOUNT_KEY: credential,
      GIT_INTERNAL_VALUE: sensitiveValues[3],
      GOOGLE_APPLICATION_CREDENTIALS: sensitiveValues[2],
      SAFE_CONTEXT: 'visible'
    }
    ctx.configs = [{ adapters: createAdapters({ cline: {} }) }, undefined]
    prepareMock.mockResolvedValue([ctx])

    await run({
      adapter: 'cline',
      cwd: ctx.cwd,
      env: { OPENAI_API_KEY: credential, SAFE_CONTEXT: 'visible' }
    }, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-cline-secret-boundaries',
      description: 'hello',
      onEvent: vi.fn()
    })

    const cached = (ctx.cache.set as ReturnType<typeof vi.fn>).mock.calls
      .find(([key]) => key === 'base')?.[1]
    for (const sensitive of sensitiveValues) expect(JSON.stringify(cached)).not.toContain(sensitive)
    expect(cached.env).toMatchObject({ SAFE_CONTEXT: 'visible' })
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({ AWS_SECRET_ACCESS_KEY: credential })
      }),
      expect.anything()
    )

    const hookBridgeCtx = createAdapterHookBridgeMock.mock.calls[0]?.[0]?.ctx
    for (const sensitive of sensitiveValues) expect(JSON.stringify(hookBridgeCtx)).not.toContain(sensitive)
    const taskStartCall = callHookMock.mock.calls.find(([eventName]) => eventName === 'TaskStart')
    for (const sensitive of sensitiveValues) expect(JSON.stringify(taskStartCall)).not.toContain(sensitive)
    expect(taskStartCall?.[1]).toMatchObject({
      options: { env: { SAFE_CONTEXT: 'visible' } }
    })
    expect(taskStartCall?.[2]).toMatchObject({ SAFE_CONTEXT: 'visible' })
    await vi.waitFor(() => {
      expect(callHookMock.mock.calls.some(([eventName]) => eventName === 'TaskStop')).toBe(true)
    })
    const taskStopCall = callHookMock.mock.calls.find(([eventName]) => eventName === 'TaskStop')
    for (const sensitive of sensitiveValues) expect(JSON.stringify(taskStopCall)).not.toContain(sensitive)
    expect(taskStopCall?.[1]).toMatchObject({
      options: { env: { SAFE_CONTEXT: 'visible' } },
      stderr: '[REDACTED]'
    })
    expect(taskStopCall?.[2]).toMatchObject({ SAFE_CONTEXT: 'visible' })
    const loggerErrorCalls = (ctx.logger.error as ReturnType<typeof vi.fn>).mock.calls
    for (const sensitive of sensitiveValues) expect(JSON.stringify(loggerErrorCalls)).not.toContain(sensitive)

    queryMock.mockResolvedValueOnce({ kill: vi.fn(), emit: vi.fn() })
    await run({ adapter: 'cline', cwd: ctx.cwd, env: {} }, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-cline-startup-retry',
      onEvent: vi.fn()
    })
    expect(queryMock).toHaveBeenCalledTimes(2)
  })

  it('keeps Kiro credentials process-only across create and resume task cache writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-kiro-task-cache-'))
    tempDirs.push(root)
    const ctx = createCtx()
    const sessionId = 'session-kiro-persistence'
    ctx.cwd = root
    ctx.assets.cwd = root
    ctx.env = {
      __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: join(root, '.oneworks-projects'),
      KIRO_API_KEY: 'kiro-create-secret',
      KIRO_REFRESH_TOKEN: 'kiro-refresh-secret',
      AWS_ACCESS_KEY_ID: 'aws-access-secret',
      AWS_SECRET_ACCESS_KEY: 'aws-secret-secret',
      AWS_PROFILE: 'resume-profile',
      RESUME_RUNTIME_MARKER: 'needed-after-resume',
      NON_SECRET_COPY_OF_CREDENTIAL: 'kiro-create-secret'
    }
    ctx.configs = [{ adapters: createAdapters({ kiro: {} }) }, undefined]
    ctx.cache = {
      get: vi.fn(),
      set: (key, value) => setCache(root, ctx.ctxId, sessionId, key, value, ctx.env)
    }
    prepareMock.mockResolvedValue([ctx])

    await run({ adapter: 'kiro', cwd: root, env: ctx.env }, {
      type: 'create',
      runtime: 'server',
      sessionId,
      permissionMode: 'dontAsk',
      description: 'permissioned automation',
      onEvent: vi.fn()
    })
    expect(queryMock.mock.calls.at(-1)?.[0].env.KIRO_API_KEY).toBe('kiro-create-secret')
    expect(queryMock.mock.calls.at(-1)?.[1]).toMatchObject({ permissionMode: 'dontAsk' })

    ctx.env.KIRO_API_KEY = 'kiro-current-resume-secret'
    ctx.env.KIRO_REFRESH_TOKEN = 'kiro-current-refresh-secret'
    ctx.env.NON_SECRET_COPY_OF_CREDENTIAL = 'kiro-current-resume-secret'
    await run({ adapter: 'kiro', cwd: root, env: ctx.env }, {
      type: 'resume',
      runtime: 'server',
      sessionId,
      permissionMode: 'dontAsk',
      description: 'resume permissioned automation',
      onEvent: vi.fn()
    })

    const latestQueryCtx = queryMock.mock.calls.at(-1)?.[0] as AdapterCtx
    expect(latestQueryCtx.env.KIRO_API_KEY).toBe('kiro-current-resume-secret')
    expect(latestQueryCtx.env.AWS_PROFILE).toBe('resume-profile')
    const basePath = getCachePath(root, ctx.ctxId, sessionId, 'base', ctx.env)
    const persisted = await readFile(basePath, 'utf8')
    expect(persisted).toContain('needed-after-resume')
    expect(persisted).toContain('resume-profile')
    expect(persisted).not.toContain('KIRO_API_KEY')
    expect(persisted).not.toContain('KIRO_REFRESH_TOKEN')
    expect(persisted).not.toContain('AWS_ACCESS_KEY_ID')
    expect(persisted).not.toContain('AWS_SECRET_ACCESS_KEY')
    expect(persisted).not.toContain('kiro-create-secret')
    expect(persisted).not.toContain('kiro-current-resume-secret')
    expect(persisted).not.toContain('kiro-current-refresh-secret')
  })

  it.each(['create', 'resume'] as const)(
    'scrubs Junie configContent from every %s base-cache layer without mutating runtime config',
    async type => {
      const ctx = createCtx()
      const secret = `credential-v5-${type}`
      const authSecrets = Object.fromEntries(
        JUNIE_AUTH_ENV_KEYS.map(key => [key, `credential-v6-${type}-${key.toLowerCase()}`])
      )
      const primaryAuthSecret = authSecrets.JUNIE_API_KEY
      const makeConfig = (layer: string) => {
        const error = Object.assign(new Error('safe'), { authorization: `Bearer ${secret}`, code: 'SAFE' })
        return {
          defaultAdapter: 'junie',
          adapters: createAdapters({
            junie: {
              packageId: '@oneworks/adapter-junie',
              provider: 'anthropic',
              configContent: {
                layer,
                region: 'us-east-1',
                apiKey: secret,
                byok: { openai: secret },
                raw: `token=${secret}&region=eu`,
                uri: `https://user:${secret}@example.invalid?v=1`,
                json: JSON.stringify({ password: secret, model: 'safe-model' }),
                encoded: Buffer.from(JSON.stringify({ apiKey: secret, region: 'ap' })).toString('base64'),
                array: [{ secret }, { model: 'safe-model' }],
                map: new Map([['apiKey', secret], ['region', 'eu']]),
                set: new Set(['visible', `Bearer ${secret}`]),
                error,
                authEcho: primaryAuthSecret,
                authJsonEcho: JSON.stringify({ echo: primaryAuthSecret, region: 'auth-region' }),
                authEncodedEcho: Buffer.from(primaryAuthSecret).toString('base64'),
                [`token=${secret}`]: 'hidden-key-value'
              }
            }
          })
        }
      }
      const project = makeConfig('project')
      const user = makeConfig('user')
      const global = makeConfig('global')
      const extended = makeConfig('extended')
      const configState = {
        effectiveProjectConfig: project,
        projectConfig: project,
        userConfig: user,
        globalConfig: global,
        mergedConfig: makeConfig('merged'),
        globalSource: {
          rawConfig: global,
          resolvedConfig: global,
          extendPaths: [],
          resolvedExtendPaths: []
        },
        projectSource: {
          rawConfig: project,
          resolvedConfig: project,
          extendPaths: [],
          resolvedExtendPaths: [],
          resolvedExtendSources: [{
            rawConfig: extended,
            resolvedConfig: extended,
            extendPaths: [],
            resolvedExtendPaths: []
          }]
        },
        userSource: {
          rawConfig: user,
          resolvedConfig: user,
          extendPaths: [],
          resolvedExtendPaths: []
        }
      }
      ctx.configs = [project, user] as unknown as AdapterCtx['configs']
      ctx.env = {
        PATH: '/usr/bin',
        LANG: 'C',
        HTTPS_PROXY: 'https://proxy.example.invalid',
        __ONEWORKS_PROJECT_CTX_ID__: 'ctx-v6',
        ...authSecrets,
        AUTH_JSON_ECHO: JSON.stringify({ JUNIE_API_KEY: primaryAuthSecret, region: 'env-region' }),
        AUTH_BASE64_ECHO: Buffer.from(primaryAuthSecret).toString('base64')
      }
      ctx.assets = {
        ...ctx.assets,
        configs: [project, user] as unknown as WorkspaceAssetBundle['configs']
      }
      ctx.configState = configState as unknown as AdapterCtx['configState']
      prepareMock.mockResolvedValue([ctx])

      await run({ adapter: 'junie', cwd: ctx.cwd, env: {} }, {
        type,
        runtime: 'server',
        sessionId: `session-junie-v5-${type}`,
        description: 'hello',
        onEvent: vi.fn()
      })

      const cached = (ctx.cache.set as ReturnType<typeof vi.fn>).mock.calls
        .find(([key]) => key === 'base')?.[1]
      const persisted = JSON.stringify(cached)
      const runtimeCtx = queryMock.mock.calls.at(-1)?.[0] as AdapterCtx
      expect(persisted).not.toContain(secret)
      for (const [key, value] of Object.entries(authSecrets)) {
        expect(cached.env).not.toHaveProperty(key)
        expect(persisted).not.toContain(value)
        expect(runtimeCtx.env).toHaveProperty(key, value)
      }
      expect(cached.env).toMatchObject({
        PATH: '/usr/bin',
        LANG: 'C',
        HTTPS_PROXY: 'https://proxy.example.invalid',
        __ONEWORKS_PROJECT_CTX_ID__: 'ctx-v6'
      })
      expect(persisted).toContain('us-east-1')
      expect(persisted).toContain('@oneworks/adapter-junie')
      expect(persisted).toContain('anthropic')
      expect(persisted).toContain('extended')

      expect(JSON.stringify(runtimeCtx.configs)).toContain(secret)
      expect(JSON.stringify(runtimeCtx.assets?.configs)).toContain(secret)
      expect(JSON.stringify(runtimeCtx.configState)).toContain(secret)
      expect(project.adapters?.junie).toMatchObject({
        provider: 'anthropic',
        configContent: expect.objectContaining({ apiKey: secret })
      })

      const hookPayloads = callHookMock.mock.calls.map(([, input]) => input)
      expect(hookPayloads).toHaveLength(1)
      expect(hookPayloads[0]).toEqual(expect.objectContaining({ adapter: 'junie' }))
      expect(JSON.stringify(hookPayloads)).not.toContain(secret)
    }
  )

  it.each(['create', 'resume'] as const)(
    'scrubs Junie configContent during a non-Junie %s task while preserving the selected adapter',
    async type => {
      const ctx = createCtx()
      const junieSecret = `cross-adapter-junie-secret-${type}`
      const aliasSecret = `cross-adapter-junie-alias-secret-${type}`
      const unrelatedSecrets = {
        conflicting: `cross-adapter-conflicting-secret-${type}`,
        missing: `cross-adapter-missing-secret-${type}`,
        tombstoned: `cross-adapter-tombstoned-secret-${type}`
      }
      const codexConfig = {
        adapters: createAdapters({
          codex: {
            configContent: { apiKey: 'unrelated-adapter-value', region: 'us' }
          },
          junie: {
            packageId: '@oneworks/adapter-junie',
            configContent: {
              apiKey: junieSecret,
              byok: { openai: junieSecret },
              region: 'junie-region'
            }
          },
          workJunie: {
            packageId: '@oneworks/adapter-junie',
            configContent: {
              apiKey: aliasSecret,
              region: 'alias-region'
            }
          },
          conflicting: {
            packageId: '@oneworks/adapter-codex',
            configContent: { apiKey: unrelatedSecrets.conflicting, region: 'conflicting-region' }
          },
          missing: {
            configContent: { apiKey: unrelatedSecrets.missing, region: 'missing-region' }
          },
          tombstoned: {
            packageId: null,
            configContent: { apiKey: unrelatedSecrets.tombstoned, region: 'tombstoned-region' }
          }
        })
      }
      ctx.configs = [codexConfig, undefined] as unknown as AdapterCtx['configs']
      ctx.assets = {
        ...ctx.assets,
        configs: [codexConfig, undefined] as unknown as WorkspaceAssetBundle['configs']
      }
      ctx.configState = {
        globalConfig: codexConfig,
        mergedConfig: codexConfig,
        projectSource: {
          rawConfig: codexConfig,
          resolvedConfig: codexConfig,
          extendPaths: [],
          resolvedExtendPaths: [],
          resolvedExtendSources: [{
            rawConfig: codexConfig,
            resolvedConfig: codexConfig,
            extendPaths: [],
            resolvedExtendPaths: []
          }]
        }
      } as unknown as AdapterCtx['configState']
      prepareMock.mockResolvedValue([ctx])

      await run({ adapter: 'codex', cwd: ctx.cwd, env: {} }, {
        type,
        runtime: 'server',
        sessionId: `session-unrelated-persistence-${type}`,
        description: 'hello',
        onEvent: vi.fn()
      })

      const cached = (ctx.cache.set as ReturnType<typeof vi.fn>).mock.calls
        .find(([key]) => key === 'base')?.[1] as AdapterCtx
      expect(cached.configs[0]?.adapters?.codex).toMatchObject({
        configContent: { region: 'us' }
      })
      expect(cached.assets?.configs?.[0]?.adapters?.codex).toMatchObject({
        configContent: { region: 'us' }
      })
      expect(JSON.stringify(cached)).not.toContain(junieSecret)
      expect(JSON.stringify(cached)).not.toContain(aliasSecret)
      expect(cached.configs[0]?.adapters?.junie).toMatchObject({
        packageId: '@oneworks/adapter-junie',
        configContent: { region: 'junie-region' }
      })
      const cachedAdapters = cached.configs[0]?.adapters as Record<string, unknown>
      expect(cachedAdapters.workJunie).toMatchObject({
        packageId: '@oneworks/adapter-junie',
        configContent: { region: 'alias-region' }
      })
      for (const secret of Object.values(unrelatedSecrets)) expect(JSON.stringify(cached)).not.toContain(secret)
      expect(JSON.stringify(cached.configState)).not.toContain('unrelated-adapter-value')
      expect(JSON.stringify(ctx.configState)).toContain(junieSecret)
      expect(JSON.stringify(ctx.configState)).toContain(aliasSecret)
    }
  )

  it.each(['create', 'resume'] as const)(
    'recursively scrubs nested Qwen model-service credentials at the %s base-cache sink',
    async (type) => {
      const ctx = createCtx()
      const secrets = [
        'x7',
        'profile-secret/value',
        'service-secret+value',
        'management-secret-12345',
        'provider-token-12345',
        'extra-secret"value'
      ]
      const variants = secrets.slice(1).flatMap(secret => [
        secret,
        encodeURIComponent(secret),
        Buffer.from(secret).toString('base64'),
        Buffer.from(secret).toString('base64url'),
        JSON.stringify(secret).slice(1, -1)
      ])
      ctx.env.OPENAI_API_KEY = secrets[0]
      ctx.env.UNRELATED = `prefix:${encodeURIComponent(secrets[1]!)}:suffix`
      const config: Config = {
        adapters: createAdapters({ 'qwen-code': {} }),
        modelServices: {
          routed: {
            apiBaseUrl: 'https://provider.example.com/v1',
            apiKey: secrets[0],
            apiProtocol: 'openai-chat-completions',
            models: ['qwen-fixture'],
            provider: 'openai',
            management: {
              enabled: true,
              apiKey: secrets[3],
              baseUrl: 'https://management.example.com',
              headers: { Authorization: `Bearer ${secrets[3]}` }
            },
            profiles: {
              primary: {
                apiBaseUrl: 'https://profile.example.com/v1',
                apiKey: secrets[1],
                models: ['profile-model']
              }
            },
            providerOptions: {
              apiToken: secrets[4],
              safeFlag: true,
              traceTemplate: `raw=${secrets[0]}&encoded=${encodeURIComponent(secrets[1]!)}`
            },
            services: {
              child: {
                apiBaseUrl: 'https://child.example.com/v1',
                apiKey: secrets[2],
                models: ['child-model']
              }
            },
            extra: {
              privateKey: secrets[5],
              note: `base64=${Buffer.from(secrets[2]!).toString('base64')}`,
              safeMetadata: 'preserve-me'
            }
          }
        }
      }
      ctx.configs = [config, { ...config }]
      ctx.configState = {
        effectiveProjectConfig: config,
        projectConfig: config,
        userConfig: config,
        mergedConfig: config
      }
      prepareMock.mockResolvedValue([ctx])

      await run({ adapter: 'qwen-code', cwd: ctx.cwd, env: {} }, {
        type,
        runtime: 'server',
        sessionId: `session-qwen-no-credential-cache-${type}`,
        model: 'routed,qwen-fixture',
        description: 'hello',
        onEvent: vi.fn()
      })

      const cached = (ctx.cache.set as ReturnType<typeof vi.fn>).mock.calls
        .find(([key]) => key === 'base')?.[1]
      const persisted = cached as AdapterCtx
      const serialized = JSON.stringify({
        cached,
        logger: {
          debug: (ctx.logger.debug as ReturnType<typeof vi.fn>).mock.calls,
          error: (ctx.logger.error as ReturnType<typeof vi.fn>).mock.calls,
          info: (ctx.logger.info as ReturnType<typeof vi.fn>).mock.calls,
          warn: (ctx.logger.warn as ReturnType<typeof vi.fn>).mock.calls
        }
      })
      for (const variant of variants) expect(serialized).not.toContain(variant)
      expect(persisted.env.OPENAI_API_KEY).toBeUndefined()
      expect(persisted.env.UNRELATED).toContain('[REDACTED]')
      for (
        const persistedConfig of [
          ...persisted.configs,
          persisted.configState?.effectiveProjectConfig,
          persisted.configState?.projectConfig,
          persisted.configState?.userConfig,
          persisted.configState?.mergedConfig
        ]
      ) {
        const routed = persistedConfig?.modelServices?.routed
        expect(routed).toMatchObject({
          apiBaseUrl: 'https://provider.example.com/v1',
          apiProtocol: 'openai-chat-completions',
          models: ['qwen-fixture'],
          provider: 'openai',
          management: { enabled: true, baseUrl: 'https://management.example.com' },
          profiles: { primary: { apiBaseUrl: 'https://profile.example.com/v1', models: ['profile-model'] } },
          providerOptions: {
            safeFlag: true,
            traceTemplate: 'raw=x7&encoded=[REDACTED]'
          },
          services: { child: { apiBaseUrl: 'https://child.example.com/v1', models: ['child-model'] } },
          extra: { note: expect.stringContaining('[REDACTED]'), safeMetadata: 'preserve-me' }
        })
        expect(routed).not.toHaveProperty('apiKey')
        expect(routed?.management).not.toHaveProperty('apiKey')
        expect(routed?.management?.headers).toEqual({ Authorization: '[REDACTED]' })
        expect(routed?.profiles?.primary).not.toHaveProperty('apiKey')
        expect(routed?.providerOptions).not.toHaveProperty('apiToken')
        expect(routed?.services?.child).not.toHaveProperty('apiKey')
        expect(routed?.extra).not.toHaveProperty('privateKey')
      }
      expect(queryMock.mock.calls[0]?.[0].configs[0]?.modelServices?.routed?.apiKey).toBe(secrets[0])
      expect(queryMock.mock.calls[0]?.[0].configState?.mergedConfig.modelServices?.routed?.extra).toMatchObject({
        privateKey: secrets[5]
      })
    }
  )

  it.each(['create', 'resume'] as const)(
    'scrubs Qwen MCP credentials across config, configState, and assets at the %s persistence boundary',
    async (type) => {
      const ctx = createCtx()
      const secrets = {
        assetHeader: 'asset-header-secret +/"',
        authorization: 'authorization-secret +/"',
        cookie: 'cookie-secret +/"',
        customHeader: 'custom-header-secret +/"',
        env: 'stdio-env-secret +/"',
        graph: 'graph-secret +/"',
        opaqueHeader: 'opaque-header-secret +/"',
        passwordFile: '/private/fixture-password-file',
        sharedCredentialsFile: '/private/fixture-aws-credentials'
      }
      Object.assign(ctx.env, {
        AWS_SHARED_CREDENTIALS_FILE: secrets.sharedCredentialsFile,
        MYSQL_PWD: 'abcdefg',
        MODEL_ID: 'alpha-abcdefg-model',
        PASSWORD_FILE: secrets.passwordFile,
        PGPASSWORD: 'a'
      })
      const config: Config = {
        adapters: createAdapters({ 'qwen-code': {} }),
        channels: {
          credentialGraph: {
            error: Object.assign(new Error(`GITHUB_TOKEN=${secrets.graph}`), {
              privateKey: secrets.graph
            }),
            map: new Map<string, unknown>([
              ['Authorization', secrets.graph],
              ['tokenCount', 42]
            ]),
            secretary: 'preserve-secretary',
            set: new Set([{ password: secrets.graph, safe: 'preserve-safe' }])
          },
          shortCredentialLeaves: {
            apiKey: 'a',
            token: 'ab',
            password: 'abc',
            secret: 'abcd',
            authorization: 'abcde',
            cookie: 'abcdef',
            privateKey: 'abcdefg',
            ordinary: 'alpha-abcdefg-model'
          }
        },
        mcpServers: {
          http: {
            type: 'http',
            url: 'https://mcp.example.com/http',
            headers: {
              Authorization: `Bearer ${secrets.authorization}`,
              'Opaque-Vendor-Header': secrets.opaqueHeader,
              'Subscription-Key': secrets.customHeader,
              'X-API-Key': secrets.customHeader,
              'X-Short-Vendor': 'abc',
              'X-Trace-Id': 'preserve-trace'
            }
          },
          sse: {
            type: 'sse',
            url: 'https://mcp.example.com/sse',
            headers: {
              Cookie: `session=${secrets.cookie}`,
              'Set-Cookie': `refresh=${secrets.cookie}`,
              'X-Asset-Token': secrets.assetHeader,
              'X-Safe-Mode': 'preserve-safe-mode'
            }
          },
          stdio: {
            command: process.execPath,
            args: ['fixture-mcp.mjs'],
            env: {
              API_TOKEN: secrets.env,
              AWS_SHARED_CREDENTIALS_FILE: secrets.sharedCredentialsFile,
              MYSQL_PWD: 'abcdefg',
              PASSWORD_FILE: secrets.passwordFile,
              PGPASSWORD: 'a',
              SAFE_MODE: 'preserve-safe-env',
              tokenCount: 'preserve-token-count'
            }
          }
        }
      }
      ctx.configs = [config, config]
      ctx.configState = {
        effectiveProjectConfig: config,
        projectConfig: config,
        userConfig: config,
        mergedConfig: config
      }
      ctx.assets.configs = [config, config]
      for (const [name, mcpConfig] of Object.entries(config.mcpServers ?? {})) {
        const asset = {
          id: `mcp-${name}`,
          kind: 'mcpServer' as const,
          name,
          displayName: name,
          origin: 'workspace' as const,
          sourcePath: `/tmp/project/.oo/mcp/${name}.json`,
          payload: { name, config: mcpConfig }
        }
        ctx.assets.mcpServers[name] = asset
        ctx.assets.assets.push(asset)
      }
      let hookQueue: Promise<unknown> = Promise.resolve()
      createAdapterHookBridgeMock.mockReturnValue({
        start: vi.fn().mockResolvedValue(undefined),
        prepareInitialPrompt: vi.fn(async (prompt?: string) => prompt),
        wrapSession: vi.fn((session: unknown) => session),
        enqueueAfterPendingHooks: vi.fn((runHook: () => Promise<unknown>) => {
          hookQueue = hookQueue.catch(() => undefined).then(runHook)
        }),
        handleOutput: vi.fn(),
        flush: vi.fn(async () => hookQueue)
      })
      queryMock.mockImplementation(async (_ctx, options) => {
        options.onEvent({ type: 'exit', data: { exitCode: 0 } })
        return { kill: vi.fn(), emit: vi.fn() }
      })
      prepareMock.mockResolvedValue([ctx])

      const result = await run({ adapter: 'qwen-code', cwd: ctx.cwd, env: {} }, {
        type,
        runtime: 'server',
        sessionId: `session-qwen-mcp-persistence-${type}`,
        description: 'hello',
        onEvent: vi.fn()
      })
      await result.session.flushHooks()

      const cached = (ctx.cache.set as ReturnType<typeof vi.fn>).mock.calls
        .find(([key]) => key === 'base')?.[1] as AdapterCtx
      const boundaryState = JSON.stringify({
        cache: cached,
        hooks: callHookMock.mock.calls,
        logger: {
          debug: (ctx.logger.debug as ReturnType<typeof vi.fn>).mock.calls,
          error: (ctx.logger.error as ReturnType<typeof vi.fn>).mock.calls,
          info: (ctx.logger.info as ReturnType<typeof vi.fn>).mock.calls,
          warn: (ctx.logger.warn as ReturnType<typeof vi.fn>).mock.calls
        }
      })
      expect(callHookMock.mock.calls.map(([eventName]) => eventName)).toEqual(['TaskStart', 'TaskStop'])
      for (const secret of Object.values(secrets)) {
        for (
          const variant of [
            secret,
            encodeURIComponent(secret),
            new URLSearchParams({ value: secret }).toString().slice('value='.length),
            Buffer.from(secret).toString('base64'),
            Buffer.from(secret).toString('base64url'),
            JSON.stringify(secret).slice(1, -1)
          ]
        ) expect(boundaryState).not.toContain(variant)
      }

      const persistedConfig = cached.configState?.mergedConfig
      expect(persistedConfig?.mcpServers?.stdio).toMatchObject({
        env: { SAFE_MODE: 'preserve-safe-env', tokenCount: 'preserve-token-count' }
      })
      expect(persistedConfig?.mcpServers?.stdio.env).not.toHaveProperty('API_TOKEN')
      expect(persistedConfig?.mcpServers?.stdio.env).not.toHaveProperty('AWS_SHARED_CREDENTIALS_FILE')
      expect(persistedConfig?.mcpServers?.stdio.env).not.toHaveProperty('MYSQL_PWD')
      expect(persistedConfig?.mcpServers?.stdio.env).not.toHaveProperty('PASSWORD_FILE')
      expect(persistedConfig?.mcpServers?.stdio.env).not.toHaveProperty('PGPASSWORD')
      const persistedHttp = persistedConfig?.mcpServers?.http
      if (persistedHttp?.type !== 'http') throw new Error('expected persisted HTTP MCP server')
      expect(persistedHttp).toMatchObject({
        headers: {
          Authorization: '[REDACTED]',
          'Opaque-Vendor-Header': '[REDACTED]',
          'Subscription-Key': '[REDACTED]',
          'X-API-Key': '[REDACTED]',
          'X-Short-Vendor': '[REDACTED]',
          'X-Trace-Id': '[REDACTED]'
        }
      })
      const persistedSse = persistedConfig?.mcpServers?.sse
      if (persistedSse?.type !== 'sse') throw new Error('expected persisted SSE MCP server')
      expect(persistedSse).toMatchObject({
        headers: {
          Cookie: '[REDACTED]',
          'Set-Cookie': '[REDACTED]',
          'X-Asset-Token': '[REDACTED]',
          'X-Safe-Mode': '[REDACTED]'
        }
      })
      expect(cached.env).not.toHaveProperty('AWS_SHARED_CREDENTIALS_FILE')
      expect(cached.env).not.toHaveProperty('MYSQL_PWD')
      expect(cached.env).not.toHaveProperty('PASSWORD_FILE')
      expect(cached.env).not.toHaveProperty('PGPASSWORD')
      expect(cached.cwd).toBe(ctx.cwd)
      expect(cached.assets?.mcpServers.http.sourcePath).toBe('/tmp/project/.oo/mcp/http.json')

      const persistedGraph = persistedConfig?.channels?.credentialGraph as Record<string, any>
      expect(persistedGraph.secretary).toBe('preserve-secretary')
      expect(persistedGraph.map).toBeInstanceOf(Map)
      expect(persistedGraph.map.get('tokenCount')).toBe(42)
      expect(persistedGraph.map.has('Authorization')).toBe(false)
      expect([...persistedGraph.set][0]).toEqual({ safe: 'preserve-safe' })
      expect(persistedGraph.error).not.toHaveProperty('privateKey')
      expect(persistedGraph.error.message).toContain('[REDACTED]')
      expect(persistedConfig?.channels?.shortCredentialLeaves).toEqual({
        ordinary: 'alpha-abcdefg-model'
      })
      expect(cached.env.MODEL_ID).toBe('alpha-abcdefg-model')

      const runtimeCtx = queryMock.mock.calls[0]?.[0] as AdapterCtx
      const runtimeOptions = queryMock.mock.calls[0]?.[1]
      expect(runtimeCtx.configState?.mergedConfig.mcpServers?.stdio.env?.API_TOKEN).toBe(secrets.env)
      expect(runtimeCtx.env).toMatchObject({
        AWS_SHARED_CREDENTIALS_FILE: secrets.sharedCredentialsFile,
        MYSQL_PWD: 'abcdefg',
        MODEL_ID: 'alpha-abcdefg-model',
        PASSWORD_FILE: secrets.passwordFile,
        PGPASSWORD: 'a'
      })
      expect(runtimeCtx.assets?.mcpServers.http.payload.config).toMatchObject({
        headers: {
          Authorization: `Bearer ${secrets.authorization}`,
          'Opaque-Vendor-Header': secrets.opaqueHeader,
          'X-Short-Vendor': 'abc'
        }
      })
      expect(runtimeOptions?.assetPlan?.mcpServers).toMatchObject({
        http: { headers: { Authorization: `Bearer ${secrets.authorization}` } },
        sse: { headers: { 'X-Asset-Token': secrets.assetHeader } },
        stdio: { env: { API_TOKEN: secrets.env } }
      })
    }
  )

  it('preserves non-Qwen runtime inputs while applying the shared header persistence boundary', async () => {
    const ctx = createCtx()
    const headerSecret = 'shared-adapter-header-secret-12345'
    const config: Config = {
      adapters: createAdapters({ codex: {} }),
      mcpServers: {
        vendor: {
          type: 'http',
          url: 'https://mcp.example.com/vendor',
          headers: {
            'Opaque-Vendor': headerSecret,
            'X-Route-Name': 'stable-route-name'
          }
        }
      }
    }
    ctx.configs = [config, undefined]
    ctx.configState = { mergedConfig: config }
    prepareMock.mockResolvedValue([ctx])

    await run({ adapter: 'codex', cwd: ctx.cwd, env: {} }, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-shared-header-persistence',
      description: 'hello',
      onEvent: vi.fn()
    })

    const cached = (ctx.cache.set as ReturnType<typeof vi.fn>).mock.calls
      .find(([key]) => key === 'base')?.[1] as AdapterCtx
    const cachedVendor = cached.configState?.mergedConfig.mcpServers?.vendor
    const runtimeCtx = queryMock.mock.calls[0]?.[0] as AdapterCtx
    const runtimeVendor = runtimeCtx.configState?.mergedConfig.mcpServers?.vendor
    if (cachedVendor?.type !== 'http' || runtimeVendor?.type !== 'http') {
      throw new Error('expected HTTP MCP fixtures')
    }

    expect(cachedVendor.headers).toEqual({
      'Opaque-Vendor': '[REDACTED]',
      'X-Route-Name': '[REDACTED]'
    })
    expect(runtimeVendor.headers).toEqual({
      'Opaque-Vendor': headerSecret,
      'X-Route-Name': 'stable-route-name'
    })
  })

  it('does not persist Factory credentials from aliases during a non-Droid task', async () => {
    const ctx = createCtx()
    ctx.env.FACTORY_API_KEY = 'factory-api-cache-secret'
    ctx.env.FACTORY_TOKEN = 'factory-token-cache-secret'
    const config = {
      adapters: createAdapters({
        codex: {},
        droid: {
          configContent: {
            apiKey: 'factory-api-cache-secret',
            general: { theme: 'dark' }
          }
        },
        'factory-team': {
          packageId: '@oneworks/adapter-droid',
          configContent: {
            nested: {
              accessToken: 'alias-access-secret',
              note: 'prefix factory-token-cache-secret suffix'
            }
          }
        },
        cursor: {
          configContent: { general: { theme: 'light' }, maxTokens: 4096 }
        }
      })
    }
    ctx.configs = [config, undefined]
    ctx.configState = { mergedConfig: config }
    const configSnapshot = structuredClone(ctx.configs)
    prepareMock.mockResolvedValue([ctx])

    await run({ adapter: 'codex', cwd: ctx.cwd, env: {} }, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-no-factory-cache',
      description: 'hello',
      onEvent: vi.fn()
    })

    const cached = (ctx.cache.set as ReturnType<typeof vi.fn>).mock.calls
      .find(([key]) => key === 'base')?.[1] as AdapterCtx | undefined
    const serialized = JSON.stringify(cached)
    for (
      const secret of [
        'factory-api-cache-secret',
        'factory-token-cache-secret',
        'alias-access-secret'
      ]
    ) expect(serialized).not.toContain(secret)
    expect(cached?.env.FACTORY_API_KEY).toBeUndefined()
    expect(cached?.env.FACTORY_TOKEN).toBeUndefined()
    expect(serialized).toContain('"theme":"dark"')
    expect(serialized).toContain('"theme":"light"')
    expect(serialized).toContain('"maxTokens":4096')
    expect(ctx.configs).toEqual(configSnapshot)
    expect(ctx.env).toEqual(expect.objectContaining({
      FACTORY_API_KEY: 'factory-api-cache-secret',
      FACTORY_TOKEN: 'factory-token-cache-secret'
    }))
    expect(queryMock.mock.calls[0]?.[0].env).toEqual(expect.objectContaining({
      FACTORY_API_KEY: 'factory-api-cache-secret',
      FACTORY_TOKEN: 'factory-token-cache-secret'
    }))
  })

  it('sanitizes actual create and resume base.json writes without mutating runtime config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-task-run-cache-security-'))
    try {
      const ctx = createCtx()
      ctx.cwd = root
      ctx.assets = {
        ...createAssets(),
        cwd: root,
        secretEcho: 'a',
        safePath: '/workspace/data'
      } as unknown as WorkspaceAssetBundle
      const config = {
        adapters: createAdapters({
          codex: {},
          droidAlias: {
            packageId: '@oneworks/adapter-droid',
            configContent: {
              apiKey: 'a',
              credentials: {
                spaced: 'a b',
                comma: 'a,b',
                semicolon: 'a;b',
                pipe: 'a|b',
                parentheses: 'a(b)',
                quoted: 'a"b',
                singleQuoted: "a'b",
                multipleOctets: 'a,/:b'
              },
              exactEcho: 'a',
              assignmentEcho: 'FACTORY_API_KEY=a',
              spacedEcho: 'FACTORY_TOKEN="a b"',
              commaEcho: '"apiKey":"a,b"',
              semicolonEcho: 'token=a;b; next=true',
              pipeEcho: 'Authorization: Bearer a|b | next',
              parenthesesEcho: 'password=a(b))',
              quotedEcho: JSON.stringify({ token: 'a"b' }),
              partialEscapedQuoteEcho: JSON.stringify({ token: 'a"b' }).replace('a', '%61'),
              partialSingleQuoteEcho: "token='%61\\'b'",
              encodedEcho: 'https://factory.test?token=a%20b&next=true',
              plusEncodedEcho: 'https://factory.test?token=a+b&next=true',
              lowercaseEncodedEcho: 'https://factory.test?token=a%2cb&next=true',
              partialCommaEcho: 'https://factory.test?token=%61,b&next=true',
              fullyEncodedEcho: '"apiKey":"%61%2c%62"',
              mixedEncodedEcho: 'FACTORY_TOKEN=a%2c%2F%3ab&next=true',
              mixedFullyEncodedEcho: 'FACTORY_TOKEN=%61%2c%2F%3a%62&next=true',
              partialSemicolonEcho: 'FACTORY_TOKEN=%61;b&next=true',
              partialPipeEcho: 'Authorization: Bearer %61|b | next',
              partialParenthesesEcho: 'password=%61(b))',
              stable: 'alpha'
            }
          }
        }),
        extend: {
          adapters: {
            droid: {
              configContent: {
                token: 'a',
                duplicate: 'a'
              }
            }
          }
        }
      } as unknown as NonNullable<AdapterCtx['configs'][0]>
      ctx.configs = [config, undefined]
      ctx.configState = {
        effectiveProjectConfig: config,
        projectConfig: config,
        mergedConfig: config,
        source: {
          dynamic: { a: 'property-key-echo' },
          configContent: { credentials: { value: 'a' }, mirror: 'a' }
        }
      } as unknown as AdapterCtx['configState']
      const configSnapshot = structuredClone(ctx.configs)
      let cachePath: string | undefined
      ctx.cache = {
        set: vi.fn(async (key, value) => {
          const result = await setCache(root, ctx.ctxId, 'session-create-resume', key, value, ctx.env)
          if (key === 'base') cachePath = result.cachePath
          return result
        }),
        get: vi.fn()
      } as AdapterCtx['cache']
      prepareMock.mockResolvedValue([ctx])

      for (const type of ['create', 'resume'] as const) {
        await run({ adapter: 'codex', cwd: root, env: {} }, {
          type,
          runtime: 'server',
          sessionId: 'session-create-resume',
          description: type === 'create' ? 'hello' : 'again',
          onEvent: vi.fn()
        })

        expect(cachePath).toBeDefined()
        const persisted = await readFile(cachePath!, 'utf8')
        expect(persisted).not.toContain('"apiKey"')
        expect(persisted).not.toContain('"token"')
        expect(persisted).not.toContain('"credentials"')
        expect(persisted).not.toContain('"a": "property-key-echo"')
        expect(persisted).not.toContain('"secretEcho": "a"')
        expect(persisted).toContain('"exactEcho": "[REDACTED]"')
        expect(persisted).toContain('"assignmentEcho": "FACTORY_API_KEY=[REDACTED]"')
        expect(persisted).toContain('"safePath": "/workspace/data"')
        expect(persisted).toContain('"stable": "alpha"')
        const cachedBase = JSON.parse(persisted) as AdapterCtx
        const cachedContent = ((cachedBase.configs[0]?.adapters as Record<string, unknown>)
          .droidAlias as { configContent: Record<string, unknown> }).configContent
        expect(cachedContent).toMatchObject({
          spacedEcho: 'FACTORY_TOKEN="[REDACTED]"',
          commaEcho: '"apiKey":"[REDACTED]"',
          semicolonEcho: 'token=[REDACTED]; next=true',
          pipeEcho: 'Authorization: Bearer [REDACTED] | next',
          parenthesesEcho: 'password=[REDACTED])',
          quotedEcho: '{"token":"[REDACTED]"}',
          partialEscapedQuoteEcho: '{"token":"[REDACTED]"}',
          partialSingleQuoteEcho: "token='[REDACTED]'",
          encodedEcho: 'https://factory.test?token=[REDACTED]&next=true',
          plusEncodedEcho: 'https://factory.test?token=[REDACTED]&next=true',
          lowercaseEncodedEcho: 'https://factory.test?token=[REDACTED]&next=true',
          partialCommaEcho: 'https://factory.test?token=[REDACTED]&next=true',
          fullyEncodedEcho: '"apiKey":"[REDACTED]"',
          mixedEncodedEcho: 'FACTORY_TOKEN=[REDACTED]&next=true',
          mixedFullyEncodedEcho: 'FACTORY_TOKEN=[REDACTED]&next=true',
          partialSemicolonEcho: 'FACTORY_TOKEN=[REDACTED]&next=true',
          partialPipeEcho: 'Authorization: Bearer [REDACTED] | next',
          partialParenthesesEcho: 'password=[REDACTED])'
        })
      }

      expect(queryMock.mock.calls.map(([, options]) => options.type)).toEqual(['create', 'resume'])
      expect(ctx.configs).toEqual(configSnapshot)
      expect(
        ((ctx.configs[0]?.adapters as Record<string, unknown>)
          .droidAlias as { configContent: { apiKey: string; credentials: { spaced: string } } })
          .configContent.apiKey
      ).toBe('a')
      expect(
        ((ctx.configs[0]?.adapters as Record<string, unknown>)
          .droidAlias as { configContent: { credentials: { spaced: string } } })
          .configContent.credentials.spaced
      ).toBe('a b')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('also runs adapter init for non-CLI runtimes', async () => {
    const ctx = createCtx()
    prepareMock.mockResolvedValue([ctx])

    await run({
      adapter: 'codex',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-server',
      description: 'hello',
      onEvent: vi.fn()
    })

    expect(initMock).toHaveBeenCalledTimes(1)
    expect(initMock).toHaveBeenCalledWith(ctx)
    expect(queryMock).toHaveBeenCalledTimes(1)
  })

  it('returns the resolved adapter used for the session', async () => {
    const ctx = createCtx()
    ctx.configs = [{
      adapters: createAdapters({
        codex: {},
        'claude-code': {}
      }),
      defaultAdapter: 'claude-code'
    }, undefined] as unknown as AdapterCtx['configs']
    prepareMock.mockResolvedValue([ctx])

    const result = await run({
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-resolved-adapter',
      description: 'hello',
      onEvent: vi.fn()
    })

    expect(result.resolvedAdapter).toBe('claude-code')
  })

  it('loads a configured runtime package while preserving the adapter instance key', async () => {
    const ctx = createCtx()
    ctx.configs = [{
      adapters: createAdapters({
        fast: {
          packageId: '@oneworks/adapter-codex',
          defaultModel: 'gpt-5.5',
          sandboxPolicy: {
            type: 'workspaceWrite'
          }
        }
      })
    }, undefined] as unknown as AdapterCtx['configs']
    prepareMock.mockResolvedValue([ctx])

    const result = await run({
      adapter: 'fast',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-dynamic-instance',
      description: 'hello',
      onEvent: vi.fn()
    })

    expect(loadAdapterMock).toHaveBeenCalledWith('@oneworks/adapter-codex')
    expect(initMock).toHaveBeenCalledWith(expect.objectContaining({
      configState: expect.objectContaining({
        mergedConfig: expect.objectContaining({
          adapters: expect.objectContaining({
            codex: expect.objectContaining({
              packageId: '@oneworks/adapter-codex',
              sandboxPolicy: {
                type: 'workspaceWrite'
              }
            })
          })
        })
      })
    }))
    expect(queryMock.mock.calls[0]?.[0]).toMatchObject({
      configState: {
        mergedConfig: {
          adapters: {
            fast: expect.objectContaining({
              packageId: '@oneworks/adapter-codex'
            }),
            codex: expect.objectContaining({
              sandboxPolicy: {
                type: 'workspaceWrite'
              }
            })
          }
        }
      }
    })
    expect(ctx.env.__ONEWORKS_PROJECT_ADAPTER__).toBe('fast')
    expect(ctx.env.__ONEWORKS_RUNTIME_PROTOCOL_DEFAULT_ADAPTER__).toBe('fast')
    expect(result.resolvedAdapter).toBe('fast')
  })

  it('inherits parent session adapter and model from env when omitted by the task input', async () => {
    const ctx = createCtx()
    ctx.env.__ONEWORKS_PROJECT_ADAPTER__ = 'codex'
    ctx.env.__ONEWORKS_PROJECT_MODEL__ = 'gpt,gpt-5.5'
    ctx.configs = [{
      adapters: createAdapters({})
    }, undefined] as unknown as AdapterCtx['configs']
    prepareMock.mockResolvedValue([ctx])

    const result = await run({
      cwd: ctx.cwd,
      env: ctx.env
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-inherited-selection',
      description: 'hello',
      effort: 'high',
      onEvent: vi.fn()
    })

    expect(loadAdapterMock).toHaveBeenCalledWith('codex')
    expect(queryMock).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        model: 'gpt,gpt-5.5'
      })
    )
    expect(ctx.env.__ONEWORKS_PROJECT_ADAPTER__).toBe('codex')
    expect(ctx.env.__ONEWORKS_PROJECT_MODEL__).toBe('gpt,gpt-5.5')
    expect(ctx.env.__ONEWORKS_RUNTIME_PROTOCOL_DEFAULT_ADAPTER__).toBe('codex')
    expect(ctx.env.__ONEWORKS_RUNTIME_PROTOCOL_DEFAULT_MODEL__).toBe('gpt,gpt-5.5')
    expect(ctx.env.__ONEWORKS_RUNTIME_PROTOCOL_DEFAULT_EFFORT__).toBe('high')
    expect(result.resolvedAdapter).toBe('codex')
  })

  it('uses configured permissions.defaultMode when no permission mode is selected', async () => {
    const ctx = createCtx()
    ctx.configs = [{
      adapters: createAdapters({
        codex: {}
      }),
      permissions: {
        defaultMode: 'bypassPermissions'
      }
    }, undefined] as unknown as AdapterCtx['configs']
    prepareMock.mockResolvedValue([ctx])

    await run({
      adapter: 'codex',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-config-permission',
      description: 'hello',
      onEvent: vi.fn()
    })

    expect(queryMock.mock.calls[0]?.[1]).toMatchObject({
      permissionMode: 'bypassPermissions'
    })
    expect(ctx.env.__ONEWORKS_PROJECT_PERMISSION_MODE__).toBe('bypassPermissions')
    expect(callHookMock).toHaveBeenCalledWith(
      'TaskStart',
      expect.objectContaining({
        adapterOptions: expect.objectContaining({
          permissionMode: 'bypassPermissions'
        })
      }),
      expect.objectContaining({
        __ONEWORKS_PROJECT_PERMISSION_MODE__: 'bypassPermissions'
      })
    )
  })

  it('treats explicit default permission mode as the configured default', async () => {
    const ctx = createCtx()
    ctx.configs = [{
      adapters: createAdapters({
        codex: {}
      }),
      permissions: {
        defaultMode: 'bypassPermissions'
      }
    }, undefined] as unknown as AdapterCtx['configs']
    prepareMock.mockResolvedValue([ctx])

    await run({
      adapter: 'codex',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-config-permission-default',
      description: 'hello',
      permissionMode: 'default',
      onEvent: vi.fn()
    })

    expect(queryMock.mock.calls[0]?.[1]).toMatchObject({
      permissionMode: 'bypassPermissions'
    })
    expect(ctx.env.__ONEWORKS_PROJECT_PERMISSION_MODE__).toBe('bypassPermissions')
  })

  it('keeps an explicit permission mode ahead of configured permissions.defaultMode', async () => {
    const ctx = createCtx()
    ctx.configs = [{
      adapters: createAdapters({
        codex: {}
      }),
      permissions: {
        defaultMode: 'bypassPermissions'
      }
    }, undefined] as unknown as AdapterCtx['configs']
    prepareMock.mockResolvedValue([ctx])

    await run({
      adapter: 'codex',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-explicit-permission',
      description: 'hello',
      permissionMode: 'plan',
      onEvent: vi.fn()
    })

    expect(queryMock.mock.calls[0]?.[1]).toMatchObject({
      permissionMode: 'plan'
    })
    expect(ctx.env.__ONEWORKS_PROJECT_PERMISSION_MODE__).toBe('plan')
  })

  it('infers the resolved adapter from an adapter-prefixed model selector', async () => {
    const ctx = createCtx()
    ctx.configs = [{
      adapters: createAdapters({
        codex: {},
        'claude-code': {}
      }),
      defaultAdapter: 'claude-code',
      defaultModelService: 'openai',
      modelServices: {
        openai: {
          apiBaseUrl: 'https://responses.example.com',
          apiKey: 'token-openai',
          models: ['gpt-5.4']
        }
      }
    }, undefined] as unknown as AdapterCtx['configs']
    prepareMock.mockResolvedValue([ctx])

    const result = await run({
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-prefixed-model-adapter',
      model: 'codex/gpt-5.4',
      onEvent: vi.fn()
    })

    expect(loadAdapterMock).toHaveBeenCalledWith('codex')
    expect(queryMock).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        model: 'openai,gpt-5.4'
      })
    )
    expect(result.resolvedAdapter).toBe('codex')
  })

  it('resolves effort with explicit > model > adapter > config precedence', async () => {
    const ctx = createCtx()
    ctx.configs = [{
      effort: 'low',
      adapters: createAdapters({
        codex: {
          effort: 'medium'
        }
      }),
      models: {
        'serviceA,modelX': {
          effort: 'high'
        }
      },
      modelServices: {
        serviceA: {
          apiBaseUrl: 'https://service-a.example.com',
          apiKey: 'token-a',
          models: ['modelX']
        }
      }
    }, undefined] as unknown as AdapterCtx['configs']
    prepareMock.mockResolvedValue([ctx])

    await run({
      adapter: 'codex',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-effort',
      model: 'serviceA,modelX',
      onEvent: vi.fn()
    })

    expect(queryMock.mock.calls[0]?.[1]).toMatchObject({
      effort: 'high'
    })

    await run({
      adapter: 'codex',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-effort-explicit',
      model: 'serviceA,modelX',
      effort: 'max',
      onEvent: vi.fn()
    })

    expect(queryMock.mock.calls[1]?.[1]).toMatchObject({
      effort: 'max'
    })
  })

  it.each([
    { reportedEffort: 'medium' as const, expectedEffort: 'medium' as const },
    { reportedEffort: undefined, expectedEffort: undefined }
  ])('keeps Kiro init effort truthful when native state reports $reportedEffort', async ({
    expectedEffort,
    reportedEffort
  }) => {
    const ctx = createCtx()
    ctx.configs = [{
      adapters: createAdapters({ kiro: { effort: 'high' } })
    }, undefined] as AdapterCtx['configs']
    prepareMock.mockResolvedValue([ctx])
    const onEvent = vi.fn()
    queryMock.mockImplementationOnce(async (_ctx, options) => {
      options.onEvent({
        type: 'init',
        data: {
          uuid: 'session-kiro-effort-projection',
          adapter: 'kiro',
          model: 'default',
          effort: reportedEffort,
          version: 'test',
          tools: [],
          slashCommands: [],
          cwd: ctx.cwd,
          agents: []
        }
      })
      return { kill: vi.fn(), emit: vi.fn() }
    })

    await run({ adapter: 'kiro', cwd: ctx.cwd, env: {} }, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-kiro-effort-projection',
      effort: 'high',
      onEvent
    })

    expect(queryMock.mock.calls[0]?.[1]).toMatchObject({ effort: 'high' })
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'init',
      data: expect.objectContaining({ effort: expectedEffort })
    }))
  })

  it('accepts effort for kimi and forwards it to the adapter query', async () => {
    const ctx = createCtx()
    ctx.configs = [{
      adapters: createAdapters({
        kimi: {
          effort: 'medium'
        }
      })
    }, undefined] as AdapterCtx['configs']
    prepareMock.mockResolvedValue([ctx])

    await run({
      adapter: 'kimi',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-kimi-effort',
      effort: 'high',
      onEvent: vi.fn()
    })

    expect(queryMock.mock.calls.at(-1)?.[1]).toMatchObject({
      effort: 'high'
    })
  })

  it('accepts adapter-level effort for copilot and forwards it to the adapter query', async () => {
    const ctx = createCtx()
    ctx.configs = [{
      adapters: createAdapters({
        copilot: {
          effort: 'medium'
        }
      })
    }, undefined] as AdapterCtx['configs']
    prepareMock.mockResolvedValue([ctx])

    await run({
      adapter: 'copilot',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-copilot-effort',
      onEvent: vi.fn()
    })

    expect(queryMock.mock.calls.at(-1)?.[1]).toMatchObject({
      effort: 'medium'
    })
  })

  it('attaches the adapter asset plan to query options', async () => {
    const ctx = createCtx()
    const skillAsset = {
      id: 'skill:workspace:workspace:research:.oo/skills/research/SKILL.md',
      kind: 'skill' as const,
      name: 'research',
      displayName: 'research',
      origin: 'workspace' as const,
      sourcePath: '/tmp/project/.oo/skills/research/SKILL.md',
      payload: {
        definition: {
          path: '/tmp/project/.oo/skills/research/SKILL.md',
          body: '阅读 README.md',
          attributes: {}
        }
      }
    }
    const commandAsset = {
      id: 'command:plugin:0:demo/review:node_modules/@oneworks/plugin-demo/opencode/commands/review.md',
      kind: 'command' as const,
      name: 'review',
      displayName: 'demo/review',
      scope: 'demo',
      origin: 'plugin' as const,
      sourcePath: '/tmp/project/node_modules/@oneworks/plugin-demo/opencode/commands/review.md',
      instancePath: '0',
      packageId: '@oneworks/plugin-demo',
      resolvedBy: 'oneworks-prefix',
      payload: {
        entryName: 'review',
        targetSubpath: 'commands/review.md'
      }
    }
    ctx.assets.assets = [skillAsset, commandAsset]
    ctx.assets.skills = [skillAsset]
    ctx.assets.opencodeOverlayAssets = [commandAsset]
    prepareMock.mockResolvedValue([ctx])

    await run({
      adapter: 'codex',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-assets',
      promptAssetIds: [skillAsset.id],
      onEvent: vi.fn()
    })

    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(queryMock.mock.calls[0]?.[1]).toMatchObject({
      assetPlan: {
        adapter: 'codex',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            assetId: skillAsset.id,
            status: 'prompt'
          }),
          expect.objectContaining({
            assetId: commandAsset.id,
            status: 'skipped'
          })
        ])
      }
    })
  })

  it('merges runtime MCP servers into the adapter asset plan', async () => {
    const ctx = createCtx()
    prepareMock.mockResolvedValue([ctx])

    await run({
      adapter: 'codex',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-runtime-mcp',
      runtimeMcpServers: {
        'channel-lark-default': {
          command: process.execPath,
          args: ['/tmp/channel-lark-mcp.js'],
          env: {
            ONEWORKS_LARK_APP_ID: 'cli_app'
          }
        }
      },
      onEvent: vi.fn()
    })

    expect(queryMock.mock.calls[0]?.[1]).toMatchObject({
      assetPlan: {
        mcpServers: {
          'channel-lark-default': {
            command: process.execPath,
            args: ['/tmp/channel-lark-mcp.js'],
            env: {
              ONEWORKS_LARK_APP_ID: 'cli_app'
            }
          }
        }
      }
    })
  })

  it('reports session companion MCP servers skipped by Pi', async () => {
    const ctx = createCtx()
    ctx.configs = [{ adapters: createAdapters({ pi: {} }) }, undefined]
    prepareMock.mockResolvedValue([ctx])

    await run({ adapter: 'pi', cwd: ctx.cwd, env: {} }, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-pi-runtime-mcp',
      runtimeMcpServers: {
        'channel-lark-default': {
          command: process.execPath,
          args: ['/tmp/channel-lark-mcp.js']
        }
      },
      onEvent: vi.fn()
    })

    expect(queryMock.mock.calls[0]?.[1]).toMatchObject({
      assetPlan: {
        adapter: 'pi',
        mcpServers: {},
        diagnostics: [expect.objectContaining({
          assetId: 'runtime-mcp:channel-lark-default',
          status: 'skipped'
        })]
      }
    })
    expect(ctx.logger.warn).toHaveBeenCalledWith({
      runtimeMcpServerNames: ['channel-lark-default']
    }, '[mcp] Skipping session companion MCP servers because pi has no verified stable mapping')
  })

  it('skips Cline MCP while keeping the One Works event hook fallback active', async () => {
    const ctx = createCtx()
    ctx.configs = [{ adapters: createAdapters({ cline: {} }) }, undefined]
    prepareMock.mockResolvedValue([ctx])

    await run({ adapter: 'cline', cwd: ctx.cwd, env: {} }, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-cline-runtime-assets',
      runtimeMcpServers: {
        'channel-lark-default': {
          command: process.execPath,
          args: ['/tmp/channel-lark-mcp.js']
        }
      },
      onEvent: vi.fn()
    })

    expect(queryMock.mock.calls[0]?.[1]).toMatchObject({
      assetPlan: {
        adapter: 'cline',
        mcpServers: {},
        diagnostics: [expect.objectContaining({
          assetId: 'runtime-mcp:channel-lark-default',
          status: 'skipped'
        })]
      }
    })
    expect(createAdapterHookBridgeMock).toHaveBeenCalledWith(expect.objectContaining({
      adapter: 'cline',
      disabledEvents: []
    }))
  })

  it('reports session companion MCP servers skipped by DSH ACP', async () => {
    const ctx = createCtx()
    ctx.configs = [{ adapters: createAdapters({ dsh: {} }) }, undefined]
    prepareMock.mockResolvedValue([ctx])

    await run({ adapter: 'dsh', cwd: ctx.cwd, env: {} }, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-dsh-runtime-mcp',
      runtimeMcpServers: {
        'channel-lark-default': {
          command: process.execPath,
          args: ['/tmp/channel-lark-mcp.js']
        }
      },
      onEvent: vi.fn()
    })

    expect(queryMock.mock.calls[0]?.[1]).toMatchObject({
      assetPlan: {
        adapter: 'dsh',
        mcpServers: {},
        diagnostics: [expect.objectContaining({
          assetId: 'runtime-mcp:channel-lark-default',
          status: 'skipped',
          reason:
            'Session companion MCP "channel-lark-default" was skipped because DSH ACP does not accept MCP servers.'
        })]
      }
    })
    expect(ctx.logger.warn).toHaveBeenCalledWith({
      runtimeMcpServerNames: ['channel-lark-default']
    }, '[mcp] Skipping session companion MCP servers because DSH ACP does not accept MCP servers')
  })

  it('skips only SSE session companion MCP servers for Goose ACP', async () => {
    const ctx = createCtx()
    ctx.configs = [{ adapters: createAdapters({ goose: {} }) }, undefined]
    prepareMock.mockResolvedValue([ctx])

    await run({ adapter: 'goose', cwd: ctx.cwd, env: {} }, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-goose-runtime-mcp',
      runtimeMcpServers: {
        local: {
          command: process.execPath,
          args: ['/tmp/local-mcp.js']
        },
        remote: {
          type: 'http',
          url: 'https://example.test/mcp'
        },
        events: {
          type: 'sse',
          url: 'https://example.test/events',
          headers: {}
        }
      },
      onEvent: vi.fn()
    })

    expect(queryMock.mock.calls[0]?.[1]).toMatchObject({
      assetPlan: {
        adapter: 'goose',
        mcpServers: {
          local: expect.objectContaining({ command: process.execPath }),
          remote: { type: 'http', url: 'https://example.test/mcp' }
        },
        diagnostics: [expect.objectContaining({
          adapter: 'goose',
          assetId: 'runtime-mcp:events',
          status: 'skipped',
          reason: expect.stringContaining('SSE')
        })]
      }
    })
    expect(queryMock.mock.calls[0]?.[1]?.assetPlan?.mcpServers).not.toHaveProperty('events')
    expect(ctx.logger.warn).toHaveBeenCalledWith({
      runtimeMcpServerNames: ['events']
    }, '[mcp] Skipping SSE session companion MCP servers because Goose ACP does not support that transport')
  })

  it('passes Kiro stdio MCP and reports remote session companions as skipped', async () => {
    const ctx = createCtx()
    ctx.configs = [{ adapters: createAdapters({ kiro: {} }) }, undefined]
    prepareMock.mockResolvedValue([ctx])

    await run({ adapter: 'kiro', cwd: ctx.cwd, env: {} }, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-kiro-runtime-mcp',
      runtimeMcpServers: {
        local: {
          command: process.execPath,
          args: ['/tmp/local-mcp.js']
        },
        remote: {
          type: 'http',
          url: 'https://example.test/mcp'
        },
        events: {
          type: 'sse',
          url: 'https://example.test/events',
          headers: {}
        }
      },
      onEvent: vi.fn()
    })

    const assetPlan = queryMock.mock.calls[0]?.[1]?.assetPlan
    expect(assetPlan).toMatchObject({
      adapter: 'kiro',
      mcpServers: {
        local: expect.objectContaining({ command: process.execPath })
      },
      diagnostics: [
        expect.objectContaining({
          assetId: 'runtime-mcp:remote',
          status: 'skipped',
          reason: expect.stringContaining('verified Kiro ACP supports only stdio')
        }),
        expect.objectContaining({
          assetId: 'runtime-mcp:events',
          status: 'skipped',
          reason: expect.stringContaining('verified Kiro ACP supports only stdio')
        })
      ]
    })
    expect(assetPlan?.mcpServers).not.toHaveProperty('remote')
    expect(assetPlan?.mcpServers).not.toHaveProperty('events')
    expect(assetPlan?.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: 'runtime-mcp:remote', status: 'translated' }),
      expect.objectContaining({ assetId: 'runtime-mcp:events', status: 'translated' })
    ]))
    expect(ctx.logger.warn).toHaveBeenCalledWith({
      runtimeMcpServerNames: ['remote', 'events']
    }, '[mcp] Skipping non-stdio session companion MCP servers because verified Kiro ACP supports stdio only')
  })

  it('does not inject runtime MCP servers when explicit MCP include filters select other servers', async () => {
    const ctx = createCtx()
    ctx.assets.mcpServers.docs = {
      id: 'mcp-docs',
      kind: 'mcpServer',
      name: 'docs',
      displayName: 'docs',
      origin: 'workspace',
      sourcePath: '/tmp/project/.oo/mcp/docs.json',
      payload: {
        name: 'docs',
        config: {
          command: process.execPath,
          args: ['/tmp/docs-mcp.js']
        }
      }
    }
    ctx.assets.assets.push(ctx.assets.mcpServers.docs)
    prepareMock.mockResolvedValue([ctx])

    await run({
      adapter: 'codex',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-runtime-mcp-restricted',
      mcpServers: {
        include: ['docs']
      },
      runtimeMcpServers: {
        'channel-lark-default': {
          command: process.execPath,
          args: ['/tmp/channel-lark-mcp.js']
        }
      },
      onEvent: vi.fn()
    })

    expect(queryMock.mock.calls[0]?.[1]).toMatchObject({
      assetPlan: {
        mcpServers: {
          docs: {
            command: process.execPath,
            args: ['/tmp/docs-mcp.js']
          }
        }
      }
    })
    expect(queryMock.mock.calls[0]?.[1]?.assetPlan?.mcpServers).not.toHaveProperty('channel-lark-default')
  })

  it('allows runtime MCP servers to be explicitly included by name', async () => {
    const ctx = createCtx()
    prepareMock.mockResolvedValue([ctx])

    await run({
      adapter: 'codex',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-runtime-mcp-include-runtime',
      mcpServers: {
        include: ['channel-lark-default']
      },
      runtimeMcpServers: {
        'channel-lark-default': {
          command: process.execPath,
          args: ['/tmp/channel-lark-mcp.js']
        }
      },
      onEvent: vi.fn()
    })

    expect(queryMock.mock.calls[0]?.[1]).toMatchObject({
      assetPlan: {
        mcpServers: {
          'channel-lark-default': {
            command: process.execPath,
            args: ['/tmp/channel-lark-mcp.js']
          }
        }
      }
    })
  })

  it('does not let runtime MCP servers shadow workspace MCP servers with the same name', async () => {
    const ctx = createCtx()
    ctx.assets.mcpServers['channel-lark-default'] = {
      id: 'mcp-1',
      kind: 'mcpServer',
      name: 'channel-lark-default',
      displayName: 'channel-lark-default',
      origin: 'workspace',
      sourcePath: '/tmp/project/.oo/mcp/channel-lark-default.json',
      payload: {
        name: 'channel-lark-default',
        config: {
          command: process.execPath,
          args: ['/tmp/workspace-mcp.js']
        }
      }
    }
    ctx.assets.assets.push(ctx.assets.mcpServers['channel-lark-default'])
    prepareMock.mockResolvedValue([ctx])

    await run({
      adapter: 'codex',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-runtime-mcp-shadow',
      runtimeMcpServers: {
        'channel-lark-default': {
          command: process.execPath,
          args: ['/tmp/channel-lark-mcp.js']
        }
      },
      onEvent: vi.fn()
    })

    expect(queryMock.mock.calls[0]?.[1]).toMatchObject({
      assetPlan: {
        mcpServers: {
          'channel-lark-default': {
            command: process.execPath,
            args: ['/tmp/workspace-mcp.js']
          }
        }
      }
    })
    expect(ctx.logger.warn).toHaveBeenCalledWith({
      runtimeMcpServerNames: ['channel-lark-default']
    }, '[mcp] Ignoring session companion MCP servers that would shadow workspace MCP servers')
  })

  it.each(['http', 'sse'] as const)(
    'keeps a selected Kiro %s workspace MCP claim ahead of a same-name runtime stdio companion',
    async (transport) => {
      const ctx = createCtx()
      ctx.configs = [{ adapters: createAdapters({ kiro: {} }) }, undefined]
      ctx.assets.mcpServers.companion = {
        id: `mcp-kiro-${transport}`,
        kind: 'mcpServer',
        name: 'companion',
        displayName: 'companion',
        origin: 'workspace',
        sourcePath: `/tmp/project/.oo/mcp/companion-${transport}.json`,
        payload: {
          name: 'companion',
          config: transport === 'http'
            ? { type: 'http', url: 'https://example.test/mcp' }
            : { type: 'sse', url: 'https://example.test/events', headers: {} }
        }
      }
      ctx.assets.assets.push(ctx.assets.mcpServers.companion)
      prepareMock.mockResolvedValue([ctx])

      await run({ adapter: 'kiro', cwd: ctx.cwd, env: {} }, {
        type: 'create',
        runtime: 'server',
        sessionId: `session-kiro-workspace-runtime-shadow-${transport}`,
        mcpServers: { include: ['companion'] },
        runtimeMcpServers: {
          companion: {
            command: process.execPath,
            args: ['/tmp/runtime-companion-mcp.js']
          }
        },
        onEvent: vi.fn()
      })

      const assetPlan = queryMock.mock.calls[0]?.[1]?.assetPlan
      expect(assetPlan?.mcpServers).not.toHaveProperty('companion')
      expect(
        assetPlan?.diagnostics.filter(
          (diagnostic: AssetDiagnostic) => diagnostic.assetId === `mcp-kiro-${transport}`
        )
      ).toEqual([
        expect.objectContaining({
          status: 'skipped',
          reason: expect.stringContaining(`${transport.toUpperCase()} transport was skipped`)
        })
      ])
      expect(assetPlan?.diagnostics).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ assetId: `mcp-kiro-${transport}`, status: 'translated' }),
        expect.objectContaining({ assetId: 'runtime-mcp:companion' })
      ]))
      expect(ctx.logger.warn).toHaveBeenCalledWith({
        runtimeMcpServerNames: ['companion']
      }, '[mcp] Ignoring session companion MCP servers that would shadow workspace MCP servers')
    }
  )

  it('keeps Codex remote workspace MCP precedence over a same-name runtime stdio companion', async () => {
    const ctx = createCtx()
    ctx.assets.mcpServers.companion = {
      id: 'mcp-codex-http',
      kind: 'mcpServer',
      name: 'companion',
      displayName: 'companion',
      origin: 'workspace',
      sourcePath: '/tmp/project/.oo/mcp/companion-http.json',
      payload: {
        name: 'companion',
        config: { type: 'http', url: 'https://example.test/mcp' }
      }
    }
    ctx.assets.assets.push(ctx.assets.mcpServers.companion)
    prepareMock.mockResolvedValue([ctx])

    await run({ adapter: 'codex', cwd: ctx.cwd, env: {} }, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-codex-remote-workspace-runtime-shadow',
      runtimeMcpServers: {
        companion: { command: process.execPath, args: ['/tmp/runtime-companion-mcp.js'] }
      },
      onEvent: vi.fn()
    })

    expect(queryMock.mock.calls[0]?.[1]?.assetPlan).toMatchObject({
      mcpServers: {
        companion: { type: 'http', url: 'https://example.test/mcp' }
      },
      diagnostics: [expect.objectContaining({ assetId: 'mcp-codex-http', status: 'translated' })]
    })
    expect(ctx.logger.warn).toHaveBeenCalledWith({
      runtimeMcpServerNames: ['companion']
    }, '[mcp] Ignoring session companion MCP servers that would shadow workspace MCP servers')
  })

  it('disables overlapping bridge events when claude native hooks are active', async () => {
    const ctx = createCtx()
    ctx.env.__ONEWORKS_PROJECT_CLAUDE_NATIVE_HOOKS_AVAILABLE__ = '1'
    ctx.configs = [{
      adapters: createAdapters({
        'claude-code': {}
      })
    }, undefined]
    prepareMock.mockResolvedValue([ctx])

    await run({
      adapter: 'claude-code',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-claude-native',
      description: 'hello',
      onEvent: vi.fn()
    })

    expect(createAdapterHookBridgeMock).toHaveBeenCalledWith(expect.objectContaining({
      adapter: 'claude-code',
      disabledEvents: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']
    }))
  })

  it('disables only native opencode hook events when the managed plugin bridge is active', async () => {
    const ctx = createCtx()
    ctx.env.__ONEWORKS_PROJECT_OPENCODE_NATIVE_HOOKS_AVAILABLE__ = '1'
    ctx.configs = [{
      adapters: createAdapters({
        opencode: {}
      })
    }, undefined]
    prepareMock.mockResolvedValue([ctx])

    await run({
      adapter: 'opencode',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-opencode-native',
      description: 'hello',
      onEvent: vi.fn()
    })

    expect(createAdapterHookBridgeMock).toHaveBeenCalledWith(expect.objectContaining({
      adapter: 'opencode',
      disabledEvents: ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop']
    }))
  })

  it('disables only Copilot native hook events when the managed settings bridge is active', async () => {
    const ctx = createCtx()
    ctx.env.__ONEWORKS_PROJECT_COPILOT_NATIVE_HOOKS_AVAILABLE__ = '1'
    ctx.configs = [{
      adapters: createAdapters({
        copilot: {}
      })
    }, undefined] as AdapterCtx['configs']
    prepareMock.mockResolvedValue([ctx])

    await run({
      adapter: 'copilot',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-copilot-native',
      description: 'hello',
      onEvent: vi.fn()
    })

    expect(createAdapterHookBridgeMock).toHaveBeenCalledWith(expect.objectContaining({
      adapter: 'copilot',
      disabledEvents: ['PreToolUse', 'PostToolUse', 'Stop']
    }))
  })

  it('disables overlapping bridge events when Cursor native hooks are active', async () => {
    const ctx = createCtx()
    ctx.env.__ONEWORKS_PROJECT_CURSOR_NATIVE_HOOKS_AVAILABLE__ = '1'
    ctx.configs = [{
      adapters: createAdapters({
        cursor: {}
      })
    }, undefined] as AdapterCtx['configs']
    prepareMock.mockResolvedValue([ctx])

    await run({
      adapter: 'cursor',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-cursor-native',
      description: 'hello',
      onEvent: vi.fn()
    })

    expect(createAdapterHookBridgeMock).toHaveBeenCalledWith(expect.objectContaining({
      adapter: 'cursor',
      disabledEvents: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']
    }))
  })

  it('keeps the One Works hook bridge active for Goose because ACP exposes no native hook contract', async () => {
    const ctx = createCtx()
    ctx.configs = [{
      adapters: createAdapters({ goose: {} })
    }, undefined] as AdapterCtx['configs']
    prepareMock.mockResolvedValue([ctx])

    await run({
      adapter: 'goose',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-goose-hooks',
      description: 'hello',
      onEvent: vi.fn()
    })

    expect(createAdapterHookBridgeMock).toHaveBeenCalledWith(expect.objectContaining({
      adapter: 'goose',
      disabledEvents: []
    }))
  })

  it('disables overlapping bridge events when Kiro native hooks are active', async () => {
    const ctx = createCtx()
    ctx.env.__ONEWORKS_PROJECT_KIRO_NATIVE_HOOKS_AVAILABLE__ = '1'
    ctx.configs = [{
      adapters: createAdapters({
        kiro: {}
      })
    }, undefined] as AdapterCtx['configs']
    prepareMock.mockResolvedValue([ctx])

    await run({
      adapter: 'kiro',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-kiro-native',
      description: 'hello',
      onEvent: vi.fn()
    })

    expect(createAdapterHookBridgeMock).toHaveBeenCalledWith(expect.objectContaining({
      adapter: 'kiro',
      disabledEvents: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']
    }))
  })

  it('disables only verified Junie headless native hook events', async () => {
    const ctx = createCtx()
    ctx.env.__ONEWORKS_PROJECT_JUNIE_NATIVE_HOOKS_AVAILABLE__ = '1'
    ctx.configs = [{
      adapters: createAdapters({ junie: {} })
    }, undefined] as AdapterCtx['configs']
    prepareMock.mockResolvedValue([ctx])

    await run({ adapter: 'junie', cwd: ctx.cwd, env: {} }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-junie-native',
      description: 'hello',
      onEvent: vi.fn()
    })

    expect(createAdapterHookBridgeMock).toHaveBeenCalledWith(expect.objectContaining({
      adapter: 'junie',
      disabledEvents: ['SessionStart', 'SessionEnd', 'PreToolUse', 'Stop', 'StopFailure']
    }))
  })

  it('disables every Factory event handled by the Droid native hook bridge', async () => {
    const ctx = createCtx()
    ctx.env.__ONEWORKS_PROJECT_DROID_NATIVE_HOOKS_AVAILABLE__ = '1'
    ctx.configs = [{
      adapters: createAdapters({
        droid: {}
      })
    }, undefined] as AdapterCtx['configs']
    prepareMock.mockResolvedValue([ctx])

    await run({
      adapter: 'droid',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-droid-native',
      description: 'hello',
      onEvent: vi.fn()
    })

    expect(createAdapterHookBridgeMock).toHaveBeenCalledWith(expect.objectContaining({
      adapter: 'droid',
      disabledEvents: [
        'SessionStart',
        'UserPromptSubmit',
        'PreToolUse',
        'PostToolUse',
        'Stop',
        'Notification',
        'SubagentStop',
        'PreCompact',
        'SessionEnd'
      ]
    }))
  })

  it('preserves contribution-layered Droid config through the real task init and query boundary', async () => {
    const ctx = createCtx()
    const effectiveProjectConfig = {
      adapters: createAdapters({
        droid: {
          cli: {
            source: 'managed',
            package: '@fixture/project-droid'
          },
          configContent: {
            nested: { project: true, tombstone: 'remove' }
          },
          accounts: {
            team: { title: 'Project Team', description: 'Project description' },
            retired: { title: 'Retired' }
          },
          defaultAccount: 'team'
        },
        cursor: { cli: { source: 'system' } }
      })
    }
    const userConfig = {
      adapters: createAdapters({
        droid: {
          cli: { version: '0.195.7' },
          configContent: {
            nested: { user: true, tombstone: null }
          },
          accounts: {
            team: { description: 'User description' },
            retired: null
          },
          effort: 'xhigh'
        }
      })
    }
    ctx.configs = [effectiveProjectConfig, userConfig] as AdapterCtx['configs']
    ctx.configState = {
      effectiveProjectConfig,
      projectConfig: {
        adapters: createAdapters({ droid: { cli: { package: '@fixture/raw-only' } } })
      },
      userConfig,
      mergedConfig: {
        adapters: createAdapters({ droid: { cli: { version: 'shallow-only' }, effort: 'xhigh' } })
      }
    }
    const sourceSnapshot = structuredClone({ effectiveProjectConfig, userConfig })
    const resolutions: ReturnType<typeof resolveDroidAdapterConfig>[] = []
    initMock.mockImplementation(async (runtimeCtx: AdapterCtx) => {
      resolutions.push(resolveDroidAdapterConfig(runtimeCtx))
    })
    queryMock.mockImplementation(async (runtimeCtx: AdapterCtx) => {
      resolutions.push(resolveDroidAdapterConfig(runtimeCtx))
      return { emit: vi.fn(), kill: vi.fn() }
    })
    prepareMock.mockResolvedValue([ctx])

    await run({ adapter: 'droid', cwd: ctx.cwd, env: {} }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-droid-layered',
      description: 'layered config',
      onEvent: vi.fn()
    })

    const expectedResolution = {
      entry: {
        cli: {
          source: 'managed',
          package: '@fixture/project-droid',
          version: '0.195.7'
        },
        configContent: {
          nested: { project: true, tombstone: null, user: true }
        },
        accounts: {
          team: { title: 'Project Team', description: 'User description' },
          retired: null
        },
        defaultAccount: 'team',
        effort: 'xhigh'
      },
      common: {
        accounts: {
          team: { title: 'Project Team', description: 'User description' },
          retired: null
        },
        defaultAccount: 'team',
        effort: 'xhigh'
      },
      native: {
        cli: {
          source: 'managed',
          package: '@fixture/project-droid',
          version: '0.195.7'
        },
        configContent: {
          nested: { project: true, tombstone: null, user: true }
        }
      }
    }
    expect(resolutions).toEqual([expectedResolution, expectedResolution])
    expect({ effectiveProjectConfig, userConfig }).toEqual(sourceSnapshot)
    expect(effectiveProjectConfig.adapters.cursor).toEqual({ cli: { source: 'system' } })
  })

  it('disables overlapping bridge events when kimi native hooks are active', async () => {
    const ctx = createCtx()
    ctx.env.__ONEWORKS_PROJECT_KIMI_NATIVE_HOOKS_AVAILABLE__ = '1'
    ctx.configs = [{
      adapters: createAdapters({
        kimi: {}
      })
    }, undefined] as AdapterCtx['configs']
    prepareMock.mockResolvedValue([ctx])

    await run({
      adapter: 'kimi',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-kimi-native',
      description: 'hello',
      onEvent: vi.fn()
    })

    expect(createAdapterHookBridgeMock).toHaveBeenCalledWith(expect.objectContaining({
      adapter: 'kimi',
      disabledEvents: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']
    }))
  })

  it('disables overlapping bridge events when gemini native hooks are active', async () => {
    const ctx = createCtx()
    ctx.env.__ONEWORKS_PROJECT_GEMINI_NATIVE_HOOKS_AVAILABLE__ = '1'
    ctx.configs = [{
      adapters: createAdapters({
        gemini: {}
      })
    }, undefined] as AdapterCtx['configs']
    prepareMock.mockResolvedValue([ctx])

    await run({
      adapter: 'gemini',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-gemini-native',
      description: 'hello',
      onEvent: vi.fn()
    })

    expect(createAdapterHookBridgeMock).toHaveBeenCalledWith(expect.objectContaining({
      adapter: 'gemini',
      disabledEvents: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']
    }))
  })

  it('disables overlapping bridge events when Qwen Code native hooks are active', async () => {
    const ctx = createCtx()
    ctx.env.__ONEWORKS_PROJECT_QWEN_CODE_NATIVE_HOOKS_AVAILABLE__ = '1'
    ctx.configs = [{
      adapters: createAdapters({
        'qwen-code': {}
      })
    }, undefined] as AdapterCtx['configs']
    prepareMock.mockResolvedValue([ctx])

    await run({
      adapter: 'qwen-code',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-qwen-code-native',
      description: 'hello',
      onEvent: vi.fn()
    })

    expect(createAdapterHookBridgeMock).toHaveBeenCalledWith(expect.objectContaining({
      adapter: 'qwen-code',
      disabledEvents: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']
    }))
  })

  it('prefers exact model selector metadata over service metadata for default adapter resolution', async () => {
    const ctx = createCtx()
    ctx.configs = [{
      adapters: createAdapters({
        codex: {},
        'claude-code': {}
      }),
      models: {
        serviceA: {
          defaultAdapter: 'claude-code'
        },
        'serviceA,modelX': {
          defaultAdapter: 'codex'
        }
      },
      modelServices: {
        serviceA: {
          apiBaseUrl: 'https://service-a.example.com',
          apiKey: 'token-a',
          models: ['modelX']
        }
      },
      defaultModelService: 'serviceA',
      defaultModel: 'modelX'
    }, undefined]
    prepareMock.mockResolvedValue([ctx])

    await run({
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-model-selector',
      onEvent: vi.fn()
    })

    expect(loadAdapterMock).toHaveBeenCalledWith('codex')
    expect(queryMock.mock.calls[0]?.[1]).toMatchObject({
      model: 'serviceA,modelX'
    })
  })

  it('uses adapter-level defaultModel before falling back to global default model', async () => {
    const ctx = createCtx()
    ctx.configs = [{
      adapters: createAdapters({
        codex: {
          defaultModel: 'serviceA,modelB'
        },
        'claude-code': {}
      }),
      defaultModel: 'serviceA,modelA',
      modelServices: {
        serviceA: {
          apiBaseUrl: 'https://service-a.example.com',
          apiKey: 'token-a',
          models: ['modelA', 'modelB']
        }
      }
    }, undefined]
    prepareMock.mockResolvedValue([ctx])

    await run({
      adapter: 'codex',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-adapter-model',
      onEvent: vi.fn()
    })

    expect(queryMock.mock.calls[0]?.[1]).toMatchObject({
      model: 'serviceA,modelB'
    })
  })

  it('falls back to adapter defaultModel and emits a selection warning when rules reject the chosen model', async () => {
    const ctx = createCtx()
    const onEvent = vi.fn()
    queryMock.mockImplementation(async (_ctx, options) => {
      options.onEvent({
        type: 'init',
        data: {
          uuid: 'adapter-init',
          model: options.model ?? 'serviceA,modelA',
          version: '1.0.0',
          tools: [],
          slashCommands: [],
          cwd: '/tmp/project',
          agents: []
        }
      })
      return {
        kill: vi.fn(),
        emit: vi.fn()
      }
    })
    ctx.configs = [{
      adapters: createAdapters({
        codex: {
          defaultModel: 'serviceA,modelB',
          excludeModels: ['serviceA,modelA']
        }
      }),
      modelServices: {
        serviceA: {
          apiBaseUrl: 'https://service-a.example.com',
          apiKey: 'token-a',
          models: ['modelA', 'modelB']
        }
      }
    }, undefined]
    prepareMock.mockResolvedValue([ctx])

    await run({
      adapter: 'codex',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-adapter-model-rules',
      model: 'serviceA,modelA',
      onEvent
    })

    expect(queryMock.mock.calls[0]?.[1]).toMatchObject({
      model: 'serviceA,modelB'
    })
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'init',
      data: expect.objectContaining({
        selectionWarnings: [
          expect.objectContaining({
            adapter: 'codex',
            requestedModel: 'serviceA,modelA',
            resolvedModel: 'serviceA,modelB',
            reason: 'excluded'
          })
        ]
      })
    }))
  })

  it('allows the literal default model even when includeModels is configured', async () => {
    const ctx = createCtx()
    ctx.configs = [{
      adapters: createAdapters({
        opencode: {
          includeModels: ['serviceA']
        }
      }),
      modelServices: {
        serviceA: {
          apiBaseUrl: 'https://service-a.example.com',
          apiKey: 'token-a',
          models: ['modelA']
        }
      }
    }, undefined]
    prepareMock.mockResolvedValue([ctx])

    await run({
      adapter: 'opencode',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-default-model-allowed',
      model: 'default',
      onEvent: vi.fn()
    })

    expect(queryMock.mock.calls[0]?.[1]).toMatchObject({
      model: 'default'
    })
  })

  it('throws when adapter rules reject the selected model and defaultModel is missing', async () => {
    const ctx = createCtx()
    ctx.configs = [{
      adapters: createAdapters({
        codex: {
          includeModels: ['serviceB']
        }
      }),
      modelServices: {
        serviceA: {
          apiBaseUrl: 'https://service-a.example.com',
          apiKey: 'token-a',
          models: ['modelA']
        },
        serviceB: {
          apiBaseUrl: 'https://service-b.example.com',
          apiKey: 'token-b',
          models: ['modelB']
        }
      }
    }, undefined]
    prepareMock.mockResolvedValue([ctx])

    await expect(run({
      adapter: 'codex',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-adapter-model-rules-error',
      model: 'serviceA,modelA',
      onEvent: vi.fn()
    })).rejects.toThrow('Configure adapters.codex.defaultModel to continue')
  })

  it('prefers user config model selector metadata over project config', async () => {
    const ctx = createCtx()
    ctx.configs = [{
      adapters: createAdapters({
        codex: {},
        'claude-code': {}
      }),
      models: {
        serviceA: {
          defaultAdapter: 'claude-code'
        }
      },
      modelServices: {
        serviceA: {
          apiBaseUrl: 'https://service-a.example.com',
          apiKey: 'token-a',
          models: ['modelX']
        }
      },
      defaultModelService: 'serviceA',
      defaultModel: 'modelX'
    }, {
      models: {
        serviceA: {
          defaultAdapter: 'codex'
        }
      }
    }]
    prepareMock.mockResolvedValue([ctx])

    await run({
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-user-override',
      onEvent: vi.fn()
    })

    expect(loadAdapterMock).toHaveBeenCalledWith('codex')
  })

  it('enqueues TaskStop after pending output hooks and before passing exit to the bridge', async () => {
    const ctx = createCtx()
    const postToolUseFinished = Promise.withResolvers<void>()
    const lifecycle: string[] = []
    const scheduled: string[] = []
    let outputQueue: Promise<unknown> = Promise.resolve()
    const enqueueAfterPendingHooks = vi.fn((runHook: () => Promise<unknown>) => {
      scheduled.push('TaskStop')
      outputQueue = outputQueue.catch(() => undefined).then(runHook)
    })
    const handleOutput = vi.fn((event: { type: string; data?: { toolCall?: { output?: unknown } } }) => {
      if (event.type === 'message' && event.data?.toolCall?.output != null) {
        outputQueue = outputQueue.then(async () => {
          lifecycle.push('PostToolUse:start')
          await postToolUseFinished.promise
          lifecycle.push('PostToolUse:end')
        })
      }
      if (event.type === 'exit') {
        scheduled.push('SessionEnd')
        outputQueue = outputQueue.catch(() => undefined).then(() => {
          lifecycle.push('SessionEnd')
        })
      }
    })
    const flush = vi.fn(async () => {
      await outputQueue
    })
    let emitEvent: ((event: unknown) => void) | undefined

    createAdapterHookBridgeMock.mockReturnValue({
      start: vi.fn().mockResolvedValue(undefined),
      prepareInitialPrompt: vi.fn(async (prompt?: string) => prompt),
      wrapSession: vi.fn((session: unknown) => session),
      enqueueAfterPendingHooks,
      handleOutput,
      flush
    })
    queryMock.mockImplementation(async (_ctx, options) => {
      emitEvent = options.onEvent
      return { kill: vi.fn(), emit: vi.fn() }
    })
    callHookMock.mockImplementation(async (eventName) => {
      if (eventName === 'TaskStop') lifecycle.push('TaskStop')
      return { continue: true }
    })
    prepareMock.mockResolvedValue([ctx])

    const result = await run({
      adapter: 'codex',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-task-stop-order',
      onEvent: vi.fn()
    })

    expect(emitEvent).toBeDefined()
    emitEvent?.({
      type: 'message',
      data: {
        id: 'tool-result-1',
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        toolCall: { id: 'tool-1', name: 'Read', args: {}, output: 'done', status: 'success' }
      }
    })
    emitEvent?.({ type: 'exit', data: { exitCode: 0 } })

    await vi.waitFor(() => expect(lifecycle).toContain('PostToolUse:start'))
    expect(handleOutput).toHaveBeenCalledWith(expect.objectContaining({
      type: 'message',
      data: expect.objectContaining({ toolCall: expect.objectContaining({ output: 'done' }) })
    }))
    expect(scheduled).toEqual(['TaskStop', 'SessionEnd'])
    expect(callHookMock.mock.calls.some(([eventName]) => eventName === 'TaskStop')).toBe(false)

    postToolUseFinished.resolve()
    await result.session.flushHooks()

    expect(lifecycle).toEqual([
      'PostToolUse:start',
      'PostToolUse:end',
      'TaskStop',
      'SessionEnd'
    ])
  })

  it('keeps Goose secrets redacted through the server-facing broadcast and TaskStop hook', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'oneworks-goose-task-redaction-'))
    try {
      const secret = 'sk-goose-task-secret-value-12345'
      const projectHome = resolve(root, 'project-home')
      const ctx = createCtx()
      ctx.cwd = root
      ctx.env = {
        __ONEWORKS_PROJECT_ADAPTER_GOOSE_CLI_PATH__: resolve(
          dirname(fileURLToPath(import.meta.url)),
          '../../adapters/goose/__tests__/fixtures/fake-goose-acp.mjs'
        ),
        __ONEWORKS_PROJECT_ADAPTER_GOOSE_CONFIG_DIR__: resolve(root, 'missing-native-config'),
        __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: projectHome,
        GOOSE_FAKE_LEAK: '1',
        GOOSE_FAKE_LEAK_ENV_NAME: 'OPENAI_API_KEY',
        GOOSE_MODEL: 'fixture-model',
        GOOSE_PROVIDER: 'openai',
        OPENAI_API_KEY: secret
      }
      ctx.configs = [{
        adapters: createAdapters({
          goose: { inheritNativeAuth: false, provider: 'openai' }
        })
      }, undefined]
      prepareMock.mockResolvedValue([ctx])
      loadAdapterMock.mockResolvedValue({
        init: vi.fn().mockResolvedValue(undefined),
        query: gooseAdapter.query,
        sanitizeRuntimeArtifact: gooseAdapter.sanitizeRuntimeArtifact
      })

      let hookQueue = Promise.resolve()
      const hookOutput = vi.fn()
      createAdapterHookBridgeMock.mockReturnValue({
        start: vi.fn().mockResolvedValue(undefined),
        prepareInitialPrompt: vi.fn(async (prompt?: string) => prompt),
        wrapSession: vi.fn((session: unknown) => session),
        enqueueAfterPendingHooks: vi.fn((runHook: () => Promise<unknown>) => {
          hookQueue = hookQueue.catch(() => undefined).then(runHook).then(() => undefined)
        }),
        handleOutput: hookOutput,
        flush: vi.fn(async () => {
          await hookQueue
        })
      })
      const broadcast = vi.fn<(event: AdapterOutputEvent) => void>()

      const result = await run({ adapter: 'goose', cwd: root, env: {} }, {
        type: 'create',
        runtime: 'server',
        sessionId: 'session-goose-redaction',
        model: 'default',
        description: 'Run the redaction fixture.',
        permissionMode: 'bypassPermissions',
        onEvent: broadcast
      })
      await vi.waitFor(() => {
        expect(broadcast.mock.calls.some(([event]) => event.type === 'stop')).toBe(true)
      })
      result.session.stop?.()
      await vi.waitFor(() => {
        expect(broadcast.mock.calls.some(([event]) => event.type === 'exit')).toBe(true)
      })
      await result.session.flushHooks?.()

      const artifacts = JSON.stringify({
        broadcast: broadcast.mock.calls,
        cache: (ctx.cache.set as ReturnType<typeof vi.fn>).mock.calls,
        hookCalls: callHookMock.mock.calls,
        hookOutput: hookOutput.mock.calls,
        logger: {
          debug: (ctx.logger.debug as ReturnType<typeof vi.fn>).mock.calls,
          error: (ctx.logger.error as ReturnType<typeof vi.fn>).mock.calls,
          info: (ctx.logger.info as ReturnType<typeof vi.fn>).mock.calls,
          warn: (ctx.logger.warn as ReturnType<typeof vi.fn>).mock.calls
        }
      })
      expect(artifacts).not.toContain(secret)
      expect(artifacts).not.toContain(encodeURIComponent(secret))
      expect(artifacts).not.toContain(Buffer.from(secret).toString('base64'))
      expect(artifacts).not.toContain(resolve(projectHome, 'caches'))
      expect(artifacts).toContain('[REDACTED]')
      expect(artifacts).toContain('[GOOSE_SESSION_ROOT]')
      expect(callHookMock.mock.calls.filter(([eventName]) => eventName === 'TaskStop')).toHaveLength(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)

  it('keeps a rejected Goose startup RPC redacted across task, server, cache, logger, and hooks', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'oneworks-goose-startup-redaction-'))
    try {
      const secret = 'sk-goose-startup-task-secret-value-12345'
      const projectHome = resolve(root, 'project-home')
      const ctx = createCtx()
      ctx.cwd = root
      ctx.env = {
        __ONEWORKS_PROJECT_ADAPTER_GOOSE_CLI_PATH__: resolve(
          dirname(fileURLToPath(import.meta.url)),
          '../../adapters/goose/__tests__/fixtures/fake-goose-acp.mjs'
        ),
        __ONEWORKS_PROJECT_ADAPTER_GOOSE_CONFIG_DIR__: resolve(root, 'missing-native-config'),
        __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: projectHome,
        GOOSE_FAKE_LEAK: '1',
        GOOSE_FAKE_LEAK_ENV_NAME: 'OPENAI_API_KEY',
        GOOSE_FAKE_STARTUP_ERROR_METHOD: 'initialize',
        GOOSE_MODEL: 'fixture-model',
        GOOSE_PROVIDER: 'openai',
        OPENAI_API_KEY: secret
      }
      ctx.configs = [{
        adapters: createAdapters({
          goose: { inheritNativeAuth: false, provider: 'openai' }
        })
      }, undefined]
      prepareMock.mockResolvedValue([ctx])
      loadAdapterMock.mockResolvedValue({
        init: vi.fn().mockResolvedValue(undefined),
        query: gooseAdapter.query,
        sanitizeRuntimeArtifact: gooseAdapter.sanitizeRuntimeArtifact
      })

      let hookQueue = Promise.resolve()
      const hookOutput = vi.fn()
      createAdapterHookBridgeMock.mockReturnValue({
        start: vi.fn().mockResolvedValue(undefined),
        prepareInitialPrompt: vi.fn(async (prompt?: string) => prompt),
        wrapSession: vi.fn((session: unknown) => session),
        enqueueAfterPendingHooks: vi.fn((runHook: () => Promise<unknown>) => {
          hookQueue = hookQueue.catch(() => undefined).then(runHook).then(() => undefined)
        }),
        handleOutput: hookOutput,
        flush: vi.fn(async () => {
          await hookQueue
        })
      })
      const broadcast = vi.fn<(event: AdapterOutputEvent) => void>()
      let thrown: unknown

      try {
        await run({ adapter: 'goose', cwd: root, env: {} }, {
          type: 'create',
          runtime: 'server',
          sessionId: 'session-goose-startup-redaction',
          model: 'default',
          description: 'Run the startup failure fixture.',
          permissionMode: 'bypassPermissions',
          onEvent: broadcast
        })
      } catch (error) {
        thrown = error
      }
      await vi.waitFor(() => {
        expect(broadcast.mock.calls.filter(([event]) => event.type === 'exit')).toHaveLength(1)
      })
      await vi.waitFor(() => {
        expect(callHookMock.mock.calls.filter(([eventName]) => eventName === 'TaskStop')).toHaveLength(1)
      })
      await hookQueue

      expect(thrown).toBeInstanceOf(Error)
      const startupError = thrown as Error & { code?: number | string; context?: string }
      expect(startupError.name).toBe('GooseAcpStartupError')
      expect(startupError.context).toBe('initialize request')
      const artifacts = JSON.stringify({
        broadcast: broadcast.mock.calls,
        cache: (ctx.cache.set as ReturnType<typeof vi.fn>).mock.calls,
        error: {
          code: startupError.code,
          context: startupError.context,
          message: startupError.message,
          name: startupError.name,
          stack: startupError.stack
        },
        hookCalls: callHookMock.mock.calls,
        hookOutput: hookOutput.mock.calls,
        logger: {
          debug: (ctx.logger.debug as ReturnType<typeof vi.fn>).mock.calls,
          error: (ctx.logger.error as ReturnType<typeof vi.fn>).mock.calls,
          info: (ctx.logger.info as ReturnType<typeof vi.fn>).mock.calls,
          warn: (ctx.logger.warn as ReturnType<typeof vi.fn>).mock.calls
        }
      })
      expect(artifacts).not.toContain(secret)
      expect(artifacts).not.toContain(encodeURIComponent(secret))
      expect(artifacts).not.toContain(Buffer.from(secret).toString('base64'))
      expect(artifacts).not.toContain(resolve(projectHome, 'caches'))
      expect(artifacts).toContain('[REDACTED]')
      expect(artifacts).toContain('[GOOSE_SESSION_ROOT]')
      expect(callHookMock.mock.calls.filter(([eventName]) => eventName === 'TaskStart')).toHaveLength(1)
      expect(callHookMock.mock.calls.filter(([eventName]) => eventName === 'TaskStop')).toHaveLength(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)

  it(
    'scrubs config-only Goose credentials from create/resume artifacts while delivering them to the child',
    async () => {
      const root = await mkdtemp(resolve(tmpdir(), 'oneworks-goose-config-redaction-'))
      try {
        const secrets = {
          apiKey: 'config-only-model-service-api-key',
          management: 'config-only-management-api-key',
          profile: 'config-only-profile-access-token',
          extra: 'config-only-extra-client-secret'
        }
        const logPath = resolve(root, 'fake-goose-acp.jsonl')
        const ctx = createCtx()
        const cache = new Map<string, unknown>()
        ctx.cwd = root
        ctx.env = {
          __ONEWORKS_PROJECT_ADAPTER_GOOSE_CLI_PATH__: resolve(
            dirname(fileURLToPath(import.meta.url)),
            '../../adapters/goose/__tests__/fixtures/fake-goose-acp.mjs'
          ),
          __ONEWORKS_PROJECT_ADAPTER_GOOSE_CONFIG_DIR__: resolve(root, 'missing-native-config'),
          __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: resolve(root, 'project-home'),
          GOOSE_FAKE_LOG_FILE: logPath
        }
        const configured = {
          adapters: createAdapters({ goose: { inheritNativeAuth: false } }),
          modelServices: {
            private: {
              apiBaseUrl: 'https://models.example.test/v1',
              apiKey: secrets.apiKey,
              apiProtocol: 'openai-chat-completions' as const,
              management: { apiKey: secrets.management },
              models: ['fixture-model'],
              profiles: {
                coding: {
                  apiBaseUrl: 'https://profile.example.test/v1',
                  apiKey: secrets.profile,
                  apiProtocol: 'openai-chat-completions' as const,
                  extra: { clientSecret: secrets.extra },
                  models: ['fixture-model']
                }
              },
              providerOptions: {
                accessToken: secrets.profile,
                collection: [{ credentials: { mode: 'bearer', token: secrets.extra } }]
              }
            }
          }
        }
        ctx.configs = [configured, undefined]
        ctx.configState = {
          effectiveProjectConfig: configured,
          mergedConfig: configured,
          projectConfig: configured,
          userConfig: {
            modelServices: {
              user: {
                apiBaseUrl: 'https://user.example.test/v1',
                apiKey: secrets.extra,
                models: ['fixture-model']
              }
            }
          }
        }
        ctx.cache = {
          get: vi.fn(async key => cache.get(key) as never),
          set: vi.fn(async (key, value) => {
            cache.set(key, value)
            return { cachePath: resolve(root, `${String(key)}.json`) }
          })
        }
        prepareMock.mockResolvedValue([ctx])
        loadAdapterMock.mockResolvedValue({
          init: vi.fn().mockResolvedValue(undefined),
          query: gooseAdapter.query,
          sanitizeRuntimeArtifact: gooseAdapter.sanitizeRuntimeArtifact
        })

        let hookQueue = Promise.resolve()
        const hookOutput = vi.fn()
        createAdapterHookBridgeMock.mockReturnValue({
          start: vi.fn().mockResolvedValue(undefined),
          prepareInitialPrompt: vi.fn(async (prompt?: string) => prompt),
          wrapSession: vi.fn((session: unknown) => session),
          enqueueAfterPendingHooks: vi.fn((runHook: () => Promise<unknown>) => {
            hookQueue = hookQueue.catch(() => undefined).then(runHook).then(() => undefined)
          }),
          handleOutput: hookOutput,
          flush: vi.fn(async () => {
            await hookQueue
          })
        })
        const broadcasts: AdapterOutputEvent[][] = []
        for (const type of ['create', 'resume'] as const) {
          const broadcast = vi.fn<(event: AdapterOutputEvent) => void>()
          const result = await run({ adapter: 'goose', cwd: root, env: {} }, {
            type,
            runtime: 'server',
            sessionId: 'session-goose-config-redaction',
            model: 'private,fixture-model',
            description: `${type} with config-only credentials.`,
            permissionMode: 'bypassPermissions',
            onEvent: broadcast
          })
          await vi.waitFor(() => {
            expect(broadcast.mock.calls.some(([event]) => event.type === 'stop')).toBe(true)
          })
          result.session.stop?.()
          await vi.waitFor(() => {
            expect(broadcast.mock.calls.some(([event]) => event.type === 'exit')).toBe(true)
          })
          await result.session.flushHooks?.()
          broadcasts.push(broadcast.mock.calls.map(([event]) => event))
        }

        const childLog = (await readFile(logPath, 'utf8')).trim().split('\n').map(line =>
          JSON.parse(line) as {
            method?: string
            routedCredentialPresent?: boolean
            startup?: boolean
          }
        )
        expect(childLog.filter(entry => entry.startup).map(entry => entry.routedCredentialPresent)).toEqual([
          true,
          true
        ])
        expect(childLog.some(entry => entry.method === 'session/load')).toBe(true)

        const artifacts = JSON.stringify({
          broadcasts,
          cacheCalls: (ctx.cache.set as ReturnType<typeof vi.fn>).mock.calls,
          cachedBase: cache.get('base'),
          hookCalls: callHookMock.mock.calls,
          hookOutput: hookOutput.mock.calls,
          logger: {
            debug: (ctx.logger.debug as ReturnType<typeof vi.fn>).mock.calls,
            error: (ctx.logger.error as ReturnType<typeof vi.fn>).mock.calls,
            info: (ctx.logger.info as ReturnType<typeof vi.fn>).mock.calls,
            warn: (ctx.logger.warn as ReturnType<typeof vi.fn>).mock.calls
          }
        })
        for (const secret of Object.values(secrets)) {
          expect(artifacts).not.toContain(secret)
          expect(artifacts).not.toContain(encodeURIComponent(secret))
          expect(artifacts).not.toContain(Buffer.from(secret).toString('base64'))
        }
        expect(callHookMock.mock.calls.filter(([eventName]) => eventName === 'TaskStart')).toHaveLength(2)
        expect(callHookMock.mock.calls.filter(([eventName]) => eventName === 'TaskStop')).toHaveLength(2)
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
    30_000
  )

  it('logs a rejected TaskStop and still lets the bridge finish SessionEnd', async () => {
    const ctx = createCtx()
    const lifecycle: string[] = []
    const taskStopError = new Error('TaskStop rejected')
    let outputQueue: Promise<unknown> = Promise.resolve()
    let emitEvent: ((event: unknown) => void) | undefined

    createAdapterHookBridgeMock.mockReturnValue({
      start: vi.fn().mockResolvedValue(undefined),
      prepareInitialPrompt: vi.fn(async (prompt?: string) => prompt),
      wrapSession: vi.fn((session: unknown) => session),
      enqueueAfterPendingHooks: vi.fn((runHook: () => Promise<unknown>) => {
        outputQueue = outputQueue.catch(() => undefined).then(runHook)
      }),
      handleOutput: vi.fn((event: { type: string }) => {
        if (event.type !== 'exit') return
        outputQueue = outputQueue.catch(() => undefined).then(() => {
          lifecycle.push('SessionEnd')
        })
      }),
      flush: vi.fn(async () => {
        await outputQueue
      })
    })
    queryMock.mockImplementation(async (_ctx, options) => {
      emitEvent = options.onEvent
      return { kill: vi.fn(), emit: vi.fn() }
    })
    callHookMock.mockImplementation(async (eventName) => {
      if (eventName === 'TaskStop') {
        lifecycle.push('TaskStop')
        throw taskStopError
      }
      return { continue: true }
    })
    prepareMock.mockResolvedValue([ctx])

    const result = await run({
      adapter: 'codex',
      cwd: ctx.cwd,
      env: {}
    }, {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-task-stop-error',
      onEvent: vi.fn()
    })

    emitEvent?.({ type: 'exit', data: { exitCode: 1, stderr: 'failed' } })
    await result.session.flushHooks()

    expect(lifecycle).toEqual(['TaskStop', 'SessionEnd'])
    expect(ctx.logger.error).toHaveBeenCalledWith(
      '[Hook] TaskStop failed',
      expect.objectContaining({ message: taskStopError.message, name: 'Error' })
    )
  })

  it('keeps Qwen redaction intact across broadcasts, hooks, bridge output, logs, and cache snapshots', async () => {
    const ctx = createCtx()
    const secret = 'qwen-cross-boundary-secret-12345'
    const qwenHome = '/private/qwen-home-fixture'
    const runtimeDir = '/private/qwen-runtime-fixture'
    const onEvent = vi.fn()
    let outputQueue: Promise<unknown> = Promise.resolve()
    const handleOutput = vi.fn()
    const redactor = createQwenRuntimeRedactor({
      env: { OPENAI_API_KEY: secret },
      qwenHome,
      runtimeDir
    })
    const rawExit = {
      type: 'exit' as const,
      data: {
        exitCode: 1,
        stderr: `provider api_key=${secret} home=${qwenHome} runtime=${runtimeDir}`
      }
    }

    createAdapterHookBridgeMock.mockReturnValue({
      start: vi.fn().mockResolvedValue(undefined),
      prepareInitialPrompt: vi.fn(async (prompt?: string) => prompt),
      wrapSession: vi.fn((session: unknown) => session),
      enqueueAfterPendingHooks: vi.fn((runHook: () => Promise<unknown>) => {
        outputQueue = outputQueue.catch(() => undefined).then(runHook)
      }),
      handleOutput,
      flush: vi.fn(async () => outputQueue)
    })
    queryMock.mockImplementation(async (_ctx, options) => {
      options.onEvent(redactor.event(rawExit))
      return { kill: vi.fn(), emit: vi.fn() }
    })
    ctx.configs = [{ adapters: createAdapters({ 'qwen-code': {} }) }, undefined]
    prepareMock.mockResolvedValue([ctx])

    const result = await run({ adapter: 'qwen-code', cwd: ctx.cwd, env: {} }, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-qwen-redaction-boundaries',
      description: 'hello',
      onEvent
    })
    await result.session.flushHooks()

    const boundaryState = JSON.stringify({
      baseCache: (ctx.cache.set as ReturnType<typeof vi.fn>).mock.calls,
      broadcast: onEvent.mock.calls,
      bridge: handleOutput.mock.calls,
      hooks: callHookMock.mock.calls,
      logger: {
        debug: (ctx.logger.debug as ReturnType<typeof vi.fn>).mock.calls,
        error: (ctx.logger.error as ReturnType<typeof vi.fn>).mock.calls,
        info: (ctx.logger.info as ReturnType<typeof vi.fn>).mock.calls,
        warn: (ctx.logger.warn as ReturnType<typeof vi.fn>).mock.calls
      }
    })
    expect(boundaryState).not.toContain(secret)
    expect(boundaryState).not.toContain(qwenHome)
    expect(boundaryState).not.toContain(runtimeDir)
    expect(boundaryState).toContain('[REDACTED]')
    expect(boundaryState).toContain('[QWEN_HOME]')
    expect(boundaryState).toContain('[QWEN_RUNTIME_DIR]')
    expect(callHookMock).toHaveBeenCalledWith(
      'TaskStop',
      expect.objectContaining({
        stderr: expect.stringContaining('[REDACTED]')
      }),
      expect.any(Object)
    )
  })
})
