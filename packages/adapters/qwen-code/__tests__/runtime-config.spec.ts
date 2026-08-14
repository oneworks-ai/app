import '../src/adapter-config'

import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it } from 'vitest'

import type { AdapterCtx, AdapterQueryOptions, Config, ModelServiceConfig } from '@oneworks/types'

import { buildQwenHeadlessArgs, prepareQwenSession } from '#~/runtime/config.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const createFixture = async (params: {
  adapterConfig?: Record<string, unknown>
  modelServices?: Record<string, ModelServiceConfig>
}) => {
  const root = await mkdtemp(join(tmpdir(), 'oneworks-qwen-code-config-'))
  tempDirs.push(root)
  const cwd = join(root, 'workspace')
  const realHome = join(root, 'real-home')
  const realQwenHome = join(realHome, '.qwen')
  await Promise.all([mkdir(cwd, { recursive: true }), mkdir(realQwenHome, { recursive: true })])
  const realSettings = `${
    JSON.stringify(
      {
        $version: 4,
        env: { OPENAI_API_KEY: 'MUST_NOT_BE_COPIED' },
        model: { name: 'real-default' },
        modelProviders: {
          custom: [{ id: 'real-model', envKey: 'REAL_KEY', baseUrl: 'https://real.invalid/v1' }]
        },
        providerProtocol: { custom: 'openai' },
        security: { auth: { selectedType: 'custom', apiKey: 'MUST_NOT_BE_COPIED' } }
      },
      null,
      2
    )
  }\n`
  await writeFile(join(realQwenHome, 'settings.json'), realSettings, 'utf8')
  const config: Config = {
    adapters: {
      'qwen-code': params.adapterConfig ?? {}
    },
    modelServices: params.modelServices ?? {
      local: {
        apiBaseUrl: 'http://127.0.0.1:43199/v1/chat/completions',
        apiKey: 'TEST_VALUE_REDACTED',
        apiProtocol: 'openai-chat-completions',
        provider: 'openai'
      }
    }
  }
  const ctx: AdapterCtx = {
    ctxId: 'ctx-qwen-config-test',
    cwd,
    env: {
      QWEN_HOME: realQwenHome,
      OPENAI_API_KEY: 'AMBIENT_VALUE_MUST_NOT_BE_USED',
      OPENAI_BASE_URL: 'https://ambient.invalid/v1',
      OPENAI_MODEL: 'ambient-model',
      QWEN_OAUTH: '1',
      __ONEWORKS_PROJECT_ADAPTER_QWEN_CODE_CLI_PATH__: '/usr/bin/qwen',
      __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: join(root, 'project-home'),
      __ONEWORKS_PROJECT_QWEN_CODE_NATIVE_HOOKS_AVAILABLE__: '0',
      __ONEWORKS_PROJECT_REAL_HOME__: realHome
    },
    cache: {
      get: async () => undefined,
      set: async () => ({ cachePath: '' })
    },
    logger: {
      stream: new PassThrough(),
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined
    },
    configs: [config, undefined]
  }
  const options: AdapterQueryOptions = {
    type: 'create',
    runtime: 'cli',
    sessionId: 'qwen-config-session',
    model: 'local,selected-model',
    onEvent: () => undefined
  }
  return { config, ctx, cwd, options, realQwenHome, realSettings, root }
}

