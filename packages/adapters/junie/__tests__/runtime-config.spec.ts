import '../src/adapter-config'

import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it } from 'vitest'

import type { AdapterCtx } from '@oneworks/types'

import type { JunieAuthProvider } from '#~/auth-env.js'
import {
  JUNIE_AUTH_ENV_KEYS,
  JUNIE_PROVIDER_AUTH_ENV_KEYS,
  JUNIE_PROVIDER_ROUTING_ENV_KEYS,
  resolveJunieRuntimeEnvironmentKeys
} from '#~/auth-env.js'
import { junieAdapterConfigSchema } from '#~/config-schema.js'
import { JUNIE_SUPPORTED_EFFORTS } from '#~/effort.js'
import { builtinModels } from '#~/models.js'
import {
  buildJunieArgs,
  buildJunieChildEnv,
  classifyJunieControlledExtraOption,
  prepareJunieSession,
  resolveJunieAdapterConfig,
  sanitizeJunieConfigContentForPersistence
} from '#~/runtime/shared.js'

const makeCtx = (cwd: string, adapterConfig: Record<string, unknown> = {}): AdapterCtx => ({
  ctxId: 'ctx-junie-config',
  cwd,
  env: {
    __ONEWORKS_PROJECT_ADAPTER_JUNIE_CLI_PATH__: join(cwd, 'junie'),
    __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: join(cwd, '.oo'),
    __ONEWORKS_PROJECT_JUNIE_HOOK_COMMAND__: 'node sanitized-hook.js',
    __ONEWORKS_PROJECT_JUNIE_NATIVE_HOOKS_AVAILABLE__: '1',
    __ONEWORKS_PROJECT_REAL_HOME__: join(cwd, 'real-home')
  },
  cache: { get: async () => undefined, set: async () => ({ cachePath: '' }) },
  logger: {
    stream: new PassThrough(),
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined
  },
  configs: [{ adapters: { junie: adapterConfig } }, undefined]
})