describe('qwen Code runtime config', () => {
  it('writes the verified OpenAI provider shape without persisting a credential value', async () => {
    const fixture = await createFixture({})
    const prepared = await prepareQwenSession(fixture.ctx, fixture.options)
    const settingsText = await readFile(join(prepared.qwenHome, 'settings.json'), 'utf8')
    const settings = JSON.parse(settingsText) as Record<string, any>

    expect(settings.model).toEqual({ name: 'selected-model' })
    expect(settings.modelProviders).toEqual({
      openai: [{
        id: 'selected-model',
        name: 'One Works session model service',
        envKey: 'OPENAI_API_KEY',
        baseUrl: 'http://127.0.0.1:43199/v1'
      }]
    })
    expect(settings.providerProtocol).toEqual({ openai: 'openai' })
    expect(settings.security).toEqual({ auth: { selectedType: 'openai' } })
    expect(settingsText).not.toContain('TEST_VALUE_REDACTED')
    expect(settingsText).not.toContain('MUST_NOT_BE_COPIED')
    expect(settingsText).not.toContain('AMBIENT_VALUE_MUST_NOT_BE_USED')
    expect(prepared.spawnEnv.OPENAI_API_KEY).toBe('TEST_VALUE_REDACTED')
    expect(prepared.spawnEnv.OPENAI_BASE_URL).toBeUndefined()
    expect(prepared.spawnEnv.OPENAI_MODEL).toBeUndefined()
    expect(prepared.spawnEnv.QWEN_OAUTH).toBeUndefined()
    expect(prepared.spawnEnv.HOME).toBe(prepared.qwenHome)
    expect(prepared.spawnEnv.QWEN_HOME).toBe(prepared.qwenHome)
    expect(prepared.spawnEnv.QWEN_RUNTIME_DIR).toBe(prepared.runtimeDir)
    expect(prepared.runtimeDir).not.toBe(prepared.qwenHome)
    expect(await readFile(join(fixture.realQwenHome, 'settings.json'), 'utf8')).toBe(fixture.realSettings)
  })

  it('stages only selected skills and writes system prompt and MCP config inside the isolated home', async () => {
    const fixture = await createFixture({})
    const skillDir = join(fixture.root, 'selected-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '# Fixture skill\n', 'utf8')
    const prepared = await prepareQwenSession(fixture.ctx, {
      ...fixture.options,
      systemPrompt: 'Follow the sanitized fixture instructions.',
      assetPlan: {
        adapter: 'qwen-code',
        diagnostics: [],
        mcpServers: {
          docs: {
            command: process.execPath,
            args: ['fixture-mcp.mjs'],
            env: { FIXTURE_MODE: '1' }
          }
        },
        overlays: [{
          assetId: 'skill:fixture',
          kind: 'skill',
          sourcePath: skillDir,
          targetPath: 'skills/fixture'
        }]
      }
    })
    const settings = JSON.parse(await readFile(join(prepared.qwenHome, 'settings.json'), 'utf8')) as Record<string, any>
    const promptPath = join(prepared.qwenHome, 'ONEWORKS.md')
    const skillPath = join(prepared.qwenHome, 'skills', 'fixture')

    expect(await readFile(promptPath, 'utf8')).toBe('Follow the sanitized fixture instructions.')
    expect(settings.context.fileName).toEqual(['QWEN.md', promptPath])
    expect(settings.mcpServers.docs).toEqual({
      command: process.execPath,
      args: ['fixture-mcp.mjs'],
      env: { FIXTURE_MODE: '1' }
    })
    expect((await lstat(skillPath)).isSymbolicLink()).toBe(true)
    expect(await realpath(skillPath)).toBe(await realpath(skillDir))
    expect(await readdir(prepared.qwenHome)).not.toEqual(expect.arrayContaining([
      'oauth_creds.json',
      'mcp-oauth-tokens.json'
    ]))
    expect(await readFile(join(fixture.realQwenHome, 'settings.json'), 'utf8')).toBe(fixture.realSettings)
  })

  it('keeps MCP credentials in isolated child settings while filtering unrelated inherited credentials', async () => {
    const fixture = await createFixture({})
    Object.assign(fixture.ctx.env, {
      AWS_SECRET_ACCESS_KEY: 'aws-child-canary',
      AWS_SHARED_CREDENTIALS_FILE: '/private/aws-credentials',
      COOKIE: 'cookie-child-canary',
      GENERIC_CREDENTIAL: 'credential-child-canary',
      GITHUB_TOKEN: 'github-child-canary',
      HTTPS_PROXY: 'https://proxy.example.com:8443',
      LANG: 'en_US.UTF-8',
      MYSQL_PWD: 'mysql-child-canary',
      PASSWORD_FILE: '/private/password-file',
      PATH: '/usr/local/bin:/usr/bin',
      PGPASSWORD: 'pg-child-canary',
      PRIVATE_KEY: 'private-key-child-canary',
      secretary: 'preserve-secretary',
      tokenCount: 'preserve-token-count'
    })
    const mcpSecrets = {
      authorization: 'mcp-authorization-canary',
      cookie: 'mcp-cookie-canary',
      env: 'mcp-env-canary'
    }
    const prepared = await prepareQwenSession(fixture.ctx, {
      ...fixture.options,
      assetPlan: {
        adapter: 'qwen-code',
        diagnostics: [],
        mcpServers: {
          http: {
            type: 'http',
            url: 'https://mcp.example.com/http',
            headers: {
              Authorization: `Bearer ${mcpSecrets.authorization}`,
              'X-Trace-Id': 'preserve-trace'
            }
          },
          sse: {
            type: 'sse',
            url: 'https://mcp.example.com/sse',
            headers: {
              Cookie: `session=${mcpSecrets.cookie}`,
              'X-Safe-Mode': 'preserve-safe-mode'
            }
          },
          stdio: {
            command: process.execPath,
            args: ['fixture-mcp.mjs'],
            env: { API_TOKEN: mcpSecrets.env, SAFE_MODE: 'preserve-safe-env' }
          }
        },
        overlays: []
      }
    })
    const settings = JSON.parse(
      await readFile(join(prepared.qwenHome, 'settings.json'), 'utf8')
    ) as Record<string, any>

    expect(settings.mcpServers).toMatchObject({
      http: {
        headers: {
          Authorization: `Bearer ${mcpSecrets.authorization}`,
          'X-Trace-Id': 'preserve-trace'
        }
      },
      sse: {
        headers: {
          Cookie: `session=${mcpSecrets.cookie}`,
          'X-Safe-Mode': 'preserve-safe-mode'
        }
      },
      stdio: {
        env: { API_TOKEN: mcpSecrets.env, SAFE_MODE: 'preserve-safe-env' }
      }
    })
    expect(prepared.spawnEnv.OPENAI_API_KEY).toBe('TEST_VALUE_REDACTED')
    expect(prepared.spawnEnv).not.toHaveProperty('AWS_SECRET_ACCESS_KEY')
    expect(prepared.spawnEnv).not.toHaveProperty('AWS_SHARED_CREDENTIALS_FILE')
    expect(prepared.spawnEnv).not.toHaveProperty('COOKIE')
    expect(prepared.spawnEnv).not.toHaveProperty('GENERIC_CREDENTIAL')
    expect(prepared.spawnEnv).not.toHaveProperty('GITHUB_TOKEN')
    expect(prepared.spawnEnv).not.toHaveProperty('MYSQL_PWD')
    expect(prepared.spawnEnv).not.toHaveProperty('PASSWORD_FILE')
    expect(prepared.spawnEnv).not.toHaveProperty('PGPASSWORD')
    expect(prepared.spawnEnv).not.toHaveProperty('PRIVATE_KEY')
    expect(prepared.spawnEnv).toMatchObject({
      HTTPS_PROXY: 'https://proxy.example.com:8443',
      LANG: 'en_US.UTF-8',
      PATH: '/usr/local/bin:/usr/bin',
      secretary: 'preserve-secretary',
      tokenCount: 'preserve-token-count'
    })
    expect(fixture.ctx.env.GITHUB_TOKEN).toBe('github-child-canary')
    expect(fixture.ctx.env.PGPASSWORD).toBe('pg-child-canary')
    expect(fixture.ctx.env.PRIVATE_KEY).toBe('private-key-child-canary')
  })

  it.each([
    {
      adapterConfig: {
        settingsContent: { tools: { core: ['read_file'], exclude: ['existing'], custom: true } }
      },
      executionProfile: 'structured_no_tools' as const,
      expected: { core: [], exclude: ['existing'], custom: true },
      label: 'structured no-tools alone'
    },
    {
      adapterConfig: {
        disableSubagents: true,
        settingsContent: { tools: { core: ['read_file'], exclude: ['existing', 'agent'], custom: true } }
      },
      executionProfile: undefined,
      expected: {
        core: ['read_file'],
        exclude: ['existing', 'agent', 'list_agents', 'send_message', 'wait_agent'],
        custom: true
      },
      label: 'subagent denial alone'
    },
    {
      adapterConfig: {
        disableSubagents: true,
        settingsContent: { tools: { core: ['read_file'], exclude: ['existing', 'agent'], custom: true } }
      },
      executionProfile: 'structured_no_tools' as const,
      expected: {
        core: [],
        exclude: ['existing', 'agent', 'list_agents', 'send_message', 'wait_agent'],
        custom: true
      },
      label: 'structured no-tools plus subagent denial'
    }
  ])('composes $label without losing existing tool settings', async ({
    adapterConfig,
    executionProfile,
    expected
  }) => {
    const fixture = await createFixture({ adapterConfig })
    const prepared = await prepareQwenSession(fixture.ctx, {
      ...fixture.options,
      executionProfile
    })
    const settings = JSON.parse(
      await readFile(join(prepared.qwenHome, 'settings.json'), 'utf8')
    ) as Record<string, any>

    expect(settings.tools).toEqual(expected)
  })

  it('forces extensions off for structured no-tools while preserving normal explicit extension opt-in', () => {
    const adapterConfig = { disableExtensions: false }
    const baseOptions = {
      type: 'create' as const,
      runtime: 'server' as const,
      sessionId: 'qwen-extension-argv',
      onEvent: () => undefined
    }
    const structuredArgs = buildQwenHeadlessArgs({
      adapterConfig,
      options: { ...baseOptions, executionProfile: 'structured_no_tools' }
    })
    const normalArgs = buildQwenHeadlessArgs({ adapterConfig, options: baseOptions })

    expect(structuredArgs).toEqual(expect.arrayContaining(['--extensions', 'none']))
    expect(normalArgs).not.toContain('--extensions')
  })

  it('redacts credential and private-home diagnostics when inherited settings are malformed', async () => {
    const fixture = await createFixture({})
    const secret = 'config-diagnostic-secret-12345'
    fixture.ctx.env.OPENAI_API_KEY = secret
    await writeFile(
      join(fixture.realQwenHome, 'settings.json'),
      `{"apiKey":"${secret}", invalid-json`,
      'utf8'
    )
    const warnings: unknown[][] = []
    fixture.ctx.logger.warn = (...args: unknown[]) => warnings.push(args)

    await prepareQwenSession(fixture.ctx, fixture.options)

    const serialized = JSON.stringify(warnings)
    expect(warnings).toHaveLength(1)
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain(fixture.realQwenHome)
    expect(serialized).toContain('[QWEN_HOME]')
  })

  it.each(
    [
      {
        label: 'empty model',
        model: 'local,',
        modelServices: undefined,
        message: 'requires a non-empty service key and model name'
      },
      {
        label: 'missing protocol',
        model: 'local,selected-model',
        modelServices: {
          local: {
            apiBaseUrl: 'https://example.invalid/v1',
            apiKey: 'TEST_VALUE_REDACTED',
            provider: 'openai'
          }
        },
        message: 'require explicit OpenAI Chat Completions protocol'
      },
      {
        label: 'custom provider',
        model: 'local,selected-model',
        modelServices: {
          local: {
            apiBaseUrl: 'https://example.invalid/v1',
            apiKey: 'TEST_VALUE_REDACTED',
            apiProtocol: 'openai-chat-completions',
            provider: 'custom'
          }
        },
        message: 'requires provider "openai"'
      },
      {
        label: 'missing api key',
        model: 'local,selected-model',
        modelServices: {
          local: {
            apiBaseUrl: 'https://example.invalid/v1',
            apiProtocol: 'openai-chat-completions',
            provider: 'openai'
          }
        },
        message: 'requires an API key'
      },
      {
        label: 'invalid base URL',
        model: 'local,selected-model',
        modelServices: {
          local: {
            apiBaseUrl: 'relative/path',
            apiKey: 'TEST_VALUE_REDACTED',
            apiProtocol: 'openai-chat-completions',
            provider: 'openai'
          }
        },
        message: 'absolute HTTP(S) URL'
      },
      {
        label: 'unverified protocol',
        model: 'local,selected-model',
        modelServices: {
          local: {
            apiBaseUrl: 'https://example.invalid/v1',
            apiKey: 'TEST_VALUE_REDACTED',
            apiProtocol: 'anthropic-messages',
            provider: 'openai'
          }
        },
        message: 'require explicit OpenAI Chat Completions protocol'
      }
    ] satisfies Array<{
      label: string
      message: string
      model: string
      modelServices?: Record<string, ModelServiceConfig>
    }>
  )('fails closed for $label', async ({ message, model, modelServices }) => {
    const fixture = await createFixture({ modelServices })
    await expect(prepareQwenSession(fixture.ctx, { ...fixture.options, model })).rejects.toThrow(message)
  })

  it('rejects provider configuration in settingsContent instead of bypassing routed validation', async () => {
    const fixture = await createFixture({
      adapterConfig: {
        settingsContent: {
          providerProtocol: { custom: 'openai' },
          security: { auth: { selectedType: 'custom' } }
        }
      }
    })
    await expect(prepareQwenSession(fixture.ctx, fixture.options)).rejects.toThrow(
      'settingsContent cannot configure model providers'
    )
  })

  it('leaves the previous settings atomically intact when routed validation fails', async () => {
    const fixture = await createFixture({})
    const prepared = await prepareQwenSession(fixture.ctx, fixture.options)
    const settingsPath = join(prepared.qwenHome, 'settings.json')
    const before = await readFile(settingsPath, 'utf8')
    fixture.config.modelServices = {
      local: {
        apiBaseUrl: 'file:///tmp/not-an-api',
        apiKey: 'TEST_VALUE_REDACTED',
        apiProtocol: 'openai-chat-completions',
        provider: 'openai'
      }
    }
    await expect(prepareQwenSession(fixture.ctx, fixture.options)).rejects.toThrow('must use HTTP or HTTPS')
    expect(await readFile(settingsPath, 'utf8')).toBe(before)
    expect((await readdir(prepared.qwenHome)).filter(name => name.endsWith('.tmp'))).toEqual([])
  })
})