describe('junie isolated runtime config', () => {
  let cwd: string | undefined

  afterEach(async () => {
    if (cwd != null) await rm(cwd, { recursive: true, force: true })
    cwd = undefined
  })

  it('uses the pinned CLI effort contract in model metadata, config schema, and runtime args', async () => {
    expect(JUNIE_SUPPORTED_EFFORTS).toEqual(['low', 'medium', 'high'])
    expect(builtinModels[0]?.supportedEfforts).toEqual(JUNIE_SUPPORTED_EFFORTS)
    expect(junieAdapterConfigSchema.safeParse({ effort: 'max' }).success).toBe(false)
    for (const effort of JUNIE_SUPPORTED_EFFORTS) {
      expect(junieAdapterConfigSchema.safeParse({ effort }).success).toBe(true)
    }

    cwd = await mkdtemp(join(tmpdir(), 'ow-junie-effort-'))
    const ctx = makeCtx(cwd)
    const options = {
      type: 'create' as const,
      runtime: 'server' as const,
      sessionId: 'effort-session',
      effort: 'max' as const,
      onEvent: () => undefined
    }
    const prepared = await prepareJunieSession(ctx, options)
    expect(() =>
      buildJunieArgs({
        adapterConfig: resolveJunieAdapterConfig(ctx),
        options,
        prepared,
        stream: true
      })
    ).toThrow('supports only low, medium, high effort')
  })

  it.each([
    ['split long option', ['--effort', 'max']],
    ['equals long option', ['--effort=max']],
    ['repeated long options', ['--effort=low', '--effort=high']],
    ['case variant', ['--EfFoRt=high']],
    ['split short alias', ['-e', 'max']],
    ['attached short alias', ['-emax']],
    ['equals compatibility alias', ['-effort=max']],
    ['argument terminator escape', ['--', '--effort=max']]
  ])('rejects the %s effort escape from advanced args', async (_label, extraOptions) => {
    cwd = await mkdtemp(join(tmpdir(), 'ow-junie-effort-extra-'))
    const ctx = makeCtx(cwd)
    const options = {
      type: 'create' as const,
      runtime: 'server' as const,
      sessionId: 'effort-extra-session',
      effort: 'low' as const,
      extraOptions,
      onEvent: () => undefined
    }
    const prepared = await prepareJunieSession(ctx, options)
    expect(() =>
      buildJunieArgs({
        adapterConfig: resolveJunieAdapterConfig(ctx),
        options,
        prepared,
        stream: true
      })
    ).toThrow('does not allow controlled or credential option')
  })

  it.each([
    ['--model=override', '--model', 'model'],
    ['--PrOvIdEr', '--provider', 'model'],
    ['--review=false', '--review', 'model'],
    ['--agent-mode=classic', '--agent-mode', 'model'],
    ['--skip-update-check=false', '--skip-update-check', 'privacy'],
    ['--SHARE-ANONYMOUS-STATISTICS=true', '--share-anonymous-statistics', 'privacy'],
    ['-p=/tmp/override', '--project', 'lifecycle'],
    ['-A', '--auth', 'authentication'],
    ['-Acredential', '--auth', 'authentication'],
    ['-c=/tmp/cache', '--cache-dir', 'transport'],
    ['-c/tmp/cache', '--cache-dir', 'transport'],
    ['--', '--', 'lifecycle']
  ])('classifies controlled option %s as %s/%s', (option, canonicalName, category) => {
    expect(classifyJunieControlledExtraOption(option)).toEqual({ canonicalName, category })
  })

  it('does not classify the supported safe --verbose advanced option', () => {
    expect(classifyJunieControlledExtraOption('--verbose')).toBeUndefined()
  })

  it('classifies every adapter-owned Junie option reserved by the runtime contract', () => {
    const adapterOwnedOptions = [
      '--agent-default-location',
      '--agent-location',
      '--agent-mode',
      '--anthropic-api-key',
      '--auth',
      '--brave',
      '--cache-dir',
      '--command-default-location',
      '--command-location',
      '--config-default-locations',
      '--config-location',
      '--effort',
      '--extensions-default-location',
      '--google-api-key',
      '--grok-api-key',
      '--ide-guidelines',
      '--input-format',
      '--json-output-file',
      '--litellm-api-key',
      '--litellm-url',
      '--mcp-default-locations',
      '--mcp-location',
      '--model',
      '--model-default-locations',
      '--model-location',
      '--openai-api-key',
      '--openrouter-api-key',
      '--output-format',
      '--plan',
      '--project',
      '--prompt',
      '--provider',
      '--resume',
      '--review',
      '--session-id',
      '--share-anonymous-statistics',
      '--skill-default-locations',
      '--skill-location',
      '--skip-update-check',
      '--task'
    ]
    expect(adapterOwnedOptions.filter(option => classifyJunieControlledExtraOption(option) == null)).toEqual([])
  })

  it('preserves safe advanced args and emits only selected model/provider/privacy settings', async () => {
    cwd = await mkdtemp(join(tmpdir(), 'ow-junie-safe-extra-'))
    const ctx = makeCtx(cwd, {
      provider: 'anthropic',
      review: true,
      agentMode: 'chat',
      disableAutoUpdate: true,
      shareAnonymousStatistics: false
    })
    const options = {
      type: 'create' as const,
      runtime: 'server' as const,
      sessionId: 'safe-extra-session',
      model: 'selected-model',
      effort: 'high' as const,
      extraOptions: ['--verbose'],
      onEvent: () => undefined
    }
    const prepared = await prepareJunieSession(ctx, options)
    const args = buildJunieArgs({
      adapterConfig: resolveJunieAdapterConfig(ctx),
      options,
      prepared,
      stream: true
    })

    expect(args.filter(option => option.toLowerCase() === '--effort')).toEqual(['--effort'])
    expect(args[args.indexOf('--effort') + 1]).toBe('high')
    expect(args.filter(option => option.toLowerCase() === '--model')).toEqual(['--model'])
    expect(args[args.indexOf('--model') + 1]).toBe('selected-model')
    expect(args.filter(option => option.toLowerCase() === '--provider')).toEqual(['--provider'])
    expect(args[args.indexOf('--provider') + 1]).toBe('anthropic')
    expect(args.filter(option => option.toLowerCase() === '--review')).toEqual(['--review'])
    expect(args.filter(option => option.toLowerCase() === '--agent-mode')).toEqual(['--agent-mode'])
    expect(args[args.indexOf('--agent-mode') + 1]).toBe('chat')
    expect(args.filter(option => option.toLowerCase() === '--skip-update-check')).toEqual(['--skip-update-check'])
    expect(args.filter(option => option.startsWith('--share-anonymous-statistics='))).toEqual([
      '--share-anonymous-statistics=false'
    ])
    expect(args).toContain('--verbose')
  })

  it('contains config, assets, and read-only plan instructions inside the session root', async () => {
    cwd = await mkdtemp(join(tmpdir(), 'ow-junie-config-'))
    const skillDir = join(cwd, 'skill')
    const agentPath = join(cwd, 'reviewer.md')
    await mkdir(skillDir)
    await writeFile(join(skillDir, 'SKILL.md'), '# sanitized skill\n')
    await writeFile(agentPath, '# sanitized agent\n')
    const ctx = makeCtx(cwd, { provider: 'openai', effort: 'high' })
    const options = {
      type: 'create' as const,
      runtime: 'server' as const,
      sessionId: 'config-session',
      permissionMode: 'plan' as const,
      systemPrompt: 'Follow sanitized workspace rules.',
      assetPlan: {
        adapter: 'junie' as const,
        diagnostics: [],
        mcpServers: { docs: { command: 'node', args: ['docs.mjs'] } },
        overlays: [
          { assetId: 'skill', kind: 'skill' as const, sourcePath: skillDir, targetPath: 'skills/research' },
          { assetId: 'agent', kind: 'agent' as const, sourcePath: agentPath, targetPath: 'agents/reviewer.md' }
        ]
      },
      onEvent: () => undefined
    }
    const prepared = await prepareJunieSession(ctx, options)
    const args = buildJunieArgs({
      adapterConfig: resolveJunieAdapterConfig(ctx),
      options,
      prepared,
      prompt: 'Plan this change',
      stream: true
    })

    expect(prepared.configPath).toContain('/.oo/caches/adapter-junie/sessions/config-session/')
    expect(prepared.dataDir).toContain('/.oo/caches/adapter-junie/sessions/config-session/data')
    expect(prepared.spawnEnv.HOME).toContain('/.oo/caches/adapter-junie/sessions/config-session/home')
    expect(prepared.spawnEnv.JUNIE_DATA).toBe(prepared.dataDir)
    expect(prepared.spawnEnv.HOME).not.toContain('/real-home/')
    expect((await lstat(join(prepared.skillsDir, 'research'))).isSymbolicLink()).toBe(true)
    expect((await lstat(join(prepared.agentsDir, 'reviewer.md'))).isSymbolicLink()).toBe(true)
    expect(JSON.parse(await readFile(prepared.configPath, 'utf8'))).toEqual(expect.objectContaining({
      hooks: expect.objectContaining({ StopFailure: expect.any(Array), SessionEnd: expect.any(Array) })
    }))
    expect(JSON.parse(await readFile(join(prepared.mcpDir, 'mcp.json'), 'utf8'))).toEqual({
      mcpServers: { docs: { command: 'node', args: ['docs.mjs'] } }
    })
    expect(await readFile(prepared.guidelinesPath!, 'utf8')).toContain(
      'Junie headless does not expose native Plan Mode'
    )
    expect(args).toEqual(expect.arrayContaining([
      '--config-default-locations=false',
      '--mcp-default-locations=false',
      '--skill-default-locations=false',
      '--agent-default-location=false',
      '--command-default-location=false',
      '--provider',
      'openai'
    ]))
    expect(args).not.toContain('--plan')
  })

  it('scrubs credential-like config fields without mutating runtime input and rejects credential flags', async () => {
    cwd = await mkdtemp(join(tmpdir(), 'ow-junie-secret-config-'))
    const configContent = {
      tokenBudget: 8192,
      nested: { apiKey: 'must-not-stage', enabled: true },
      byok: {
        provider: 'openai',
        openai: { apiKey: 'must-not-stage-byok', baseUrl: 'https://api.example.test' }
      },
      raw: '{"password":"must-not-stage-embedded","enabled":true}'
    }
    const ctx = makeCtx(cwd, { configContent })
    const preparedSecret = await prepareJunieSession(ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: 'secret-session',
      onEvent: () => undefined
    })
    const staged = JSON.parse(await readFile(preparedSecret.configPath, 'utf8')) as Record<string, unknown>
    expect(staged).toEqual(expect.objectContaining({
      tokenBudget: 8192,
      nested: { enabled: true },
      byok: {
        provider: 'openai',
        openai: { baseUrl: 'https://api.example.test' }
      }
    }))
    expect(JSON.parse(String(staged.raw))).toEqual({ enabled: true })
    expect(JSON.stringify(staged)).not.toContain('must-not-stage')
    expect(configContent.nested.apiKey).toBe('must-not-stage')
    expect(sanitizeJunieConfigContentForPersistence(configContent)).not.toBe(configContent)

    const safeCtx = makeCtx(cwd)
    const options = {
      type: 'create' as const,
      runtime: 'server' as const,
      sessionId: 'safe-session',
      extraOptions: ['--auth=secret'],
      onEvent: () => undefined
    }
    const prepared = await prepareJunieSession(safeCtx, options)
    expect(() =>
      buildJunieArgs({
        adapterConfig: resolveJunieAdapterConfig(safeCtx),
        options,
        prepared,
        stream: true
      })
    ).toThrow('does not allow controlled or credential option')
  })

  it('preserves only shape-validated Linux credential-store locators', () => {
    const base = {
      adapterConfig: {},
      isolated: { HOME: '/isolated/home' },
      platform: 'linux' as const
    }
    expect(buildJunieChildEnv({
      ...base,
      env: {
        DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus,guid=0123456789abcdef0123456789abcdef',
        XDG_RUNTIME_DIR: '/run/user/1000'
      }
    })).toEqual(expect.objectContaining({
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus,guid=0123456789abcdef0123456789abcdef',
      XDG_RUNTIME_DIR: '/run/user/1000'
    }))
    expect(buildJunieChildEnv({
      ...base,
      env: {
        DBUS_SESSION_BUS_ADDRESS: 'tcp:host=127.0.0.1,port=1234',
        XDG_RUNTIME_DIR: '../relative-runtime',
        OPENAI_API_KEY: 'must-not-leak'
      }
    })).toEqual(expect.not.objectContaining({
      DBUS_SESSION_BUS_ADDRESS: expect.anything(),
      XDG_RUNTIME_DIR: expect.anything(),
      OPENAI_API_KEY: expect.anything()
    }))
    expect(buildJunieChildEnv({
      ...base,
      env: {
        DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
        XDG_RUNTIME_DIR: '/run/user/1000'
      },
      platform: 'darwin'
    })).not.toEqual(expect.objectContaining({
      DBUS_SESSION_BUS_ADDRESS: expect.anything(),
      XDG_RUNTIME_DIR: expect.anything()
    }))
  })

  it.each(Object.keys(JUNIE_PROVIDER_AUTH_ENV_KEYS) as JunieAuthProvider[])(
    'passes exactly the authoritative %s runtime authentication and routing keys to the child',
    provider => {
      const runtimeKeys = [
        ...JUNIE_AUTH_ENV_KEYS,
        ...Object.values(JUNIE_PROVIDER_ROUTING_ENV_KEYS).flat()
      ]
      const env = Object.fromEntries(runtimeKeys.map(key => [key, `value-${key.toLowerCase()}`]))
      const child = buildJunieChildEnv({
        adapterConfig: { provider },
        env,
        isolated: { HOME: '/isolated/home' }
      })
      const expected = new Set<string>(resolveJunieRuntimeEnvironmentKeys(provider))
      for (const key of runtimeKeys) {
        if (expected.has(key)) expect(child).toHaveProperty(key, env[key])
        else expect(child).not.toHaveProperty(key)
      }
    }
  )

  it('contains unsafe session ids and overlay target paths inside the session root', async () => {
    cwd = await mkdtemp(join(tmpdir(), 'ow-junie-containment-'))
    const skillDir = join(cwd, 'skill')
    await mkdir(skillDir)
    await writeFile(join(skillDir, 'SKILL.md'), '# contained skill\n')
    const ctx = makeCtx(cwd)
    const prepared = await prepareJunieSession(ctx, {
      type: 'create',
      runtime: 'server',
      sessionId: '../../must-not-escape',
      assetPlan: {
        adapter: 'junie',
        diagnostics: [],
        mcpServers: {},
        overlays: [{
          assetId: 'skill',
          kind: 'skill',
          sourcePath: skillDir,
          targetPath: 'skills/..\\..\\outside'
        }]
      },
      onEvent: () => undefined
    })
    const sessionsRoot = join(cwd, '.oo', 'caches', 'adapter-junie', 'sessions')
    expect(relative(sessionsRoot, prepared.dataDir)).not.toMatch(/^\.\.(?:[\\/]|$)/u)
    expect(relative(prepared.skillsDir, join(prepared.skillsDir, '..__..__outside'))).toBe('..__..__outside')
    expect((await lstat(join(prepared.skillsDir, '..__..__outside'))).isSymbolicLink()).toBe(true)
  })
})
